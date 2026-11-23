import { NextResponse } from "next/server";
import {
  checkRateLimitLockInMySql,
  consumeRateLimitInMySql,
  resetRateLimitInMySql,
} from "@/lib/mysql";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Kiểm tra xem khóa (IP / username / global) có đang bị khóa hay không (không cộng thêm lượt).
 */
export async function checkRateLimitLock(key: string): Promise<RateLimitResult> {
  return checkRateLimitLockInMySql(key);
}

/**
 * Ghi nhận 1 lượt gọi và kiểm tra giới hạn tốc độ bền vững trong MySQL.
 */
export async function consumeRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  lockDurationMs?: number
): Promise<RateLimitResult> {
  return consumeRateLimitInMySql(key, maxRequests, windowMs, lockDurationMs);
}

/**
 * Xóa bộ đếm sau khi xác thực thành công.
 */
export async function resetRateLimit(key: string): Promise<void> {
  await resetRateLimitInMySql(key);
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
