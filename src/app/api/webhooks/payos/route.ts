import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  getOrderByIdFromMySql,
  processBankWebhookInMySql,
  recordAuditLogInMySql,
} from "@/lib/mysql";
import {
  buildOrderCodeCandidatesFromPayOsNumeric,
  getPayOsConfig,
  verifyPayOsWebhookSignature,
} from "@/lib/payos";
import { extractOrderCodeCandidates } from "@/lib/paymentStatus";
import { getTrustedClientIp } from "@/lib/serverAuth";
import { sendOrderNotificationEmail } from "@/lib/mail";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const cfg = getPayOsConfig();
    if (!cfg.checksumKey) {
      return NextResponse.json(
        { success: false, message: "payOS chưa được cấu hình PAYOS_CHECKSUM_KEY trên máy chủ." },
        { status: 503 }
      );
    }

    let payload: Record<string, any>;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ success: true, ignored: true, reason: "INVALID_JSON" }, { status: 200 });
    }

    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ success: true, ignored: true, reason: "EMPTY_PAYLOAD" }, { status: 200 });
    }

    const data = payload.data && typeof payload.data === "object" ? payload.data : null;
    const signature = typeof payload.signature === "string" ? payload.signature.trim() : "";

    // 1. Xác thực chữ ký HMAC-SHA256 chuẩn payOS
    if (!verifyPayOsWebhookSignature(data, signature, cfg.checksumKey)) {
      return NextResponse.json(
        { success: false, message: "Unauthorized. Chữ ký payOS (signature) không hợp lệ." },
        { status: 401 }
      );
    }

    // 2. Bỏ qua & phản hồi 200 OK cho gói tin kiểm tra kết nối (Confirm Webhook) của payOS
    if (
      data &&
      (Number(data.orderCode) === 123 ||
        String(data.description || "").toUpperCase() === "VQRIO123")
    ) {
      return NextResponse.json(
        { success: true, verified: true, message: "payOS Webhook verified successfully." },
        { status: 200 }
      );
    }

    // 3. Chỉ xử lý giao dịch thành công (code === "00" và amount > 0)
    const isSuccessCode = String(payload.code || data?.code || "") === "00";
    if (!isSuccessCode || payload.success === false || !data) {
      return NextResponse.json(
        { success: true, ignored: true, reason: "NON_SUCCESS_PAYOS_EVENT" },
        { status: 200 }
      );
    }

    const transferAmount = Number(data.amount ?? 0);
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      return NextResponse.json(
        { success: true, ignored: true, reason: "NON_POSITIVE_AMOUNT" },
        { status: 200 }
      );
    }

    const description = String(data.description || "").trim();
    const numericOrderCode = data.orderCode !== undefined && data.orderCode !== null ? String(data.orderCode) : "";
    const referenceCode = data.reference ? String(data.reference).trim().slice(0, 128) : null;
    const accountNumber = data.accountNumber ? String(data.accountNumber).replace(/\s+/g, "").slice(0, 50) : null;
    const transactionDate = String(data.transactionDateTime || new Date().toISOString()).trim().slice(0, 64);

    const rawTxKey =
      referenceCode ||
      (data.paymentLinkId ? `${data.paymentLinkId}_${numericOrderCode}` : "") ||
      crypto
        .createHash("sha256")
        .update(`payos|${numericOrderCode}|${transactionDate}|${transferAmount}|${description}`)
        .digest("hex");
    const txId = `payos_${rawTxKey}`.slice(0, 128);

    // 4. Tách mã đơn hàng từ cả description lẫn numeric orderCode của payOS
    const orderCodeCandidates = Array.from(
      new Set([
        ...extractOrderCodeCandidates(description),
        ...buildOrderCodeCandidatesFromPayOsNumeric(numericOrderCode),
      ])
    );

    // 5. Thực thi đối soát nguyên tử trong MySQL (dùng chung bảng bank_transactions + orders)
    const result = await processBankWebhookInMySql({
      sepayId: txId,
      gateway: "payOS",
      transactionDate,
      accountNumber,
      transferType: "in",
      transferAmount,
      content: description || `payOS #${numericOrderCode}`,
      referenceCode,
      orderCodeCandidates,
      rawPayload: payload,
    });

    const ip = getTrustedClientIp(request);

    if (result.outcome === "MATCHED" && result.orderId && result.orderCode) {
      recordAuditLogInMySql({
        actorUsername: "webhook:payos",
        actorRole: "SYSTEM",
        action: "PAYOS_PAYMENT_MATCHED",
        targetType: "ORDER",
        targetId: result.orderCode,
        summary: `payOS tự động xác nhận ${transferAmount.toLocaleString("vi-VN")}đ cho đơn ${result.orderCode} (Ref: ${referenceCode || numericOrderCode})`,
        metadata: {
          txId,
          payosOrderCode: numericOrderCode,
          orderId: result.orderId,
          transferAmount,
          paidAmount: result.paidAmount,
          totalAmount: result.totalAmount,
          referenceCode,
        },
        ipAddress: ip,
      }).catch((err) => console.error("[payOS Webhook] Audit log error:", err));

      getOrderByIdFromMySql(result.orderId)
        .then((updatedOrder) => {
          if (updatedOrder) return sendOrderNotificationEmail(updatedOrder);
        })
        .catch((err) => console.error("[payOS Webhook] Email error:", err));
    } else if (result.outcome === "UNDERPAID" && result.orderCode) {
      recordAuditLogInMySql({
        actorUsername: "webhook:payos",
        actorRole: "SYSTEM",
        action: "PAYOS_PAYMENT_UNDERPAID",
        targetType: "ORDER",
        targetId: result.orderCode,
        summary: `payOS nhận thiếu tiền đơn ${result.orderCode}: +${transferAmount.toLocaleString("vi-VN")}đ (${Number(result.paidAmount || 0).toLocaleString("vi-VN")}đ / ${Number(result.totalAmount || 0).toLocaleString("vi-VN")}đ)`,
        metadata: {
          txId,
          payosOrderCode: numericOrderCode,
          transferAmount,
          paidAmount: result.paidAmount,
          totalAmount: result.totalAmount,
          shortfall: result.shortfall,
        },
        ipAddress: ip,
      }).catch((err) => console.error("[payOS Webhook] Audit log error:", err));
    } else if (result.outcome === "UNMATCHED") {
      recordAuditLogInMySql({
        actorUsername: "webhook:payos",
        actorRole: "SYSTEM",
        action: "PAYOS_TX_UNMATCHED",
        targetType: "BANK_TRANSACTION",
        targetId: txId,
        summary: `payOS nhận ${transferAmount.toLocaleString("vi-VN")}đ chưa khớp đơn hàng (ND: ${description.slice(0, 120)})`,
        metadata: { txId, payosOrderCode: numericOrderCode, transferAmount, description, orderCodeCandidates },
        ipAddress: ip,
      }).catch((err) => console.error("[payOS Webhook] Audit log error:", err));
    }

    return NextResponse.json(
      {
        success: true,
        outcome: result.outcome,
        orderCode: result.orderCode || null,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[payOS Webhook Error]", error);
    return NextResponse.json(
      { success: false, message: "Internal error processing payOS webhook" },
      { status: 500 }
    );
  }
}
