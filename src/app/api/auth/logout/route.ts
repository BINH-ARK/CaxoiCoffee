import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { getAuthenticatedStaff, getTrustedClientIp, verifySameOriginCsrf } from "@/lib/serverAuth";
import { incrementUserTokenVersionInSqlite, recordAuditLogInSqlite } from "@/lib/sqlite";

export async function POST(request: Request) {
  const csrfError = verifySameOriginCsrf(request);
  if (csrfError) return csrfError;

  // Thu hồi phiên JWT ngay lập tức trên máy chủ bằng cách tăng token_version
  try {
    const staff = await getAuthenticatedStaff(request);
    if (staff) {
      incrementUserTokenVersionInSqlite(staff.id);
      recordAuditLogInSqlite({
        actorId: staff.id,
        actorUsername: staff.username,
        actorRole: staff.role,
        action: "AUTH_LOGOUT",
        targetType: "AUTH",
        targetId: staff.id,
        summary: `${staff.fullName} (@${staff.username}) đã đăng xuất và thu hồi phiên JWT`,
        ipAddress: getTrustedClientIp(request),
      });
    }
  } catch {
    // Luôn tiếp tục xóa cookie ở trình duyệt
  }

  const response = NextResponse.json({
    success: true,
    message: "Đã đăng xuất an toàn.",
  });

  const isSecureCookie =
    process.env.NODE_ENV === "production" ||
    request.url.startsWith("https://");

  response.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: isSecureCookie,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
