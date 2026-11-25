import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getTrustedClientIp, requireStaffAuth } from "@/lib/serverAuth";
import { recordAuditLogInMySql } from "@/lib/mysql";
import {
  computePayOsDataSignature,
  confirmPayOsWebhookUrl,
  getPayOsConfig,
  verifyPayOsWebhookSignature,
} from "@/lib/payos";

export const dynamic = "force-dynamic";

const ENV_PATH = path.join(process.cwd(), ".env");

function hasControlChars(val: string): boolean {
  return /[\r\n\0]/.test(val);
}

function updateEnvVariable(content: string, key: string, value: string): string {
  const safeVal = value.replace(/[\r\n\0]/g, "");
  const regex = new RegExp(`^${key}=.*$`, "m");
  const escaped = safeVal.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const formattedValue = /[\s#"'$]/.test(safeVal) ? `"${escaped}"` : safeVal;

  if (regex.test(content)) {
    return content.replace(regex, `${key}=${formattedValue}`);
  }
  return content.trimEnd() + `\n${key}=${formattedValue}\n`;
}

function maskKey(val: string): string {
  if (!val) return "";
  if (val.length <= 8) return "••••••••";
  return `${val.slice(0, 4)}••••••••${val.slice(-4)}`;
}

export async function GET(request: Request) {
  const auth = await requireStaffAuth(request, {
    roles: ["SUPER_ADMIN", "STORE_MANAGER"],
  });
  if (!auth.ok) return auth.response;

  const cfg = getPayOsConfig();
  return NextResponse.json({
    success: true,
    data: {
      clientId: cfg.clientId,
      hasApiKey: Boolean(cfg.apiKey),
      apiKeyMasked: maskKey(cfg.apiKey),
      hasChecksumKey: Boolean(cfg.checksumKey),
      checksumKeyMasked: maskKey(cfg.checksumKey),
      webhookUrl: cfg.webhookUrl,
      isConfigured: cfg.isConfigured,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireStaffAuth(request, { roles: ["SUPER_ADMIN"] });
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const rawClientId = typeof body.clientId === "string" ? body.clientId : "";
    const rawApiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    const rawChecksumKey = typeof body.checksumKey === "string" ? body.checksumKey : "";
    const rawWebhookUrl = typeof body.webhookUrl === "string" ? body.webhookUrl : "";

    if (
      hasControlChars(rawClientId) ||
      hasControlChars(rawApiKey) ||
      hasControlChars(rawChecksumKey) ||
      hasControlChars(rawWebhookUrl)
    ) {
      return NextResponse.json(
        { success: false, message: "Dữ liệu cấu hình payOS chứa ký tự không hợp lệ." },
        { status: 400 }
      );
    }

    const current = getPayOsConfig();
    const clientId = rawClientId.trim();
    const apiKey = rawApiKey.trim() || current.apiKey;
    const checksumKey = rawChecksumKey.trim() || current.checksumKey;
    const webhookUrl = rawWebhookUrl.trim() || current.webhookUrl;

    if (!clientId || clientId.length < 8) {
      return NextResponse.json(
        { success: false, message: "Vui lòng nhập PAYOS_CLIENT_ID hợp lệ (từ my.payos.vn)." },
        { status: 400 }
      );
    }
    if (!apiKey || apiKey.length < 16) {
      return NextResponse.json(
        { success: false, message: "Vui lòng nhập PAYOS_API_KEY hợp lệ (từ my.payos.vn)." },
        { status: 400 }
      );
    }
    if (!checksumKey || checksumKey.length < 16) {
      return NextResponse.json(
        { success: false, message: "Vui lòng nhập PAYOS_CHECKSUM_KEY hợp lệ (từ my.payos.vn)." },
        { status: 400 }
      );
    }
    if (webhookUrl && !/^https?:\/\/.+/i.test(webhookUrl)) {
      return NextResponse.json(
        { success: false, message: "Webhook URL phải bắt đầu bằng https:// hoặc http://." },
        { status: 400 }
      );
    }

    // 1. Cập nhật ngay vào runtime process.env
    process.env.PAYOS_CLIENT_ID = clientId;
    process.env.PAYOS_API_KEY = apiKey;
    process.env.PAYOS_CHECKSUM_KEY = checksumKey;
    process.env.PAYOS_WEBHOOK_URL = webhookUrl;

    // 2. Ghi vào file .env
    try {
      let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
      content = updateEnvVariable(content, "PAYOS_CLIENT_ID", clientId);
      content = updateEnvVariable(content, "PAYOS_API_KEY", apiKey);
      content = updateEnvVariable(content, "PAYOS_CHECKSUM_KEY", checksumKey);
      content = updateEnvVariable(content, "PAYOS_WEBHOOK_URL", webhookUrl);
      fs.writeFileSync(ENV_PATH, content, "utf-8");
    } catch (fileErr: any) {
      console.error("[payOS Config API] Lỗi ghi file .env:", fileErr?.message);
    }

    await recordAuditLogInMySql({
      actorId: auth.staff.id,
      actorUsername: auth.staff.username,
      actorRole: auth.staff.role,
      action: "PAYOS_CONFIG_UPDATED",
      targetType: "SYSTEM",
      summary: `Cập nhật cấu hình payOS (Client ID: ${maskKey(clientId)}, Webhook: ${webhookUrl})`,
      ipAddress: getTrustedClientIp(request),
    });

    return NextResponse.json({
      success: true,
      message: "Đã lưu cấu hình payOS thành công!",
      data: {
        clientId,
        hasApiKey: true,
        apiKeyMasked: maskKey(apiKey),
        hasChecksumKey: true,
        checksumKeyMasked: maskKey(checksumKey),
        webhookUrl,
        isConfigured: true,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Lỗi lưu cấu hình payOS." },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireStaffAuth(request, { roles: ["SUPER_ADMIN"] });
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").toUpperCase();
    const cfg = getPayOsConfig();

    if (action === "CONFIRM_WEBHOOK") {
      const targetUrl = String(body.webhookUrl || cfg.webhookUrl || "").trim();
      const result = await confirmPayOsWebhookUrl(targetUrl);

      await recordAuditLogInMySql({
        actorId: auth.staff.id,
        actorUsername: auth.staff.username,
        actorRole: auth.staff.role,
        action: "PAYOS_WEBHOOK_CONFIRMED",
        targetType: "SYSTEM",
        summary: `Xác thực Webhook payOS (${targetUrl}): ${result.ok ? "Thành công" : result.message}`,
        ipAddress: getTrustedClientIp(request),
      });

      return NextResponse.json(
        {
          success: result.ok,
          message: result.message,
          code: result.code,
        },
        { status: result.ok ? 200 : 400 }
      );
    }

    if (action === "TEST_SIGNATURE") {
      if (!cfg.isConfigured) {
        return NextResponse.json(
          { success: false, message: "Vui lòng lưu đủ 3 khóa payOS trước khi kiểm tra chữ ký." },
          { status: 400 }
        );
      }

      const sampleData = {
        orderCode: 123,
        amount: 3000,
        description: "VQRIO123",
        accountNumber: "12345678",
        reference: "TF230204212323",
        transactionDateTime: new Date().toISOString().replace("T", " ").slice(0, 19),
        currency: "VND",
        paymentLinkId: "124c33293c43417ab7879e14c8d9eb18",
        code: "00",
        desc: "Thành công",
      };
      const signature = computePayOsDataSignature(sampleData, cfg.checksumKey);
      const verified = verifyPayOsWebhookSignature(sampleData, signature, cfg.checksumKey);

      return NextResponse.json({
        success: verified,
        message: verified
          ? "Chữ ký HMAC-SHA256 hợp lệ 100%! Endpoint /api/webhooks/payos đã sẵn sàng nhận webhook từ payOS."
          : "Kiểm tra chữ ký thất bại.",
        data: {
          webhookEndpoint: cfg.webhookUrl,
          sampleSignaturePrefix: `${signature.slice(0, 16)}...`,
        },
      });
    }

    return NextResponse.json(
      { success: false, message: "Hành động không hợp lệ." },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "Lỗi kiểm tra payOS." },
      { status: 500 }
    );
  }
}
