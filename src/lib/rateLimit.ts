import { NextResponse } from "next/server";
import {
  checkRateLimitLockInSqlite,
  consumeRateLimitInSqlite,
  resetRateLimitInSqlite,
} from "@/lib/sqlite";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Kiểm tra xem khóa (IP / username / global) có đang bị khóa hay không (không cộng thêm lượt).
 */
export function checkRateLimitLock(key: string): RateLimitResult {
  return checkRateLimitLockInSqlite(key);
}

/**
 * Ghi nhận 1 lượt gọi và kiểm tra giới hạn tốc độ bền vững trong SQLite.
 */
export function consumeRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  lockDurationMs?: number
): RateLimitResult {
  return consumeRateLimitInSqlite(key, maxRequests, windowMs, lockDurationMs);
}

/**
 * Xóa bộ đếm sau khi xác thực thành công.
 */
export function resetRateLimit(key: string): void {
  resetRateLimitInSqlite(key);
}

/**
 * Trả phản hồi HTTP 429 chuẩn kèm header Retry-After.
 */
export function createRateLimitResponse(retryAfterSeconds: number, message?: string): NextResponse {
  const wait = Math.max(1, Math.ceil(retryAfterSeconds));
  return NextResponse.json(
    {
      success: false,
      message: message || `Quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau ${wait} giây.`,
      retryAfterSeconds: wait,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(wait),
      },
    }
  );
}
