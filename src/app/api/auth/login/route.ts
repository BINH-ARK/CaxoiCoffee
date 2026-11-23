import { NextResponse } from "next/server";
import { signAuthToken, COOKIE_NAME } from "@/lib/auth";
import { findUserInSqlite, recordAuditLogInSqlite } from "@/lib/sqlite";
import { verifyPassword } from "@/lib/password";
import { getTrustedClientIp } from "@/lib/serverAuth";
import {
  checkRateLimitLock,
  consumeRateLimit,
  createRateLimitResponse,
  resetRateLimit,
} from "@/lib/rateLimit";

const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 1000 * 60 * 3; // 3 phút
const WINDOW_MS = 1000 * 60 * 15; // 15 phút

export async function POST(request: Request) {
  try {
    const ip = getTrustedClientIp(request);

    const body = await request.json();
    const { username, password, pin, loginType = "CREDENTIALS" } = body;

    // Khóa bền vững bằng SQLite theo tổ hợp IP + tài khoản (hoặc kênh PIN toàn cục)
    const ipKey = `login:ip:${ip}`;
    const subjectKey =
      loginType === "PIN"
        ? `login:pin:${ip}`
        : `login:user:${String(username || "").trim().toLowerCase()}`;
    const pinGlobalKey = loginType === "PIN" ? "login:pin:global" : null;

    const keysToCheck = [ipKey, subjectKey, ...(pinGlobalKey ? [pinGlobalKey] : [])];
    for (const k of keysToCheck) {
      const lockStatus = checkRateLimitLock(k);
      if (!lockStatus.allowed) {
        return createRateLimitResponse(
          lockStatus.retryAfterSeconds,
          `Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau ${lockStatus.retryAfterSeconds} giây.`
        );
      }
    }

    let matchedUser: {
      id: string;
      username: string;
      fullName: string;
      role: "SUPER_ADMIN" | "STORE_MANAGER" | "BARISTA" | "CASHIER";
      tokenVersion: number;
    } | null = null;

    if (loginType === "PIN") {
      const cleanPin = typeof pin === "string" ? pin.trim() : "";
      if (!/^\d{4,6}$/.test(cleanPin)) {
        return NextResponse.json(
          { success: false, message: "Vui lòng nhập mã PIN KDS hợp lệ (4–6 chữ số)." },
          { status: 400 }
        );
      }
      // Chỉ chấp nhận PIN đã băm scrypt của BARISTA / CASHIER trong SQLite
      const sqliteUser = findUserInSqlite(cleanPin, true);
      if (sqliteUser) {
        matchedUser = sqliteUser;
      }
    } else {
      const cleanUser = typeof username === "string" ? username.trim() : "";
      const rawPassword = typeof password === "string" ? password : "";
      if (!cleanUser || !rawPassword) {
        return NextResponse.json(
          { success: false, message: "Vui lòng nhập tên đăng nhập và mật khẩu." },
          { status: 400 }
        );
      }
      // Xác thực duy nhất với SQLite sử dụng băm scrypt + timingSafeEqual
      const sqliteUser = findUserInSqlite(cleanUser, false);
      if (sqliteUser && verifyPassword(rawPassword, sqliteUser.passwordHash)) {
        matchedUser = sqliteUser;
      }
    }

    if (!matchedUser) {
      consumeRateLimit(ipKey, MAX_ATTEMPTS, WINDOW_MS, LOCK_DURATION_MS);
      consumeRateLimit(subjectKey, MAX_ATTEMPTS, WINDOW_MS, LOCK_DURATION_MS);
      if (pinGlobalKey) {
        consumeRateLimit(pinGlobalKey, MAX_ATTEMPTS * 2, WINDOW_MS, LOCK_DURATION_MS);
      }

      recordAuditLogInSqlite({
        actorUsername: loginType === "PIN" ? "kds-pin" : String(username || "unknown").trim().slice(0, 60),
        actorRole: "ANONYMOUS",
        action: "AUTH_LOGIN_FAILED",
        targetType: "AUTH",
        summary:
          loginType === "PIN"
            ? "Đăng nhập KDS bằng mã PIN thất bại"
            : `Đăng nhập thất bại với tài khoản "${String(username || "").trim().slice(0, 60)}"`,
        ipAddress: ip,
      });

      return NextResponse.json(
        {
          success: false,
          message:
            loginType === "PIN"
              ? "Mã PIN quầy bar không chính xác (hoặc vai trò không hỗ trợ đăng nhập bằng PIN)."
              : "Tên đăng nhập hoặc mật khẩu không chính xác.",
        },
        { status: 401 }
      );
    }

    resetRateLimit(ipKey);
    resetRateLimit(subjectKey);
    if (pinGlobalKey) resetRateLimit(pinGlobalKey);

    recordAuditLogInSqlite({
      actorId: matchedUser.id,
      actorUsername: matchedUser.username,
      actorRole: matchedUser.role,
      action: "AUTH_LOGIN_SUCCESS",
      targetType: "AUTH",
      targetId: matchedUser.id,
      summary: `${matchedUser.fullName} (@${matchedUser.username}) đăng nhập thành công (${loginType === "PIN" ? "PIN KDS" : "Mật khẩu"})`,
      ipAddress: ip,
    });

    const token = await signAuthToken({
      sub: matchedUser.id,
      username: matchedUser.username,
      fullName: matchedUser.fullName,
      role: matchedUser.role,
      tv: matchedUser.tokenVersion,
    });

    const response = NextResponse.json({
      success: true,
      message: `Đăng nhập thành công! Chào mừng ${matchedUser.fullName}`,
      user: {
        id: matchedUser.id,
        username: matchedUser.username,
        fullName: matchedUser.fullName,
        role: matchedUser.role,
      },
    });

    const isSecureCookie =
      process.env.NODE_ENV === "production" ||
      request.url.startsWith("https://");
    response.cookies.set({
      name: COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12, // 12 giờ
    });

    return response;
  } catch (error) {
    console.error("[Auth Login Error]", error);
    return NextResponse.json(
      { success: false, message: "Lỗi xử lý đăng nhập. Vui lòng thử lại." },
      { status: 500 }
    );
  }
}
