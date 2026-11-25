import { NextResponse } from "next/server";
import {
  assignBankTransactionToOrderInMySql,
  getOrderByIdFromMySql,
  recordAuditLogInMySql,
} from "@/lib/mysql";
import { getTrustedClientIp, requireStaffAuth } from "@/lib/serverAuth";
import { sendOrderNotificationEmail } from "@/lib/mail";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireStaffAuth(request, {
    roles: ["SUPER_ADMIN", "STORE_MANAGER", "CASHIER"],
  });
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const bankTransactionId = Number(body.bankTransactionId);
    const orderIdOrCode = String(body.orderCode || body.orderId || "").trim();

    if (!Number.isFinite(bankTransactionId) || bankTransactionId <= 0) {
      return NextResponse.json(
        { success: false, message: "Thiếu mã giao dịch ngân hàng hợp lệ." },
        { status: 400 }
      );
    }

    if (!orderIdOrCode) {
      return NextResponse.json(
        { success: false, message: "Vui lòng chọn đơn hàng cần gán giao dịch." },
        { status: 400 }
      );
    }

    const result = await assignBankTransactionToOrderInMySql({
      bankTransactionId,
      orderIdOrCode,
      staffUsername: auth.staff.username,
      staffFullName: auth.staff.fullName,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: result.statusCode || 400 }
      );
    }

    const ip = getTrustedClientIp(request);
    await recordAuditLogInMySql({
      actorId: auth.staff.id,
      actorUsername: auth.staff.username,
      actorRole: auth.staff.role,
      action: "BANK_TX_MANUAL_MATCH",
      targetType: "ORDER",
      targetId: result.orderCode,
      summary: `Gán giao dịch #${result.sepayId} (+${result.transferAmount.toLocaleString("vi-VN")}đ) vào đơn ${result.orderCode} -> ${result.paymentStatus}`,
      metadata: {
        bankTransactionId,
        sepayId: result.sepayId,
        orderId: result.orderId,
        orderCode: result.orderCode,
        transferAmount: result.transferAmount,
        paidAmount: result.paidAmount,
        totalAmount: result.totalAmount,
        txStatus: result.txStatus,
        paymentStatus: result.paymentStatus,
      },
      ipAddress: ip,
    });

    if (result.paymentStatus === "PAID") {
      getOrderByIdFromMySql(result.orderId)
        .then((updatedOrder) => {
          if (updatedOrder) return sendOrderNotificationEmail(updatedOrder);
        })
        .catch((err) => console.error("[Manual Match] Email error:", err));
    }

    return NextResponse.json({
      success: true,
      message:
        result.paymentStatus === "PAID"
          ? `Đã gán giao dịch #${result.sepayId} vào đơn #${result.orderCode} và tự động xác nhận đơn!`
          : `Đã gán giao dịch #${result.sepayId} vào đơn #${result.orderCode} (đã nhận ${result.paidAmount.toLocaleString("vi-VN")}đ / ${result.totalAmount.toLocaleString("vi-VN")}đ - Chuyển thiếu).`,
      data: result,
    });
  } catch (error) {
    console.error("[Admin Bank Transactions Match POST Error]", error);
    return NextResponse.json(
      { success: false, message: "Lỗi khi gán giao dịch vào đơn hàng." },
      { status: 500 }
    );
  }
}
