import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireStaffAuth } from "@/lib/serverAuth";
import { exportLiveSqlDumpFromMySql, exportFullDatabaseToJson } from "@/lib/mysql";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireStaffAuth(request, { roles: ["SUPER_ADMIN"] });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const type = (searchParams.get("type") || "sql").toLowerCase(); // 'sql' | 'json' | 'mysql_sql'

  if (type === "sql" || type === "mysql") {
    const liveSql = await exportLiveSqlDumpFromMySql();
    return new NextResponse(liveSql, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="caxoi_cafe_live_dump.sql"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (type === "json") {
    const fullJson = await exportFullDatabaseToJson();
    return new NextResponse(JSON.stringify(fullJson, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="caxoi_cafe_backup.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (type === "mysql_sql") {
    const dbDir = path.join(process.cwd(), "database");
    const targetFile = path.join(dbDir, "phpmyadmin_caxoi_cafe.sql");
    if (!fs.existsSync(targetFile)) {
      return NextResponse.json({ success: false, message: "File không tồn tại" }, { status: 404 });
    }
    const fileBuffer = fs.readFileSync(targetFile);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="phpmyadmin_caxoi_cafe.sql"`,
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(
    { success: false, message: "Loại tệp tải về không hợp lệ (chọn type=sql, type=json hoặc type=mysql_sql)." },
    { status: 400 }
  );
}
