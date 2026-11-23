import { NextResponse } from "next/server";
import {
  createStaffInMySql,
  getStaffByUsernameFromMySql,
  recordAuditLogInMySql,
} from "@/lib/mysql";
import { safeEqualStrings } from "@/lib/password";
import { getTrustedClientIp, verifySameOriginCsrf } from "@/lib/serverAuth";
import { consumeRateLimit, createRateLimitResponse } from "@/lib/rateLimit";

const ALLOWED_REGISTER_ROLES = new Set([
  "SUPER_ADMIN",
  "STORE_MANAGER",
  "BARISTA",
  "CASHIER",
]);

export async function POST(request: Request) {
  const csrfError = verifySameOriginCsrf(request);
  if (csrfError) return csrfError;

  try {
    const ip = getTrustedClientIp(request);
    const rl = await consumeRateLimit(`auth:register:${ip}`, 8, 15 * 60 * 1000, 5 * 60 * 1000);
    if (!rl.allowed) {
      return createRateLimitResponse(
        rl.retryAfterSeconds,
        `Bạn thao tác đăng ký quá nhiều lần. Vui lòng thử lại sau ${rl.retryAfterSeconds} giây.`
      );
    }

    const body = await request.json();
    const fullName = String(body.fullName || "").trim();
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const confirmPassword = String(body.confirmPassword || "");
    const phone = String(body.phone || "").trim();
    const email = String(body.email || "").trim();
    const requestedRole = String(body.role || "SUPER_ADMIN").trim().toUpperCase();
    const inviteCode = String(body.inviteCode || "").trim();

    // Nếu máy chủ cấu hình mã mời đăng ký Admin trong .env thì bắt buộc khớp
    const configuredInviteCode = process.env.ADMIN_REGISTER_CODE?.trim();
    if (configuredInviteCode && !safeEqualStrings(inviteCode, configuredInviteCode)) {
      return NextResponse.json(
        { success: false, message: "Mã xác thực đăng ký Admin không chính xác." },
        { status: 403 }
      );
    }

    if (fullName.length < 2 || fullName.length > 80) {
      return NextResponse.json(
        { success: false, message: "Vui lòng nhập họ tên hợp lệ (từ 2 đến 80 ký tự)." },
        { status: 400 }
      );
    }

    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return NextResponse.json(
        {
          success: false,
          message: "Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch ngang/gạch dưới (3–32 ký tự).",
        },
        { status: 400 }
      );
    }

    if (password.trim().length < 8) {
      return NextResponse.json(
        { success: false, message: "Mật khẩu phải có tối thiểu 8 ký tự." },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { success: false, message: "Mật khẩu xác nhận không khớp." },
        { status: 400 }
      );
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { success: false, message: "Địa chỉ email không hợp lệ." },
        { status: 400 }
      );
    }

    const existing = await getStaffByUsernameFromMySql(username);
    if (existing) {
      return NextResponse.json(
        { success: false, message: `Tên đăng nhập "${username}" đã tồn tại. Vui lòng chọn tên khác.` },
        { status: 409 }
      );
    }

    const role = ALLOWED_REGISTER_ROLES.has(requestedRole) ? requestedRole : "SUPER_ADMIN";
    const result = await createStaffInMySql({
      username,
      fullName,
      role,
      phone: phone || undefined,
      email: email || undefined,
      password,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message || "Không thể đăng ký tài khoản lúc này." },
        { status: 400 }
      );
    }

    await recordAuditLogInMySql({
      actorUsername: username,
      actorRole: role,
      action: "AUTH_REGISTER_SUCCESS",
      targetType: "STAFF",
      targetId: username,
      summary: `Đăng ký tài khoản mới "${fullName}" (@${username}) với vai trò ${role}`,
      ipAddress: ip,
    });

    return NextResponse.json({
      success: true,
      message: "Đăng ký tài khoản thành công! Mời bạn đăng nhập.",
      user: { username, fullName, role },
    });
  } catch (error) {
    console.error("[Auth Register Error]", error);
    return NextResponse.json(
      { success: false, message: "Lỗi máy chủ nội bộ khi đăng ký tài khoản." },
      { status: 500 }
    );
  }
}
