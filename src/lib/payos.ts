import crypto from "node:crypto";
import { Order } from "@/types";
import { safeEqualStrings } from "@/lib/password";

const PAYOS_API_BASE = "https://api-merchant.payos.vn";

export interface PayOsConfig {
  clientId: string;
  apiKey: string;
  checksumKey: string;
  webhookUrl: string;
  isConfigured: boolean;
}

export interface PayOsPaymentLinkData {
  bin: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  description: string;
  orderCode: number;
  currency: string;
  paymentLinkId: string;
  status: string;
  checkoutUrl: string;
  qrCode: string;
}

export interface PayOsTransactionItem {
  reference: string;
  amount: number;
  accountNumber?: string;
  description?: string;
  transactionDateTime?: string;
  virtualAccountNumber?: string;
  virtualAccountName?: string;
  counterAccountBankName?: string;
  counterAccountName?: string;
  counterAccountNumber?: string;
}

export interface PayOsPaymentStatusInfo {
  id: string;
  orderCode: number;
  amount: number;
  amountPaid: number;
  amountRemaining: number;
  status: string;
  transactions: PayOsTransactionItem[];
  raw: any;
}

function cleanEnv(val?: string): string {
  if (!val) return "";
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function getPayOsConfig(): PayOsConfig {
  const clientId = cleanEnv(process.env.PAYOS_CLIENT_ID);
  const apiKey = cleanEnv(process.env.PAYOS_API_KEY);
  const checksumKey = cleanEnv(process.env.PAYOS_CHECKSUM_KEY);
  const siteUrl = cleanEnv(process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL) || "http://localhost:3000";
  const webhookUrl =
    cleanEnv(process.env.PAYOS_WEBHOOK_URL) || `${siteUrl.replace(/\/+$/, "")}/api/webhooks/payos`;

  return {
    clientId,
    apiKey,
    checksumKey,
    webhookUrl,
    isConfigured: Boolean(clientId && apiKey && checksumKey),
  };
}

function sortObjDataByKey(obj: Record<string, any>): Record<string, any> {
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, any>>((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
}

function convertObjToQueryStr(obj: Record<string, any>): string {
  return Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .map((key) => {
      let value = obj[key];
      if (value && Array.isArray(value)) {
        value = JSON.stringify(
          value.map((val) => (val && typeof val === "object" ? sortObjDataByKey(val) : val))
        );
      } else if (value && typeof value === "object") {
        value = JSON.stringify(sortObjDataByKey(value));
      }
      if ([null, undefined, "undefined", "null"].includes(value)) {
        value = "";
      }
      return `${key}=${value}`;
    })
    .join("&");
}

/**
 * Tính chữ ký HMAC-SHA256 chuẩn payOS cho object `data` (dùng cho Webhook & Payment Request).
 */
export function computePayOsDataSignature(
  data: Record<string, any>,
  checksumKey: string
): string {
  const sorted = sortObjDataByKey(data);
  const queryStr = convertObjToQueryStr(sorted);
  return crypto.createHmac("sha256", checksumKey).update(queryStr).digest("hex");
}

export function verifyPayOsWebhookSignature(
  data: Record<string, any> | null | undefined,
  signature: string | null | undefined,
  checksumKey: string
): boolean {
  if (!data || typeof data !== "object" || !signature || !checksumKey) {
    return false;
  }
  const expected = computePayOsDataSignature(data, checksumKey);
  return safeEqualStrings(expected.toLowerCase(), String(signature).trim().toLowerCase());
}

/**
 * Sinh mã orderCode dạng số nguyên dương cho payOS từ mã đơn hàng của quán.
 * Ví dụ: "CF2611-003" -> 2611003, "CX-1024" -> 1024.
 */
export function derivePayOsNumericOrderCode(orderCode: string): number {
  const digits = String(orderCode || "").replace(/[^\d]/g, "");
  if (digits.length >= 4 && digits.length <= 15) {
    const parsed = Number(digits);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const hashHex = crypto.createHash("sha256").update(String(orderCode)).digest("hex").slice(0, 10);
  return (parseInt(hashHex, 16) % 900000000) + 100000000;
}

/**
 * Suy ngược các ứng viên mã đơn Cà Xòi từ numeric orderCode của payOS (VD: 2611003 -> "CF2611-003").
 */
export function buildOrderCodeCandidatesFromPayOsNumeric(numericCode: number | string | null | undefined): string[] {
  const digits = String(numericCode ?? "").replace(/[^\d]/g, "");
  if (!digits) return [];
  const candidates: string[] = [];
  if (digits.length >= 7) {
    candidates.push(`CF${digits.slice(0, 4)}-${digits.slice(4)}`);
  }
  if (digits.length >= 3 && digits.length <= 6) {
    candidates.push(`CX-${digits}`);
  }
  return candidates;
}

/**
 * Tạo (hoặc lấy lại nếu đã tồn tại) liên kết thanh toán & mã QR động trên payOS.
 */
export async function createOrGetPayOsPaymentLink(params: {
  order: Order;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ ok: true; data: PayOsPaymentLinkData } | { ok: false; message: string; code?: string }> {
  const cfg = getPayOsConfig();
  if (!cfg.isConfigured) {
    return { ok: false, message: "payOS chưa được cấu hình (thiếu Client ID / API Key / Checksum Key)." };
  }

  const numericOrderCode = derivePayOsNumericOrderCode(params.order.orderCode);
  const amount = Math.max(2000, Math.round(Number(params.order.totalAmount) || 0));
  // payOS giới hạn description <= 25 ký tự cho tài khoản ngân hàng không liên kết
  const description = String(params.order.orderCode || `DH ${numericOrderCode}`).slice(0, 25);

  const signatureData = {
    amount,
    cancelUrl: params.cancelUrl,
    description,
    orderCode: numericOrderCode,
    returnUrl: params.returnUrl,
  };
  const signature = computePayOsDataSignature(signatureData, cfg.checksumKey);

  const items = (params.order.items || []).slice(0, 20).map((item) => ({
    name: `${item.productName}${item.variantName ? ` (${item.variantName})` : ""}`.slice(0, 60),
    quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
    price: Math.max(0, Math.round(Number(item.unitPrice) || 0)),
  }));

  const body = {
    orderCode: numericOrderCode,
    amount,
    description,
    buyerName: (params.order.recipientName || "").slice(0, 80) || undefined,
    buyerPhone: (params.order.recipientPhone || "").slice(0, 20) || undefined,
    items: items.length > 0 ? items : undefined,
    cancelUrl: params.cancelUrl,
    returnUrl: params.returnUrl,
    signature,
  };

  const res = await fetch(`${PAYOS_API_BASE}/v2/payment-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": cfg.clientId,
      "x-api-key": cfg.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });

  const json = await res.json().catch(() => null);
  if (json?.code === "00" && json?.data?.qrCode) {
    return { ok: true, data: json.data as PayOsPaymentLinkData };
  }

  // Mã "231" của payOS: Đơn thanh toán với orderCode này đã tồn tại -> lấy lại thông tin link cũ
  if (String(json?.code) === "231") {
    const existingRes = await fetch(`${PAYOS_API_BASE}/v2/payment-requests/${numericOrderCode}`, {
      method: "GET",
      headers: {
        "x-client-id": cfg.clientId,
        "x-api-key": cfg.apiKey,
      },
      signal: AbortSignal.timeout(10000),
    });
    const existingJson = await existingRes.json().catch(() => null);
    if (existingJson?.code === "00" && existingJson?.data) {
      const d = existingJson.data;
      return {
        ok: true,
        data: {
          bin: String(d.bin || ""),
          accountNumber: String(d.accountNumber || ""),
          accountName: String(d.accountName || ""),
          amount: Number(d.amount || amount),
          description: String(d.description || description),
          orderCode: Number(d.orderCode || numericOrderCode),
          currency: String(d.currency || "VND"),
          paymentLinkId: String(d.id || d.paymentLinkId || ""),
          status: String(d.status || "PENDING"),
          checkoutUrl: String(d.checkoutUrl || `https://pay.payos.vn/web/${d.id || ""}`),
          qrCode: String(d.qrCode || ""),
        },
      };
    }
  }

  return {
    ok: false,
    code: String(json?.code || res.status),
    message: json?.desc || `Không thể tạo mã thanh toán payOS (HTTP ${res.status}).`,
  };
}

/**
 * Gọi API chính thức của payOS để đăng ký & xác thực Webhook URL.
 */
export async function confirmPayOsWebhookUrl(
  webhookUrl: string
): Promise<{ ok: boolean; message: string; code?: string; raw?: any }> {
  const cfg = getPayOsConfig();
  if (!cfg.isConfigured) {
    return { ok: false, message: "Vui lòng lưu đủ Client ID, API Key và Checksum Key trước khi xác thực Webhook." };
  }

  const cleanUrl = webhookUrl.trim();
  if (!/^https?:\/\/.+/i.test(cleanUrl)) {
    return { ok: false, message: "Webhook URL phải bắt đầu bằng https:// (hoặc http://)." };
  }

  try {
    const res = await fetch(`${PAYOS_API_BASE}/confirm-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": cfg.clientId,
        "x-api-key": cfg.apiKey,
      },
      body: JSON.stringify({ webhookUrl: cleanUrl }),
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.code === "00") {
      return {
        ok: true,
        code: "00",
        message: "payOS đã xác thực và kích hoạt Webhook URL thành công!",
        raw: json,
      };
    }
    return {
      ok: false,
      code: String(json?.code || res.status),
      message: json?.desc || `payOS từ chối xác thực Webhook (HTTP ${res.status}). Đảm bảo URL là HTTPS công khai.`,
      raw: json,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `Lỗi kết nối tới payOS: ${err?.message || "Timeout"}`,
    };
  }
}


/**
 * Truy vấn trực tiếp trạng thái đơn hàng từ payOS (`GET /v2/payment-requests/{orderCode}`).
 */
export async function getPayOsPaymentLinkInfo(
  numericOrderCode: number
): Promise<{ ok: true; data: PayOsPaymentStatusInfo } | { ok: false; code?: string; message: string }> {
  const cfg = getPayOsConfig();
  if (!cfg.isConfigured) {
    return { ok: false, message: "payOS chưa được cấu hình." };
  }

  try {
    const res = await fetch(`${PAYOS_API_BASE}/v2/payment-requests/${numericOrderCode}`, {
      method: "GET",
      headers: {
        "x-client-id": cfg.clientId,
        "x-api-key": cfg.apiKey,
      },
      signal: AbortSignal.timeout(5000),
    });

    const json = await res.json().catch(() => null);
    if (res.ok && json?.code === "00" && json?.data) {
      const d = json.data;
      return {
        ok: true,
        data: {
          id: String(d.id || ""),
          orderCode: Number(d.orderCode || numericOrderCode),
          amount: Number(d.amount || 0),
          amountPaid: Number(d.amountPaid || 0),
          amountRemaining: Number(d.amountRemaining || 0),
          status: String(d.status || "PENDING").toUpperCase(),
          transactions: Array.isArray(d.transactions) ? d.transactions : [],
          raw: json,
        },
      };
    }

    return {
      ok: false,
      code: String(json?.code || res.status),
      message: json?.desc || `Không lấy được trạng thái payOS (HTTP ${res.status}).`,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || "Lỗi kết nối API payOS.",
    };
  }
}
