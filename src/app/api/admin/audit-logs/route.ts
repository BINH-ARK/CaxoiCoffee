import { NextResponse } from "next/server";
import { requireStaffAuth } from "@/lib/serverAuth";
import { getAuditLogsFromMySql } from "@/lib/mysql";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireStaffAuth(request, {
    roles: ["SUPER_ADMIN", "STORE_MANAGER"],
  });
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action")?.trim() || undefined;
    const limitParam = Number(searchParams.get("limit") || 100);
    const limit = Math.max(1, Math.min(300, Number.isFinite(limitParam) ? Math.floor(limitParam) : 100));

    const logs = await getAuditLogsFromMySql({ action, limit });
    return NextResponse.json({
      success: true,
      data: logs,
    });
  } catch (error: any) {
    console.error("[Audit Logs GET Error]", error);
    return NextResponse.json(
      { success: false, message: "Lỗi tải nhật ký kiểm toán." },
      { status: 500 }
    );
  }
}
