import { NextResponse } from "next/server";
import { getBankTransactionsFromMySql } from "@/lib/mysql";
import { requireStaffAuth } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireStaffAuth(request, {
    roles: ["SUPER_ADMIN", "STORE_MANAGER", "CASHIER"],
  });
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "ALL";
    const search = searchParams.get("search") || "";
    const limitParam = Number(searchParams.get("limit") || 100);
    const limit = Number.isFinite(limitParam) ? Math.min(300, Math.max(1, limitParam)) : 100;

    const data = await getBankTransactionsFromMySql({
      status,
      search,
      limit,
    });

    return NextResponse.json({
      success: true,
      data: data.transactions,
      summary: data.summary,
    });
  } catch (error) {
    console.error("[Admin Bank Transactions GET Error]", error);
    return NextResponse.json(
      { success: false, message: "Không thể tải lịch sử giao dịch ngân hàng." },
      { status: 500 }
    );
  }
}
