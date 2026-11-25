import { NextResponse } from "next/server";
import { getOrderByIdFromMySql } from "@/lib/mysql";
import { syncOrderPaymentWithPayOs } from "@/lib/payosSync";
import { getTrustedClientIp, verifySameOriginCsrf } from "@/lib/serverAuth";
import { consumeRateLimit, createRateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const csrfError = verifySameOriginCsrf(request);
  if (csrfError) return csrfError;

  try {
    const ip = getTrustedClientIp(request);
    const rl = await consumeRateLimit(`payos:sync:${ip}`, 20, 60 * 1000);
    if (!rl.allowed) {
      return createRateLimitResponse(
        rl.retryAfterSeconds,
        `Bạn kiểm tra quá nhanh. Vui lòng thử lại sau ${rl.retryAfterSeconds} giây.`
      );
    }

    const body = await request.json().catch(() => ({}));
    const orderIdOrCode = String(body.orderId || body.orderCode || "").trim();
    if (!orderIdOrCode) {
      return NextResponse.json(
        { success: false, message: "Thiếu mã đơn hàng." },
        { status: 400 }
      );
    }

    const order = await getOrderByIdFromMySql(orderIdOrCode);
    if (!order) {
      return NextResponse.json(
        { success: false, message: "Không tìm thấy đơn hàng." },
        { status: 404 }
      );
    }

    const result = await syncOrderPaymentWithPayOs(order, {
      force: true,
      ipAddress: ip,
    });

    return NextResponse.json({
      success: true,
      paid: result.paid,
      updated: result.updated,
      payosStatus: result.payosStatus || null,
      amountPaid: result.amountPaid ?? result.order.paidAmount ?? 0,
      message: result.message || (result.paid ? "Đơn hàng đã được thanh toán!" : "Chưa nhận được thanh toán."),
      data: {
        id: result.order.id,
        orderCode: result.order.orderCode,
        status: result.order.status,
        paymentStatus: result.order.paymentStatus,
        paidAmount: result.order.paidAmount,
      },
    });
  } catch (error: any) {
    console.error("[payOS Sync POST Error]", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Lỗi đồng bộ trạng thái payOS." },
      { status: 500 }
    );
  }
}
