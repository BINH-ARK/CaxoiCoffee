import { NextResponse } from "next/server";
import { getOrderByIdFromMySql } from "@/lib/mysql";
import { createOrGetPayOsPaymentLink, getPayOsConfig } from "@/lib/payos";
import { isOrderPaidStatus } from "@/lib/paymentStatus";
import { getTrustedClientIp, verifySameOriginCsrf } from "@/lib/serverAuth";
import { consumeRateLimit, createRateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const csrfError = verifySameOriginCsrf(request);
  if (csrfError) return csrfError;

  try {
    const ip = getTrustedClientIp(request);
    const rl = await consumeRateLimit(`payos:create:${ip}`, 20, 60 * 1000);
    if (!rl.allowed) {
      return createRateLimitResponse(
        rl.retryAfterSeconds,
        `Bạn tạo mã thanh toán quá nhanh. Vui lòng thử lại sau ${rl.retryAfterSeconds} giây.`
      );
    }

    const cfg = getPayOsConfig();
    if (!cfg.isConfigured) {
      return NextResponse.json({
        success: false,
        configured: false,
        message: "payOS chưa được cấu hình.",
      });
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

    if (order.status === "CANCELLED" || isOrderPaidStatus(order.paymentStatus)) {
      return NextResponse.json({
        success: false,
        configured: true,
        message: "Đơn hàng đã thanh toán hoặc đã bị hủy.",
      });
    }

    const origin =
      request.headers.get("origin") ||
      process.env.APP_PUBLIC_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "http://localhost:3000";
    const orderPageUrl = `${origin.replace(/\/+$/, "")}/order/${encodeURIComponent(order.orderCode)}`;

    const result = await createOrGetPayOsPaymentLink({
      order,
      returnUrl: `${orderPageUrl}?payos=success`,
      cancelUrl: `${orderPageUrl}?payos=cancel`,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          configured: true,
          message: result.message,
          code: result.code,
        },
        { status: 502 }
      );
    }

    const qrImageUrl = result.data.qrCode
      ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=2&ecc=H&color=2D0819&bgcolor=FFFFFF&data=${encodeURIComponent(result.data.qrCode)}`
      : null;

    return NextResponse.json({
      success: true,
      configured: true,
      data: {
        ...result.data,
        qrImageUrl,
      },
    });
  } catch (error: any) {
    console.error("[payOS Create Link Error]", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Lỗi tạo mã thanh toán payOS." },
      { status: 500 }
    );
  }
}
