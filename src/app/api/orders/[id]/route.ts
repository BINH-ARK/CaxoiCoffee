import { NextResponse } from "next/server";
import {
  getOrderByIdFromMySql,
  updateOrderStatusInMySql,
  getBusinessSettingsFromMySql,
  recordAuditLogInMySql,
} from "@/lib/mysql";
import {
  getAuthenticatedStaff,
  getTrustedClientIp,
  requireStaffAuth,
  verifySameOriginCsrf,
} from "@/lib/serverAuth";
import { safeEqualStrings } from "@/lib/password";
import { maskAddress, maskPersonName, maskPhone } from "@/lib/utils";
import { consumeRateLimit, createRateLimitResponse } from "@/lib/rateLimit";
import { Order } from "@/types";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set([
  "PENDING_PAYMENT",
  "CONFIRMED",
  "BREWING",
  "READY",
  "DELIVERING",
  "COMPLETED",
  "CANCELLED",
]);
const ALLOWED_PAYMENT_STATUSES = new Set(["UNPAID", "PAID", "REFUNDED"]);

function extractOrderProof(request: Request): { token: string; phone: string } {
  const { searchParams } = new URL(request.url);
  const token = (searchParams.get("token") || request.headers.get("x-order-token") || "").trim();
  const phone = (searchParams.get("phone") || request.headers.get("x-order-phone") || "").replace(/[^\d]/g, "");
  return { token, phone };
}

function isOrderOwner(order: Order, proof: { token: string; phone: string }): boolean {
  if (proof.token && order.trackingToken && safeEqualStrings(proof.token, order.trackingToken)) {
    return true;
  }
  const orderDigits = (order.recipientPhone || "").replace(/[^\d]/g, "");
  if (proof.phone && proof.phone.length >= 9 && orderDigits && safeEqualStrings(proof.phone, orderDigits)) {
    return true;
  }
  return false;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const order = await getOrderByIdFromMySql(id);

  if (!order) {
    return NextResponse.json(
      { success: false, message: "Không tìm thấy đơn hàng" },
      { status: 404 }
    );
  }

  const staff = await getAuthenticatedStaff(request);
  const proof = extractOrderProof(request);
  const hasFullAccess =
    Boolean(staff && (staff.role === "SUPER_ADMIN" || staff.permissions.includes("orders.view"))) ||
    isOrderOwner(order, proof);

  if (!hasFullAccess) {
    const ip = getTrustedClientIp(request);
    const viewRl = await consumeRateLimit(`orders:view:${ip}`, 25, 60 * 1000);
    if (!viewRl.allowed) {
      return createRateLimitResponse(
        viewRl.retryAfterSeconds,
        `Bạn đã truy vấn thông tin đơn hàng quá nhiều lần. Vui lòng thử lại sau ${viewRl.retryAfterSeconds} giây.`
      );
    }
  }

  const settings = await getBusinessSettingsFromMySql();

  const responseOrder: Order = hasFullAccess
    ? { ...order, trackingToken: undefined }
    : {
        ...order,
        recipientName: maskPersonName(order.recipientName),
        recipientPhone: maskPhone(order.recipientPhone),
        companyName: undefined,
        buildingName: order.buildingName ? maskAddress(order.buildingName) : undefined,
        deliveryAddress: order.deliveryAddress ? maskAddress(order.deliveryAddress) : undefined,
        floorRoom: undefined,
        deliveryNotes: undefined,
        shipperName: order.shipperName ? maskPersonName(order.shipperName) : undefined,
        shipperPhone: order.shipperPhone ? maskPhone(order.shipperPhone) : undefined,
        trackingToken: undefined,
        items: (order.items || []).map((item) => ({
          ...item,
          recipientLabel: undefined,
          itemNotes: undefined,
        })),
      };

  return NextResponse.json({
    success: true,
    data: responseOrder,
    isOwner: hasFullAccess,
    settings,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffAuth(request, { permission: "orders.update_status" });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await request.json();

  const currentOrder = await getOrderByIdFromMySql(id);
  if (!currentOrder) {
    return NextResponse.json(
      { success: false, message: "Không tìm thấy đơn hàng" },
      { status: 404 }
    );
  }

  const targetStatus = body.status ? String(body.status) : currentOrder.status;
  if (!ALLOWED_STATUSES.has(targetStatus)) {
    return NextResponse.json(
      { success: false, message: "Trạng thái đơn hàng không hợp lệ." },
      { status: 400 }
    );
  }

  // Đổi trạng thái thanh toán hoặc phí ship chỉ dành cho SUPER_ADMIN / STORE_MANAGER / CASHIER
  const isFinancialChange = body.paymentStatus !== undefined || body.deliveryFee !== undefined;
  if (
    isFinancialChange &&
    !["SUPER_ADMIN", "STORE_MANAGER", "CASHIER"].includes(auth.staff.role)
  ) {
    return NextResponse.json(
      { success: false, message: "Chỉ Chủ quán, Quản lý hoặc Thu ngân mới có quyền sửa thanh toán và phí giao hàng." },
      { status: 403 }
    );
  }

  if (body.paymentStatus !== undefined && !ALLOWED_PAYMENT_STATUSES.has(String(body.paymentStatus))) {
    return NextResponse.json(
      { success: false, message: "Trạng thái thanh toán không hợp lệ." },
      { status: 400 }
    );
  }

  let validatedDeliveryFee: number | undefined = undefined;
  if (body.deliveryFee !== undefined) {
    const parsedFee = Number(body.deliveryFee);
    if (!Number.isFinite(parsedFee) || parsedFee < 0 || parsedFee > 500000) {
      return NextResponse.json(
        { success: false, message: "Phí giao hàng phải nằm trong khoảng từ 0đ đến 500.000đ." },
        { status: 400 }
      );
    }
    validatedDeliveryFee = Math.round(parsedFee);
  }

  // Nếu xác nhận đã thanh toán khi đơn đang chờ thanh toán, tự động chuyển sang CONFIRMED (trừ khi đã gửi status khác)
  const effectiveStatus =
    body.paymentStatus === "PAID" && currentOrder.status === "PENDING_PAYMENT" && !body.status
      ? "CONFIRMED"
      : targetStatus;

  const ok = await updateOrderStatusInMySql(currentOrder.id, effectiveStatus, {
    baristaNotes: body.baristaNotes !== undefined ? String(body.baristaNotes).slice(0, 300) : undefined,
    paymentStatus: body.paymentStatus !== undefined ? String(body.paymentStatus) : undefined,
    shipperName: body.shipperName !== undefined ? String(body.shipperName).trim().slice(0, 100) : undefined,
    shipperPhone: body.shipperPhone !== undefined ? String(body.shipperPhone).trim().slice(0, 20) : undefined,
    estimatedDeliveryTime:
      body.estimatedDeliveryTime !== undefined ? String(body.estimatedDeliveryTime).trim().slice(0, 80) : undefined,
    trackingNotes: body.trackingNotes !== undefined ? String(body.trackingNotes).trim().slice(0, 300) : undefined,
    deliveryNotes: body.deliveryNotes !== undefined ? String(body.deliveryNotes).trim().slice(0, 300) : undefined,
    deliveryFee: validatedDeliveryFee,
  });

  if (!ok) {
    return NextResponse.json(
      { success: false, message: "Lỗi cập nhật đơn hàng." },
      { status: 500 }
    );
  }

  const updatedOrder = await getOrderByIdFromMySql(currentOrder.id);

  // Ghi Nhật Ký Kiểm Toán cho thay đổi tài chính (thanh toán / phí ship) hoặc hủy đơn
  if (isFinancialChange || effectiveStatus === "CANCELLED") {
    const ip = getTrustedClientIp(request);
    const changes: string[] = [];
    if (body.paymentStatus !== undefined && body.paymentStatus !== currentOrder.paymentStatus) {
      changes.push(`Thanh toán: ${currentOrder.paymentStatus} -> ${body.paymentStatus}`);
    }
    if (validatedDeliveryFee !== undefined && validatedDeliveryFee !== currentOrder.deliveryFee) {
      changes.push(
        `Phí ship: ${currentOrder.deliveryFee.toLocaleString("vi-VN")}đ -> ${validatedDeliveryFee.toLocaleString("vi-VN")}đ`
      );
    }
    if (effectiveStatus !== currentOrder.status) {
      changes.push(`Trạng thái: ${currentOrder.status} -> ${effectiveStatus}`);
    }

    if (changes.length > 0) {
      await recordAuditLogInMySql({
        actorId: auth.staff.id,
        actorUsername: auth.staff.username,
        actorRole: auth.staff.role,
        action:
          body.paymentStatus !== undefined
            ? "ORDER_PAYMENT_UPDATED"
            : validatedDeliveryFee !== undefined
            ? "ORDER_DELIVERY_FEE_UPDATED"
            : "ORDER_STATUS_UPDATED",
        targetType: "ORDER",
        targetId: currentOrder.orderCode,
        summary: `Đơn ${currentOrder.orderCode}: ${changes.join(" | ")}`,
        metadata: {
          orderId: currentOrder.id,
          oldTotal: currentOrder.totalAmount,
          newTotal: updatedOrder?.totalAmount,
        },
        ipAddress: ip,
      });
    }
  }

  return NextResponse.json({
    success: true,
    message: "Cập nhật đơn hàng thành công",
    data: updatedOrder ? { ...updatedOrder, trackingToken: undefined } : null,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfError = verifySameOriginCsrf(request);
  if (csrfError) return csrfError;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const reason = (searchParams.get("reason") || "Hủy đơn hàng").trim().slice(0, 200);
  const ip = getTrustedClientIp(request);

  const currentOrder = await getOrderByIdFromMySql(id);
  if (!currentOrder) {
    return NextResponse.json(
      { success: false, message: "Không tìm thấy đơn hàng" },
      { status: 404 }
    );
  }

  if (currentOrder.status === "COMPLETED") {
    return NextResponse.json(
      { success: false, message: "Không thể hủy đơn hàng đã hoàn tất." },
      { status: 400 }
    );
  }
  if (currentOrder.status === "CANCELLED") {
    return NextResponse.json({
      success: true,
      message: "Đơn hàng đã được hủy trước đó.",
      data: { ...currentOrder, trackingToken: undefined },
    });
  }

  const staff = await getAuthenticatedStaff(request);
  const isAuthorizedStaff = Boolean(
    staff && (staff.role === "SUPER_ADMIN" || staff.permissions.includes("orders.cancel"))
  );

  if (!isAuthorizedStaff) {
    const cancelRl = await consumeRateLimit(`orders:cancel:${ip}`, 10, 60 * 1000);
    if (!cancelRl.allowed) {
      return createRateLimitResponse(cancelRl.retryAfterSeconds);
    }

    // Khách hàng chỉ được tự hủy khi cung cấp đúng trackingToken/SĐT VÀ đơn còn PENDING_PAYMENT + UNPAID
    const proof = extractOrderProof(request);
    if (!isOrderOwner(currentOrder, proof)) {
      return NextResponse.json(
        { success: false, message: "Bạn không có quyền hủy đơn hàng này. Vui lòng liên hệ hotline quán." },
        { status: 401 }
      );
    }

    if (currentOrder.status !== "PENDING_PAYMENT" || currentOrder.paymentStatus === "PAID") {
      return NextResponse.json(
        {
          success: false,
          message:
            "Đơn hàng đã được xác nhận hoặc đã thanh toán nên không thể tự hủy. Vui lòng gọi hotline quán để được hỗ trợ.",
        },
        { status: 403 }
      );
    }
  }

  await updateOrderStatusInMySql(currentOrder.id, "CANCELLED", {
    trackingNotes: reason,
  });

  await recordAuditLogInMySql({
    actorId: isAuthorizedStaff && staff ? staff.id : null,
    actorUsername: isAuthorizedStaff && staff ? staff.username : "customer",
    actorRole: isAuthorizedStaff && staff ? staff.role : "CUSTOMER",
    action: "ORDER_CANCELLED",
    targetType: "ORDER",
    targetId: currentOrder.orderCode,
    summary: `Hủy đơn ${currentOrder.orderCode} (${reason})`,
    metadata: { orderId: currentOrder.id, previousStatus: currentOrder.status },
    ipAddress: ip,
  });

  const updatedOrder = await getOrderByIdFromMySql(currentOrder.id);

  return NextResponse.json({
    success: true,
    message: "Hủy đơn hàng thành công",
    data: updatedOrder ? { ...updatedOrder, trackingToken: undefined } : null,
  });
}
