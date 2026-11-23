import { NextResponse } from "next/server";
import { getPromotionByCodeFromMySql, calculatePromotionDiscount } from "@/lib/mysql";
import { getTrustedClientIp } from "@/lib/serverAuth";
import { consumeRateLimit, createRateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ip = getTrustedClientIp(request);
    const rl = await consumeRateLimit(`promo:validate:${ip}`, 15, 60 * 1000);
    if (!rl.allowed) {
      return createRateLimitResponse(
        rl.retryAfterSeconds,
        `Bạn đã thử mã khuyến mãi quá nhiều lần. Vui lòng thử lại sau ${rl.retryAfterSeconds} giây.`
      );
    }

    const body = await request.json();
    const { code, subtotalAmount, deliveryFee } = body;

    if (!code || typeof code !== "string" || !code.trim()) {
      return NextResponse.json(
        { valid: false, message: "Vui lòng nhập mã giảm giá" },
        { status: 400 }
      );
    }

    const orderAmount = Math.max(0, Number(subtotalAmount) || 0);
    const shipFee = Math.max(0, Number(deliveryFee) || 0);

    const promotion = await getPromotionByCodeFromMySql(code.trim().slice(0, 40));
    if (!promotion) {
      return NextResponse.json(
        { valid: false, message: `Mã giảm giá "${code.trim().toUpperCase()}" không hợp lệ hoặc không tồn tại.` },
        { status: 200 }
      );
    }

    const calculation = calculatePromotionDiscount(promotion, orderAmount, shipFee);

    if (!calculation.valid) {
      return NextResponse.json(
        {
          valid: false,
          code: promotion.code,
          name: promotion.name,
          message: calculation.message || "Không đủ điều kiện áp dụng mã này.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      valid: true,
      code: promotion.code,
      name: promotion.name,
      discountType: promotion.discountType,
      discountValue: promotion.discountValue,
      discountAmount: calculation.discountAmount,
      message: `Đã áp dụng mã "${promotion.code}": Giảm ${new Intl.NumberFormat("vi-VN").format(calculation.discountAmount)}đ`,
    });
  } catch (error) {
    console.error("[Promotions Validate Error]", error);
    return NextResponse.json(
      { valid: false, message: "Lỗi xử lý mã giảm giá." },
      { status: 500 }
    );
  }
}
