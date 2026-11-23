import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  getStaffByUsernameFromSqlite,
  savePasswordResetOtpInSqlite,
  verifyAndResetPasswordWithOtpInSqlite,
  recordAuditLogInSqlite,
} from "@/lib/sqlite";
import { sendPasswordResetOtpEmail } from "@/lib/mail";
import { getTrustedClientIp, verifySameOriginCsrf } from "@/lib/serverAuth";
import { consumeRateLimit, createRateLimitResponse } from "@/lib/rateLimit";

export async function POST(request: Request) {
  const csrfError = verifySameOriginCsrf(request);
  if (csrfError) return csrfError;

  try {
    const ip = getTrustedClientIp(request);
    const rl = consumeRateLimit(`auth:forgot:${ip}`, 10, 15 * 60 * 1000, 3 * 60 * 1000);
    if (!rl.allowed) {
      return createRateLimitResponse(
        rl.retryAfterSeconds,
        `Bạn đã gửi quá nhiều yêu cầu khôi phục mật khẩu. Vui lòng thử lại sau ${rl.retryAfterSeconds} giây.`
      );
    }

    const body = await request.json();
    const action = String(body.action || "REQUEST_OTP").toUpperCase();
    const username = String(body.username || "").trim().toLowerCase();

    if (!username) {
      return NextResponse.json(
        { success: false, message: "Vui lòng nhập tên đăng nhập cần khôi phục mật khẩu." },
        { status: 400 }
      );
    }

    const staff = getStaffByUsernameFromSqlite(username);
    if (!staff || !staff.isActive) {
      return NextResponse.json(
        { success: false, message: `Không tìm thấy tài khoản hoạt động với tên đăng nhập "${username}".` },
        { status: 404 }
      );
    }

    if (action === "REQUEST_OTP") {
      const otp = String(crypto.randomInt(100000, 1000000));
      const saved = savePasswordResetOtpInSqlite(staff.id, otp, 10 * 60 * 1000);
      if (!saved) {
        return NextResponse.json(
          { success: false, message: "Không thể khởi tạo mã OTP. Vui lòng thử lại." },
          { status: 500 }
        );
      }

      let mailSent = false;
      if (staff.email) {
        const res = await sendPasswordResetOtpEmail(staff.email, staff.fullName, staff.username, otp);
        mailSent = res.sent;
      }

      console.info(
        `[Cà Xòi Forgot Password OTP] Tài khoản @${staff.username} -> Mã OTP: ${otp} (hiệu lực 10 phút)`
      );

      recordAuditLogInSqlite({
        actorId: staff.id,
        actorUsername: staff.username,
        actorRole: staff.role,
        action: "AUTH_FORGOT_PASSWORD_OTP",
        targetType: "AUTH",
        targetId: staff.id,
        summary: `Yêu cầu mã OTP đặt lại mật khẩu cho @${staff.username} (${mailSent ? "đã gửi email" : "mã nội bộ"})`,
        ipAddress: ip,
      });

      const isDev = process.env.NODE_ENV !== "production";
      return NextResponse.json({
        success: true,
        mailSent,
        devOtp: !mailSent && isDev ? otp : undefined,
        message: mailSent
          ? `Đã gửi mã OTP 6 số tới email đã đăng ký của @${staff.username}. Vui lòng kiểm tra hộp thư!`
          : isDev
          ? `Đã tạo mã OTP khôi phục (chưa cấu hình Gmail SMTP nên hiển thị mã dùng thử nội bộ bên dưới).`
          : `Đã tạo mã OTP khôi phục mật khẩu. Vui lòng liên hệ quản trị viên hệ thống hoặc xem log máy chủ để nhận mã.`,
      });
    }

    if (action === "RESET_PASSWORD") {
      const otp = String(body.otp || "").trim();
      const newPassword = String(body.newPassword || "");
      const confirmPassword = String(body.confirmPassword || "");

      if (!/^\d{6}$/.test(otp)) {
        return NextResponse.json(
          { success: false, message: "Mã OTP phải gồm đúng 6 chữ số." },
          { status: 400 }
        );
      }
      if (newPassword.trim().length < 8) {
        return NextResponse.json(
          { success: false, message: "Mật khẩu mới phải có tối thiểu 8 ký tự." },
          { status: 400 }
        );
      }
      if (newPassword !== confirmPassword) {
        return NextResponse.json(
          { success: false, message: "Mật khẩu xác nhận không khớp." },
          { status: 400 }
        );
      }

      const resetRes = verifyAndResetPasswordWithOtpInSqlite(staff.id, otp, newPassword);
      if (!resetRes.success) {
        return NextResponse.json(
          { success: false, message: resetRes.message },
          { status: 400 }
        );
      }

      recordAuditLogInSqlite({
        actorId: staff.id,
        actorUsername: staff.username,
        actorRole: staff.role,
        action: "AUTH_PASSWORD_RESET_SUCCESS",
        targetType: "AUTH",
        targetId: staff.id,
        summary: `Đặt lại mật khẩu thành công qua OTP cho @${staff.username}`,
        ipAddress: ip,
      });

      return NextResponse.json({
        success: true,
        message: resetRes.message,
      });
    }

    return NextResponse.json(
      { success: false, message: "Hành động không hợp lệ." },
      { status: 400 }
    );
  } catch (error) {
    console.error("[Auth Forgot Password Error]", error);
    return NextResponse.json(
      { success: false, message: "Lỗi máy chủ khi xử lý yêu cầu quên mật khẩu." },
      { status: 500 }
    );
  }
}
