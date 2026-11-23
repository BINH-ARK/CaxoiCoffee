import { NextResponse } from "next/server";
import {
  checkMySqlConnection,
  getDatabaseStatus,
  getMySqlPool,
  resetMenuTablesOnlyInMySql,
  recordAuditLogInMySql,
  ensureMySqlInitialized,
  resetMySqlInitState,
} from "@/lib/mysql";
import { getTrustedClientIp, requireStaffAuth } from "@/lib/serverAuth";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireStaffAuth(request, { roles: ["SUPER_ADMIN"] });
  if (!auth.ok) return auth.response;

  try {
    const dbStatus = await getDatabaseStatus();
    const mySqlStatus = await checkMySqlConnection();

    const dbDir = path.join(process.cwd(), "database");
    const phpmyadminSqlPath = path.join(dbDir, "phpmyadmin_caxoi_cafe.sql");

    return NextResponse.json({
      success: true,
      activeEngine: "MYSQL",
      sqlite: {
        ...dbStatus,
        relativePath: dbStatus.filePath,
        sqlScriptRelativePath: "database/phpmyadmin_caxoi_cafe.sql",
        dbBrowserUrl: "https://www.phpmyadmin.net",
        guide: [
          "1. Hệ thống đang chạy 100% trên MySQL (Hostinger / MariaDB).",
          "2. Toàn bộ bảng dữ liệu đã được tự động khởi tạo (Auto-migration).",
          "3. Bạn có thể quản lý trực tiếp qua phpMyAdmin của Hostinger hoặc tải bản sao lưu JSON/SQL ngay tại đây.",
        ],
      },
      mysql: {
        status: {
          connected: Boolean(mySqlStatus?.connected),
          database: mySqlStatus?.database || process.env.MYSQL_DATABASE || "caxoi_cafe",
          host: mySqlStatus?.host,
          port: mySqlStatus?.port,
          message: mySqlStatus?.message,
        },
        dumpFile: "database/phpmyadmin_caxoi_cafe.sql",
        dumpExists: fs.existsSync(phpmyadminSqlPath),
        phpMyAdminUrl: "http://localhost/phpmyadmin",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        message: error.message || "Lỗi đọc trạng thái cơ sở dữ liệu MySQL",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireStaffAuth(request, { roles: ["SUPER_ADMIN"] });
  if (!auth.ok) return auth.response;
  const ip = getTrustedClientIp(request);

  try {
    const body = await request.json();
    const { action } = body;

    // 0. Reset chỉ riêng bảng thực đơn (an toàn, giữ nguyên đơn hàng & người dùng)
    if (action === "RESET_MENU_ONLY") {
      const ok = await resetMenuTablesOnlyInMySql();
      if (!ok) {
        return NextResponse.json(
          { success: false, message: "Không thể khôi phục thực đơn trong MySQL" },
          { status: 500 }
        );
      }
      await recordAuditLogInMySql({
        actorId: auth.staff.id,
        actorUsername: auth.staff.username,
        actorRole: auth.staff.role,
        action: "DB_RESET_MENU_ONLY",
        targetType: "DATABASE",
        summary: "Khôi phục riêng bảng thực đơn chuẩn trong MySQL (giữ nguyên đơn hàng & tài khoản)",
        ipAddress: ip,
      });
      const dbStatus = await getDatabaseStatus();
      return NextResponse.json({
        success: true,
        message: "Đã khôi phục thực đơn chuẩn Quán Cà Xòi (giữ nguyên toàn bộ đơn hàng và tài khoản)!",
        sqlite: dbStatus,
      });
    }

    // 1. Khởi tạo lại / kiểm tra cấu trúc bảng MySQL (an toàn, không xóa dữ liệu đang có)
    if (action === "RESEED_SQLITE" || action === "SYNC_FROM_SQL" || action === "CHECKPOINT_SQLITE") {
      await ensureMySqlInitialized();
      const dbStatus = await getDatabaseStatus();
      return NextResponse.json({
        success: true,
        message: "Đã kiểm tra & đồng bộ cấu trúc bảng MySQL thành công!",
        sqlite: dbStatus,
      });
    }

    // 2. Test kết nối MySQL
    if (action === "TEST_CONNECTION") {
      const status = await checkMySqlConnection();
      return NextResponse.json({
        success: true,
        message: status.connected
          ? "Kết nối MySQL thành công!"
          : status.message || "Chưa kết nối được MySQL.",
        status: {
          connected: Boolean(status.connected),
          database: status.database || process.env.MYSQL_DATABASE || "caxoi_cafe",
        },
      });
    }

    if (action === "SEED_SQL") {
      const pool = getMySqlPool();
      const sqlFilePath = path.join(process.cwd(), "database", "phpmyadmin_caxoi_cafe.sql");
      if (!fs.existsSync(sqlFilePath)) {
        return NextResponse.json(
          { success: false, message: "Không tìm thấy file phpmyadmin_caxoi_cafe.sql" },
          { status: 404 }
        );
      }

      const sqlContent = fs.readFileSync(sqlFilePath, "utf8");
      const statements = sqlContent
        .split(/;\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("--") && !/^CREATE DATABASE|^USE /i.test(s));

      let executed = 0;
      const conn = await pool.getConnection();
      try {
        for (const statement of statements) {
          if (statement.length > 5) {
            await conn.query(statement);
            executed++;
          }
        }
      } finally {
        conn.release();
      }

      // Chạy lại auto-migration sau khi nạp dump phpMyAdmin để nâng cấp cột/bảng khớp ứng dụng
      resetMySqlInitState();
      await ensureMySqlInitialized();

      const status = await checkMySqlConnection();
      return NextResponse.json({
        success: true,
        message: `Đã nạp thành công ${executed} câu lệnh SQL vào MySQL!`,
        status: {
          connected: Boolean(status.connected),
          database: status.database || process.env.MYSQL_DATABASE || "caxoi_cafe",
        },
      });
    }

    return NextResponse.json({ success: false, message: "Hành động không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        message: error.message || "Lỗi xử lý yêu cầu CSDL MySQL",
      },
      { status: 500 }
    );
  }
}
