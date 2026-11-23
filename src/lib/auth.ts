import { SignJWT, jwtVerify } from "jose";

export type Role = "SUPER_ADMIN" | "STORE_MANAGER" | "BARISTA" | "CASHIER";

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  pin?: string;
}

export interface TokenPayload {
  sub: string;
  username: string;
  fullName: string;
  role: Role;
  tv?: number; // tokenVersion for immediate revocation on logout/password/role changes
  [key: string]: unknown;
}

export const COOKIE_NAME = "cafe_auth_token";

/**
 * Đọc khóa bí mật JWT từ biến môi trường; nếu chưa đặt JWT_SECRET đủ 32 ký tự
 * sẽ tự dẫn xuất khóa 256-bit từ các bí mật riêng tư trên server (không dùng chuỗi cứng công khai).
 */
export async function resolveJwtSecretKey(): Promise<Uint8Array | null> {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret && secret.length >= 32) {
    return new TextEncoder().encode(secret);
  }

  const privateParts = [
    secret || "",
    process.env.MYSQL_PASSWORD?.trim() || "",
    process.env.ADMIN_PASSWORD?.trim() || "",
    process.env.INIT_ADMIN_PASSWORD?.trim() || "",
  ].filter(Boolean);

  if (privateParts.length === 0) {
    return null;
  }

  const seed = [
    "caxoi-jwt-v1",
    ...privateParts,
    process.env.MYSQL_USER?.trim() || "",
    process.env.MYSQL_DATABASE?.trim() || "",
    process.env.MYSQL_HOST?.trim() || "",
  ].join("::");

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return new Uint8Array(digest);
}

export async function getJwtSecretKey(): Promise<Uint8Array> {
  const key = await resolveJwtSecretKey();
  if (!key) {
    throw new Error("Thiếu cấu hình bảo mật JWT_SECRET (bắt buộc tối thiểu 32 ký tự).");
  }
  return key;
}

// Sign JWT Token
export async function signAuthToken(payload: TokenPayload): Promise<string> {
  const key = await getJwtSecretKey();
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key);
}

// Verify JWT Token
export async function verifyAuthToken(token: string): Promise<TokenPayload | null> {
  try {
    const key = await resolveJwtSecretKey();
    if (!key) return null;
    const { payload } = await jwtVerify(token, key);
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}
