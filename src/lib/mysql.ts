import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import path from "path";
import fs from "fs";
import crypto from "node:crypto";
import {
  Product,
  Order,
  OrderItemRecord,
  Category,
  ProductOption,
  BusinessSettings,
  GroupSession,
  CartItem,
  PermissionDefinition,
  RolePermissionConfig,
  StaffAccount,
  Promotion,
  DiscountType,
  ShippingFeeMode,
  AuditLogEntry,
} from "@/types";
import { INITIAL_CATEGORIES, INITIAL_OPTIONS, INITIAL_PRODUCTS, INITIAL_SETTINGS } from "@/lib/store";
import { parseProductTags } from "@/lib/utils";
import { hashPassword, isScryptHash, verifyPassword } from "@/lib/password";

export interface DatabaseStatus {
  connected: boolean;
  type: "MYSQL" | "MYSQL_PHPMYADMIN" | "MEMORY_CACHE";
  host: string;
  port: number;
  user: string;
  database: string;
  message: string;
  tables?: {
    usersCount: number;
    productsCount: number;
    variantsCount: number;
    ordersCount: number;
    orderItemsCount?: number;
    categoriesCount: number;
    optionsCount?: number;
    settingsCount?: number;
    groupSessionsCount?: number;
    permissionsCount?: number;
    rolePermissionsCount?: number;
    promotionsCount?: number;
  };
}

export interface MySqlAdminStatus {
  connected: boolean;
  engine: "MYSQL";
  host: string;
  port: number;
  database: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  journalMode: string;
  foreignKeys: boolean;
  tables: {
    usersCount: number;
    productsCount: number;
    variantsCount: number;
    ordersCount: number;
    orderItemsCount: number;
    categoriesCount: number;
    optionsCount: number;
    settingsCount: number;
    groupSessionsCount: number;
    permissionsCount: number;
    rolePermissionsCount: number;
    promotionsCount: number;
  };
  optimizedFor: string;
  sqlFileLastModified?: string;
  sqlFilePath?: string;
}

const DB_DIR = path.join(process.cwd(), "database");
const BACKUPS_DIR = path.join(DB_DIR, "backups");
const MAX_BACKUP_FILES = 30;

function getDbConfig() {
  return {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "caxoi_cafe",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000,
    timezone: "+07:00",
    dateStrings: true,
    charset: "utf8mb4",
  };
}

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;

export function getMySqlPool(): Pool {
  if (!pool) {
    pool = mysql.createPool(getDbConfig());
    // Đảm bảo mỗi kết nối MySQL trên Hostinger (thường mặc định UTC) dùng múi giờ Việt Nam +07:00
    const rawPool = (pool as unknown as { pool?: { on?: (ev: string, cb: (conn: any) => void) => void } }).pool;
    rawPool?.on?.("connection", (connection: any) => {
      connection.query("SET time_zone = '+07:00'");
    });
  }
  return pool;
}

export function resetMySqlInitState(): void {
  initPromise = null;
}

function toMysqlDatetime(val?: string | Date | null): string {
  const d = val ? new Date(val) : new Date();
  if (Number.isNaN(d.getTime())) {
    return toMysqlDatetime(new Date());
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  // Format in Asia/Ho_Chi_Minh (+07:00)
  const vnMs = d.getTime() + 7 * 60 * 60 * 1000;
  const vn = new Date(vnMs);
  return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}:${pad(vn.getUTCSeconds())}`;
}

function normalizeTimestamp(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

const HERO_SETTINGS_COLUMNS: ReadonlyArray<{
  key: keyof BusinessSettings;
  col: string;
  required?: boolean;
}> = [
  { key: "heroBadgeBrand", col: "hero_badge_brand", required: true },
  { key: "heroLocation", col: "hero_location" },
  { key: "heroEyebrow", col: "hero_eyebrow" },
  { key: "heroHeadlinePrimary", col: "hero_headline_primary" },
  { key: "heroHeadlineHighlight", col: "hero_headline_highlight" },
  { key: "heroDescription", col: "hero_description" },
  { key: "heroServiceNote", col: "hero_service_note" },
  { key: "heroPriceBadge1", col: "hero_price_badge_1" },
  { key: "heroPriceBadge2", col: "hero_price_badge_2" },
  { key: "heroPriceBadge3", col: "hero_price_badge_3" },
  { key: "heroPrimaryCtaText", col: "hero_primary_cta_text" },
  { key: "heroSecondaryCtaText", col: "hero_secondary_cta_text" },
  { key: "heroWatermarkText", col: "hero_watermark_text" },
  { key: "heroLogoUrl", col: "hero_logo_url", required: true },
  { key: "heroMascotTitle", col: "hero_mascot_title" },
  { key: "heroMascotSubtitle", col: "hero_mascot_subtitle" },
  { key: "facebookUrl", col: "facebook_url", required: true },
  { key: "qrFacebookTitle", col: "qr_facebook_title" },
  { key: "qrFacebookSubtitle", col: "qr_facebook_subtitle" },
  { key: "xanhSmUrl", col: "xanh_sm_url", required: true },
  { key: "qrXanhSmTitle", col: "qr_xanh_sm_title" },
  { key: "qrXanhSmSubtitle", col: "qr_xanh_sm_subtitle" },
];

const DEFAULT_ROLES: ReadonlyArray<[number, string, string]> = [
  [1, "SUPER_ADMIN", "Chủ quán - Toàn quyền quản trị hệ thống, thực đơn, doanh thu và cấu hình máy chủ"],
  [2, "STORE_MANAGER", "Quản lý cửa hàng - Điều phối quán, cập nhật thực đơn, duyệt khuyến mãi và giờ mở cửa"],
  [3, "BARISTA", "Nhân viên pha chế - Màn hình KDS nhận đơn, cập nhật tiến độ pha chế và in tem dán ly"],
  [4, "CASHIER", "Thu ngân - Kiểm tra hóa đơn, đối soát và hỗ trợ xác nhận thanh toán"],
];

const DEFAULT_PERMISSIONS: ReadonlyArray<[string, string, string, string, string]> = [
  ["p_orders_view", "orders.view", "Xem đơn hàng", "ORDERS", "Xem chi tiết đơn hàng cá nhân, đơn tòa nhà và đơn nhóm"],
  ["p_orders_status", "orders.update_status", "Cập nhật tiến độ pha chế", "ORDERS", "Đổi trạng thái đơn: Chờ pha -> Đang pha -> Sẵn sàng -> Hoàn tất"],
  ["p_orders_print", "orders.print", "In tem ly & Hóa đơn", "ORDERS", "Gửi lệnh in tem dán ly 50x30mm và hóa đơn thanh toán"],
  ["p_orders_cancel", "orders.cancel", "Hủy đơn hàng", "ORDERS", "Hủy đơn hàng khi khách yêu cầu hoặc quầy gặp sự cố"],
  ["p_menu_view", "menu.view", "Xem thực đơn", "MENU", "Xem danh mục, sản phẩm, kích cỡ và bảng giá"],
  ["p_menu_toggle", "menu.toggle_availability", "Bật/Tắt còn hàng", "MENU", "Gạt nút khóa món tức thì khi hết nguyên liệu"],
  ["p_menu_pricing", "menu.edit_pricing", "Sửa giá & Tạo món", "MENU", "Thêm món mới, điều chỉnh giá bán và kích cỡ"],
  ["p_promotions_view", "promotions.view", "Xem mã giảm giá", "PROMOTIONS", "Xem danh sách mã khuyến mãi đang áp dụng"],
  ["p_promotions_manage", "promotions.manage", "Quản lý Voucher", "PROMOTIONS", "Tạo voucher mới, chỉnh sửa tỷ lệ chiết khấu và hạn mức"],
  ["p_finance_revenue", "finance.view_revenue", "Xem doanh thu", "FINANCE", "Xem số liệu doanh thu thực tế, tiền hàng theo ngày/tuần/tháng"],
  ["p_finance_analytics", "finance.view_analytics", "Biểu đồ giờ cao điểm", "FINANCE", "Xem phân bổ đơn theo khung giờ để tối ưu ca làm việc"],
  ["p_system_pause", "system.emergency_pause", "Tạm dừng nhận đơn cao điểm", "SYSTEM", "Nút khẩn cấp đóng nhận đơn trực tuyến khi quán quá tải"],
  ["p_system_settings", "system.settings", "Cấu hình ngân hàng & Vận hành", "SYSTEM", "Cấu hình tài khoản VietQR, phí giao hàng, giờ mở cửa"],
  ["p_system_roles", "system.manage_roles", "Quản lý Phân quyền & Nhân viên", "SYSTEM", "Cấp phát quyền hạn, cấp mã PIN và tài khoản nhân viên"],
];

const DEFAULT_ROLE_PERMISSIONS: ReadonlyArray<[string, string]> = [
  ["SUPER_ADMIN", "orders.view"],
  ["SUPER_ADMIN", "orders.update_status"],
  ["SUPER_ADMIN", "orders.print"],
  ["SUPER_ADMIN", "orders.cancel"],
  ["SUPER_ADMIN", "menu.view"],
  ["SUPER_ADMIN", "menu.toggle_availability"],
  ["SUPER_ADMIN", "menu.edit_pricing"],
  ["SUPER_ADMIN", "promotions.view"],
  ["SUPER_ADMIN", "promotions.manage"],
  ["SUPER_ADMIN", "finance.view_revenue"],
  ["SUPER_ADMIN", "finance.view_analytics"],
  ["SUPER_ADMIN", "system.emergency_pause"],
  ["SUPER_ADMIN", "system.settings"],
  ["SUPER_ADMIN", "system.manage_roles"],
  ["STORE_MANAGER", "orders.view"],
  ["STORE_MANAGER", "orders.update_status"],
  ["STORE_MANAGER", "orders.print"],
  ["STORE_MANAGER", "orders.cancel"],
  ["STORE_MANAGER", "menu.view"],
  ["STORE_MANAGER", "menu.toggle_availability"],
  ["STORE_MANAGER", "promotions.view"],
  ["STORE_MANAGER", "finance.view_revenue"],
  ["STORE_MANAGER", "finance.view_analytics"],
  ["STORE_MANAGER", "system.emergency_pause"],
  ["BARISTA", "orders.view"],
  ["BARISTA", "orders.update_status"],
  ["BARISTA", "orders.print"],
  ["BARISTA", "menu.view"],
  ["CASHIER", "orders.view"],
  ["CASHIER", "orders.update_status"],
  ["CASHIER", "orders.print"],
  ["CASHIER", "menu.view"],
  ["CASHIER", "promotions.view"],
];

const DEFAULT_OPTIONS: ReadonlyArray<[number, string, number, number, number]> = [
  [1, "Độ ngọt", 1, 0, 1],
  [2, "Đá", 1, 0, 2],
  [3, "Topping & Thêm kem béo", 0, 1, 3],
];

const DEFAULT_OPTION_VALUES: ReadonlyArray<[number, number, string, number, number, number]> = [
  [1, 1, "100% Đường (Chuẩn vị Cà Xòi)", 0, 1, 1],
  [2, 1, "70% Đường (Ít ngọt nhẹ)", 0, 0, 2],
  [3, 1, "50% Đường (Ngọt vừa)", 0, 0, 3],
  [4, 1, "30% Đường (Rất ít ngọt)", 0, 0, 4],
  [5, 1, "0% Đường (Không đường)", 0, 0, 5],
  [6, 2, "Bình thường (Đầy ly)", 0, 1, 1],
  [7, 2, "Ít đá (Nhiều nước)", 0, 0, 2],
  [8, 2, "Không đá", 0, 0, 3],
  [9, 2, "Túi đá riêng (Dành cho chai rót)", 0, 0, 4],
  [10, 3, "Thêm lớp Kem Trứng Muối béo ngậy", 10000, 0, 1],
  [11, 3, "Thêm lớp Kem Muối Huế mặn mà", 8000, 0, 2],
  [12, 3, "Thêm 1 shot cà phê đậm đặc", 7000, 0, 3],
];

const DEFAULT_COMPANIES: ReadonlyArray<[number, string, string, string, number]> = [
  [1, "Software Park Đà Nẵng", "Software Park 1 & 2", "02 Quang Trung, Phường Thạch Thang, Hải Châu, Đà Nẵng", 1],
  [2, "FPT Complex Ngũ Hành Sơn", "FPT Complex", "Đường Nam Kỳ Khởi Nghĩa, Hòa Hải, Ngũ Hành Sơn, Đà Nẵng", 1],
  [3, "Tòa nhà VNPT Đà Nẵng", "VNPT Building", "346 Đường 2 Tháng 9, Hòa Cường Bắc, Hải Châu, Đà Nẵng", 1],
  [4, "Tòa nhà Viettel Đà Nẵng", "Viettel Complex", "92 Xô Viết Nghệ Tĩnh, Khuê Trung, Cẩm Lệ, Đà Nẵng", 1],
  [5, "Trung tâm Hành chính Đà Nẵng", "Danang Admin Center", "24 Trần Phú, Thạch Thang, Hải Châu, Đà Nẵng", 1],
];

const DEFAULT_PROMOTIONS: ReadonlyArray<[string, string, string, number, number, number, number | null]> = [
  ["CHAOBANMOI", "Giảm 20% đơn đầu tiên cho dân văn phòng", "PERCENTAGE", 20, 50000, 1, 30000],
  ["OFFICE50K", "Giảm 50.000đ khi gom đơn cả phòng từ 200k", "FIXED", 50000, 200000, 1, null],
  ["FREESHIP", "Freeship siêu tốc toàn quận Hải Châu, Thanh Khê", "FREESHIP", 15000, 80000, 1, null],
];

interface ColumnMeta {
  dataType: string;
  maxLength: number | null;
  isNullable: boolean;
}

async function getColumnMetadata(conn: PoolConnection, tableName: string): Promise<Map<string, ColumnMeta>> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  const map = new Map<string, ColumnMeta>();
  for (const r of rows) {
    map.set(String(r.COLUMN_NAME).toLowerCase(), {
      dataType: String(r.DATA_TYPE || "").toLowerCase(),
      maxLength: r.CHARACTER_MAXIMUM_LENGTH != null ? Number(r.CHARACTER_MAXIMUM_LENGTH) : null,
      isNullable: String(r.IS_NULLABLE || "").toUpperCase() === "YES",
    });
  }
  return map;
}

async function getExistingColumns(conn: PoolConnection, tableName: string): Promise<Set<string>> {
  const meta = await getColumnMetadata(conn, tableName);
  return new Set(meta.keys());
}

async function addColumnIfMissing(
  conn: PoolConnection,
  existingCols: Set<string>,
  tableName: string,
  colName: string,
  definition: string
) {
  if (!existingCols.has(colName.toLowerCase())) {
    try {
      await conn.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${colName}\` ${definition}`);
      existingCols.add(colName.toLowerCase());
    } catch (err: any) {
      if (err?.code !== "ER_DUP_FIELDNAME") {
        console.warn(`[MySQL Auto-Migration] Không thể thêm cột ${tableName}.${colName}:`, err?.message);
      }
    }
  }
}

async function runMySqlAutoMigration(): Promise<void> {
  const currentPool = getMySqlPool();
  const conn = await currentPool.getConnection();
  try {
    // 1. Tạo toàn bộ các bảng chuẩn utf8mb4 nếu chưa tồn tại
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`roles\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(50) NOT NULL,
        \`description\` VARCHAR(255) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_roles_name\` (\`name\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`permissions\` (
        \`id\` VARCHAR(64) NOT NULL,
        \`code\` VARCHAR(100) NOT NULL,
        \`name\` VARCHAR(150) NOT NULL,
        \`category\` VARCHAR(50) NOT NULL,
        \`description\` TEXT DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_permissions_code\` (\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`role_permissions\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`role_name\` VARCHAR(50) NOT NULL,
        \`permission_code\` VARCHAR(100) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_role_permissions\` (\`role_name\`, \`permission_code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`users\` (
        \`id\` VARCHAR(64) NOT NULL,
        \`username\` VARCHAR(50) NOT NULL,
        \`password_hash\` VARCHAR(255) NOT NULL,
        \`plain_password\` VARCHAR(100) DEFAULT NULL,
        \`pin\` VARCHAR(255) DEFAULT NULL,
        \`full_name\` VARCHAR(120) NOT NULL,
        \`phone\` VARCHAR(30) DEFAULT NULL,
        \`email\` VARCHAR(150) DEFAULT NULL,
        \`role_id\` INT NOT NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`token_version\` INT NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_users_username\` (\`username\`),
        KEY \`idx_users_role_id\` (\`role_id\`),
        CONSTRAINT \`fk_users_roles\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`categories\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(150) NOT NULL,
        \`slug\` VARCHAR(150) NOT NULL,
        \`description\` TEXT DEFAULT NULL,
        \`image_url\` VARCHAR(500) DEFAULT NULL,
        \`display_order\` INT NOT NULL DEFAULT 1,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_categories_slug\` (\`slug\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`products\` (
        \`id\` VARCHAR(64) NOT NULL,
        \`category_id\` INT NOT NULL,
        \`name\` VARCHAR(150) NOT NULL,
        \`slug\` VARCHAR(150) NOT NULL,
        \`description\` TEXT DEFAULT NULL,
        \`image_url\` VARCHAR(500) DEFAULT NULL,
        \`base_price\` DOUBLE NOT NULL,
        \`sale_price\` DOUBLE DEFAULT NULL,
        \`is_available\` TINYINT(1) NOT NULL DEFAULT 1,
        \`is_featured\` TINYINT(1) NOT NULL DEFAULT 1,
        \`prep_time_minutes\` INT NOT NULL DEFAULT 4,
        \`tags\` VARCHAR(255) DEFAULT 'BEST_SELLER',
        PRIMARY KEY (\`id\`),
        KEY \`idx_products_category\` (\`category_id\`),
        CONSTRAINT \`fk_products_categories\` FOREIGN KEY (\`category_id\`) REFERENCES \`categories\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`product_variants\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`product_id\` VARCHAR(64) NOT NULL,
        \`size_name\` VARCHAR(50) NOT NULL,
        \`extra_price\` DOUBLE NOT NULL DEFAULT 0,
        \`is_default\` TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        KEY \`idx_variants_product\` (\`product_id\`),
        CONSTRAINT \`fk_variants_products\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`product_options\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(120) NOT NULL,
        \`is_required\` TINYINT(1) NOT NULL DEFAULT 0,
        \`is_multiple\` TINYINT(1) NOT NULL DEFAULT 0,
        \`display_order\` INT NOT NULL DEFAULT 1,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`product_option_values\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`option_id\` INT NOT NULL,
        \`name\` VARCHAR(150) NOT NULL,
        \`extra_price\` DOUBLE NOT NULL DEFAULT 0,
        \`is_default\` TINYINT(1) NOT NULL DEFAULT 0,
        \`display_order\` INT NOT NULL DEFAULT 1,
        PRIMARY KEY (\`id\`),
        KEY \`idx_optval_option\` (\`option_id\`),
        CONSTRAINT \`fk_optval_options\` FOREIGN KEY (\`option_id\`) REFERENCES \`product_options\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`business_settings\` (
        \`id\` INT NOT NULL,
        \`store_name\` VARCHAR(255) NOT NULL,
        \`store_status\` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
        \`store_status_message\` TEXT DEFAULT NULL,
        \`hotline\` VARCHAR(50) DEFAULT NULL,
        \`phone\` VARCHAR(50) DEFAULT NULL,
        \`address\` VARCHAR(255) DEFAULT NULL,
        \`open_time\` VARCHAR(20) DEFAULT NULL,
        \`close_time\` VARCHAR(20) DEFAULT NULL,
        \`shipping_fee_mode\` VARCHAR(30) NOT NULL DEFAULT 'AUTO',
        \`base_delivery_fee\` DOUBLE NOT NULL DEFAULT 15000,
        \`free_delivery_min_cups\` INT NOT NULL DEFAULT 3,
        \`max_slot_capacity_cups\` INT NOT NULL DEFAULT 30,
        \`prep_lead_time_minutes\` INT NOT NULL DEFAULT 5,
        \`vietqr_bank_id\` VARCHAR(30) DEFAULT 'MB',
        \`vietqr_account_no\` VARCHAR(50) DEFAULT '999988886666',
        \`vietqr_account_name\` VARCHAR(150) DEFAULT 'CA XOI CAFE',
        \`bank_account_no\` VARCHAR(50) DEFAULT NULL,
        \`bank_account_name\` VARCHAR(150) DEFAULT NULL,
        \`bank_bin\` VARCHAR(30) DEFAULT NULL,
        \`bank_name\` VARCHAR(150) DEFAULT NULL,
        \`is_auto_confirm_qr\` TINYINT(1) NOT NULL DEFAULT 1,
        \`rush_mode_message\` TEXT DEFAULT NULL,
        \`hero_badge_brand\` TEXT DEFAULT NULL,
        \`hero_location\` TEXT DEFAULT NULL,
        \`hero_eyebrow\` TEXT DEFAULT NULL,
        \`hero_headline_primary\` TEXT DEFAULT NULL,
        \`hero_headline_highlight\` TEXT DEFAULT NULL,
        \`hero_description\` TEXT DEFAULT NULL,
        \`hero_service_note\` TEXT DEFAULT NULL,
        \`hero_price_badge_1\` TEXT DEFAULT NULL,
        \`hero_price_badge_2\` TEXT DEFAULT NULL,
        \`hero_price_badge_3\` TEXT DEFAULT NULL,
        \`hero_primary_cta_text\` TEXT DEFAULT NULL,
        \`hero_secondary_cta_text\` TEXT DEFAULT NULL,
        \`hero_watermark_text\` TEXT DEFAULT NULL,
        \`hero_logo_url\` TEXT DEFAULT NULL,
        \`hero_mascot_title\` TEXT DEFAULT NULL,
        \`hero_mascot_subtitle\` TEXT DEFAULT NULL,
        \`facebook_url\` TEXT DEFAULT NULL,
        \`qr_facebook_title\` TEXT DEFAULT NULL,
        \`qr_facebook_subtitle\` TEXT DEFAULT NULL,
        \`xanh_sm_url\` TEXT DEFAULT NULL,
        \`qr_xanh_sm_title\` TEXT DEFAULT NULL,
        \`qr_xanh_sm_subtitle\` TEXT DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`companies\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(150) NOT NULL,
        \`building_name\` VARCHAR(150) NOT NULL,
        \`address\` VARCHAR(255) NOT NULL,
        \`is_partner\` TINYINT(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`promotions\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`code\` VARCHAR(50) NOT NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`discount_type\` VARCHAR(30) NOT NULL,
        \`discount_value\` DOUBLE NOT NULL,
        \`min_order_amount\` DOUBLE NOT NULL DEFAULT 0,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`max_discount_amount\` DOUBLE DEFAULT NULL,
        \`usage_limit\` INT DEFAULT NULL,
        \`used_count\` INT NOT NULL DEFAULT 0,
        \`start_time\` VARCHAR(64) DEFAULT NULL,
        \`end_time\` VARCHAR(64) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_promotions_code\` (\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`group_sessions\` (
        \`id\` VARCHAR(64) NOT NULL,
        \`session_code\` VARCHAR(32) NOT NULL,
        \`host_name\` VARCHAR(120) NOT NULL,
        \`host_phone\` VARCHAR(30) NOT NULL,
        \`host_token\` VARCHAR(128) DEFAULT NULL,
        \`building_name\` VARCHAR(255) DEFAULT NULL,
        \`status\` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
        \`expires_at\` VARCHAR(64) NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_group_sessions_code\` (\`session_code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`group_session_items\` (
        \`id\` VARCHAR(64) NOT NULL,
        \`session_code\` VARCHAR(32) NOT NULL,
        \`cart_item_id\` VARCHAR(64) DEFAULT NULL,
        \`product_id\` VARCHAR(64) NOT NULL,
        \`product_name\` VARCHAR(150) NOT NULL,
        \`variant_name\` VARCHAR(50) NOT NULL,
        \`quantity\` INT NOT NULL DEFAULT 1,
        \`unit_price\` DOUBLE NOT NULL,
        \`total_price\` DOUBLE NOT NULL,
        \`recipient_label\` VARCHAR(120) DEFAULT NULL,
        \`notes\` TEXT DEFAULT NULL,
        \`item_payload_json\` LONGTEXT DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_gsi_session_code\` (\`session_code\`),
        CONSTRAINT \`fk_gsi_session\` FOREIGN KEY (\`session_code\`) REFERENCES \`group_sessions\` (\`session_code\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`orders\` (
        \`id\` VARCHAR(64) NOT NULL,
        \`order_code\` VARCHAR(40) NOT NULL,
        \`order_type\` VARCHAR(30) NOT NULL DEFAULT 'OFFICE_DELIVERY',
        \`recipient_name\` VARCHAR(120) NOT NULL,
        \`recipient_phone\` VARCHAR(30) NOT NULL,
        \`company_name\` VARCHAR(150) DEFAULT NULL,
        \`building_name\` VARCHAR(200) DEFAULT NULL,
        \`floor_room\` VARCHAR(80) DEFAULT NULL,
        \`delivery_address\` VARCHAR(255) DEFAULT NULL,
        \`delivery_notes\` TEXT DEFAULT NULL,
        \`scheduled_type\` VARCHAR(20) DEFAULT 'ASAP',
        \`scheduled_time\` VARCHAR(64) DEFAULT NULL,
        \`subtotal_amount\` DOUBLE NOT NULL,
        \`discount_amount\` DOUBLE NOT NULL DEFAULT 0,
        \`delivery_fee\` DOUBLE NOT NULL DEFAULT 0,
        \`total_amount\` DOUBLE NOT NULL,
        \`payment_method\` VARCHAR(40) NOT NULL,
        \`payment_status\` VARCHAR(30) NOT NULL,
        \`status\` VARCHAR(30) NOT NULL,
        \`promotion_code\` VARCHAR(50) DEFAULT NULL,
        \`group_session_id\` VARCHAR(64) DEFAULT NULL,
        \`barista_notes\` TEXT DEFAULT NULL,
        \`shipper_name\` VARCHAR(120) DEFAULT NULL,
        \`shipper_phone\` VARCHAR(30) DEFAULT NULL,
        \`estimated_delivery_time\` VARCHAR(80) DEFAULT NULL,
        \`tracking_notes\` TEXT DEFAULT NULL,
        \`tracking_token\` VARCHAR(128) DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_orders_code\` (\`order_code\`),
        KEY \`idx_orders_created_at\` (\`created_at\`),
        KEY \`idx_orders_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`order_items\` (
        \`id\` VARCHAR(64) NOT NULL,
        \`order_id\` VARCHAR(64) NOT NULL,
        \`product_id\` VARCHAR(64) NOT NULL,
        \`product_name\` VARCHAR(150) NOT NULL,
        \`variant_name\` VARCHAR(50) NOT NULL,
        \`quantity\` INT NOT NULL,
        \`unit_price\` DOUBLE NOT NULL,
        \`total_price\` DOUBLE NOT NULL,
        \`recipient_label\` VARCHAR(120) DEFAULT NULL,
        \`item_notes\` TEXT DEFAULT NULL,
        \`selected_options_json\` LONGTEXT DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_order_items_order_id\` (\`order_id\`),
        CONSTRAINT \`fk_order_items_order\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`webhook_transactions\` (
        \`tx_id\` VARCHAR(128) NOT NULL,
        \`order_id\` VARCHAR(64) NOT NULL,
        \`order_code\` VARCHAR(40) NOT NULL,
        \`amount\` DOUBLE NOT NULL,
        \`gateway\` VARCHAR(50) DEFAULT NULL,
        \`processed_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`tx_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`rate_limits\` (
        \`key\` VARCHAR(191) NOT NULL,
        \`count\` INT NOT NULL DEFAULT 0,
        \`window_start\` BIGINT NOT NULL,
        \`locked_until\` BIGINT NOT NULL DEFAULT 0,
        \`updated_at\` BIGINT NOT NULL,
        PRIMARY KEY (\`key\`),
        KEY \`idx_rate_limits_updated_at\` (\`updated_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`audit_logs\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`actor_id\` VARCHAR(64) DEFAULT NULL,
        \`actor_username\` VARCHAR(80) NOT NULL,
        \`actor_role\` VARCHAR(40) NOT NULL,
        \`action\` VARCHAR(80) NOT NULL,
        \`target_type\` VARCHAR(40) NOT NULL,
        \`target_id\` VARCHAR(120) DEFAULT NULL,
        \`summary\` VARCHAR(500) NOT NULL,
        \`metadata_json\` TEXT DEFAULT NULL,
        \`ip_address\` VARCHAR(64) DEFAULT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_audit_logs_created_at\` (\`created_at\`),
        KEY \`idx_audit_logs_action\` (\`action\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`password_resets\` (
        \`user_id\` VARCHAR(64) NOT NULL,
        \`otp_hash\` VARCHAR(255) NOT NULL,
        \`attempts\` INT NOT NULL DEFAULT 0,
        \`expires_at\` BIGINT NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 2. Non-destructive column & schema upgrades cho 12 bảng Hostinger (phpmyadmin_caxoi_cafe.sql)
    const userMeta = await getColumnMetadata(conn, "users");
    const userCols = new Set(userMeta.keys());
    await addColumnIfMissing(conn, userCols, "users", "email", "VARCHAR(150) DEFAULT NULL");
    await addColumnIfMissing(conn, userCols, "users", "token_version", "INT NOT NULL DEFAULT 1");
    if (
      (userMeta.get("id")?.maxLength ?? 64) < 64 ||
      (userMeta.get("pin")?.maxLength ?? 255) < 255 ||
      (userMeta.get("full_name")?.maxLength ?? 120) < 120 ||
      (userMeta.get("phone")?.maxLength ?? 30) < 30
    ) {
      try {
        await conn.query(`
          ALTER TABLE \`users\`
            MODIFY COLUMN \`id\` VARCHAR(64) NOT NULL,
            MODIFY COLUMN \`pin\` VARCHAR(255) DEFAULT NULL,
            MODIFY COLUMN \`full_name\` VARCHAR(120) NOT NULL,
            MODIFY COLUMN \`phone\` VARCHAR(30) DEFAULT NULL
        `);
      } catch (err: any) {
        console.warn("[MySQL Auto-Migration] Không thể mở rộng cột bảng users:", err?.message);
      }
    }

    const orderMeta = await getColumnMetadata(conn, "orders");
    const orderCols = new Set(orderMeta.keys());
    await addColumnIfMissing(conn, orderCols, "orders", "shipper_name", "VARCHAR(120) DEFAULT NULL");
    await addColumnIfMissing(conn, orderCols, "orders", "shipper_phone", "VARCHAR(30) DEFAULT NULL");
    await addColumnIfMissing(conn, orderCols, "orders", "estimated_delivery_time", "VARCHAR(80) DEFAULT NULL");
    await addColumnIfMissing(conn, orderCols, "orders", "tracking_notes", "TEXT DEFAULT NULL");
    await addColumnIfMissing(conn, orderCols, "orders", "tracking_token", "VARCHAR(128) DEFAULT NULL");

    const orderItemMeta = await getColumnMetadata(conn, "order_items");
    const orderItemCols = new Set(orderItemMeta.keys());
    await addColumnIfMissing(conn, orderItemCols, "order_items", "selected_options_json", "LONGTEXT DEFAULT NULL");
    await addColumnIfMissing(conn, orderItemCols, "order_items", "item_notes", "TEXT DEFAULT NULL");

    // Mở rộng orders.id & order_items.(id, order_id, product_id) từ VARCHAR(36) -> VARCHAR(64) an toàn với FK InnoDB
    if (
      (orderMeta.get("id")?.maxLength ?? 64) < 64 ||
      (orderItemMeta.get("id")?.maxLength ?? 64) < 64 ||
      (orderItemMeta.get("order_id")?.maxLength ?? 64) < 64 ||
      (orderItemMeta.get("product_id")?.maxLength ?? 64) < 64
    ) {
      try {
        const [fkRows] = await conn.query<RowDataPacket[]>(
          `SELECT DISTINCT CONSTRAINT_NAME
           FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'order_items'
             AND REFERENCED_TABLE_NAME = 'orders'`
        );
        for (const fk of fkRows) {
          const fkName = String(fk.CONSTRAINT_NAME || "").trim();
          if (fkName) {
            await conn.query(`ALTER TABLE \`order_items\` DROP FOREIGN KEY \`${fkName}\``);
          }
        }
        await conn.query(`ALTER TABLE \`orders\` MODIFY COLUMN \`id\` VARCHAR(64) NOT NULL`);
        await conn.query(`
          ALTER TABLE \`order_items\`
            MODIFY COLUMN \`id\` VARCHAR(64) NOT NULL,
            MODIFY COLUMN \`order_id\` VARCHAR(64) NOT NULL,
            MODIFY COLUMN \`product_id\` VARCHAR(64) NOT NULL
        `);
        await conn.query(`
          ALTER TABLE \`order_items\`
            ADD CONSTRAINT \`fk_order_items_order\`
            FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE CASCADE
        `);
      } catch (err: any) {
        console.warn("[MySQL Auto-Migration] Không thể mở rộng khóa orders/order_items:", err?.message);
      }
    }

    // Chuyển các cột ENUM / DATETIME / VARCHAR ngắn của bảng orders sang VARCHAR chuẩn ứng dụng
    if (
      orderMeta.get("payment_status")?.dataType === "enum" ||
      orderMeta.get("payment_method")?.dataType === "enum" ||
      orderMeta.get("order_type")?.dataType === "enum" ||
      orderMeta.get("status")?.dataType === "enum" ||
      orderMeta.get("scheduled_type")?.dataType === "enum" ||
      orderMeta.get("scheduled_time")?.dataType === "datetime" ||
      (orderMeta.get("group_session_id")?.maxLength ?? 64) < 64 ||
      (orderMeta.get("building_name")?.maxLength ?? 200) < 200 ||
      (orderMeta.get("floor_room")?.maxLength ?? 80) < 80
    ) {
      try {
        await conn.query(`
          ALTER TABLE \`orders\`
            MODIFY COLUMN \`order_code\` VARCHAR(40) NOT NULL,
            MODIFY COLUMN \`group_session_id\` VARCHAR(64) DEFAULT NULL,
            MODIFY COLUMN \`order_type\` VARCHAR(30) NOT NULL DEFAULT 'OFFICE_DELIVERY',
            MODIFY COLUMN \`status\` VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED',
            MODIFY COLUMN \`payment_status\` VARCHAR(30) NOT NULL DEFAULT 'UNPAID',
            MODIFY COLUMN \`payment_method\` VARCHAR(40) NOT NULL DEFAULT 'VIETQR_BANKING',
            MODIFY COLUMN \`recipient_name\` VARCHAR(120) NOT NULL,
            MODIFY COLUMN \`recipient_phone\` VARCHAR(30) NOT NULL,
            MODIFY COLUMN \`building_name\` VARCHAR(200) DEFAULT NULL,
            MODIFY COLUMN \`floor_room\` VARCHAR(80) DEFAULT NULL,
            MODIFY COLUMN \`scheduled_type\` VARCHAR(20) DEFAULT 'ASAP',
            MODIFY COLUMN \`scheduled_time\` VARCHAR(64) DEFAULT NULL
        `);
        await conn.query(`UPDATE \`orders\` SET \`payment_status\` = 'UNPAID' WHERE \`payment_status\` = 'PENDING'`);
      } catch (err: any) {
        console.warn("[MySQL Auto-Migration] Không thể nâng cấp cột bảng orders:", err?.message);
      }
    }

    const groupCols = await getExistingColumns(conn, "group_sessions");
    await addColumnIfMissing(conn, groupCols, "group_sessions", "host_token", "VARCHAR(128) DEFAULT NULL");

    // Chuyển đổi bảng business_settings từ dạng key-value (phpmyadmin_caxoi_cafe.sql) sang dạng 1 dòng mở rộng
    let settingsCols = await getExistingColumns(conn, "business_settings");
    if (settingsCols.has("setting_key") && !settingsCols.has("id")) {
      try {
        const [kvRows] = await conn.query<RowDataPacket[]>(
          `SELECT \`setting_key\`, \`setting_value\` FROM \`business_settings\``
        );
        const kv = new Map<string, string>();
        for (const r of kvRows) {
          kv.set(String(r.setting_key || "").toUpperCase(), String(r.setting_value ?? ""));
        }
        await conn.query(`DROP TABLE \`business_settings\``);
        await conn.query(`
          CREATE TABLE \`business_settings\` (
            \`id\` INT NOT NULL,
            \`store_name\` VARCHAR(255) NOT NULL,
            \`store_status\` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
            \`store_status_message\` TEXT DEFAULT NULL,
            \`hotline\` VARCHAR(50) DEFAULT NULL,
            \`phone\` VARCHAR(50) DEFAULT NULL,
            \`address\` VARCHAR(255) DEFAULT NULL,
            \`open_time\` VARCHAR(20) DEFAULT NULL,
            \`close_time\` VARCHAR(20) DEFAULT NULL,
            \`shipping_fee_mode\` VARCHAR(30) NOT NULL DEFAULT 'AUTO',
            \`base_delivery_fee\` DOUBLE NOT NULL DEFAULT 15000,
            \`free_delivery_min_cups\` INT NOT NULL DEFAULT 3,
            \`max_slot_capacity_cups\` INT NOT NULL DEFAULT 30,
            \`prep_lead_time_minutes\` INT NOT NULL DEFAULT 5,
            \`vietqr_bank_id\` VARCHAR(30) DEFAULT 'MB',
            \`vietqr_account_no\` VARCHAR(50) DEFAULT '999988886666',
            \`vietqr_account_name\` VARCHAR(150) DEFAULT 'CA XOI CAFE',
            \`bank_account_no\` VARCHAR(50) DEFAULT NULL,
            \`bank_account_name\` VARCHAR(150) DEFAULT NULL,
            \`bank_bin\` VARCHAR(30) DEFAULT NULL,
            \`bank_name\` VARCHAR(150) DEFAULT NULL,
            \`is_auto_confirm_qr\` TINYINT(1) NOT NULL DEFAULT 1,
            \`rush_mode_message\` TEXT DEFAULT NULL,
            \`hero_badge_brand\` TEXT DEFAULT NULL,
            \`hero_location\` TEXT DEFAULT NULL,
            \`hero_eyebrow\` TEXT DEFAULT NULL,
            \`hero_headline_primary\` TEXT DEFAULT NULL,
            \`hero_headline_highlight\` TEXT DEFAULT NULL,
            \`hero_description\` TEXT DEFAULT NULL,
            \`hero_service_note\` TEXT DEFAULT NULL,
            \`hero_price_badge_1\` TEXT DEFAULT NULL,
            \`hero_price_badge_2\` TEXT DEFAULT NULL,
            \`hero_price_badge_3\` TEXT DEFAULT NULL,
            \`hero_primary_cta_text\` TEXT DEFAULT NULL,
            \`hero_secondary_cta_text\` TEXT DEFAULT NULL,
            \`hero_watermark_text\` TEXT DEFAULT NULL,
            \`hero_logo_url\` TEXT DEFAULT NULL,
            \`hero_mascot_title\` TEXT DEFAULT NULL,
            \`hero_mascot_subtitle\` TEXT DEFAULT NULL,
            \`facebook_url\` TEXT DEFAULT NULL,
            \`qr_facebook_title\` TEXT DEFAULT NULL,
            \`qr_facebook_subtitle\` TEXT DEFAULT NULL,
            \`xanh_sm_url\` TEXT DEFAULT NULL,
            \`qr_xanh_sm_title\` TEXT DEFAULT NULL,
            \`qr_xanh_sm_subtitle\` TEXT DEFAULT NULL,
            PRIMARY KEY (\`id\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        const mergedHotline = kv.get("HOTLINE") || INITIAL_SETTINGS.hotline;
        await conn.query(
          `INSERT INTO \`business_settings\` (
            id, store_name, store_status, store_status_message, hotline, phone, address,
            open_time, close_time, shipping_fee_mode, base_delivery_fee, free_delivery_min_cups,
            max_slot_capacity_cups, prep_lead_time_minutes, vietqr_bank_id, vietqr_account_no, vietqr_account_name,
            hero_badge_brand, hero_location, hero_eyebrow, hero_headline_primary, hero_headline_highlight,
            hero_description, hero_service_note, hero_price_badge_1, hero_price_badge_2, hero_price_badge_3,
            hero_primary_cta_text, hero_secondary_cta_text, hero_watermark_text, hero_logo_url,
            hero_mascot_title, hero_mascot_subtitle, facebook_url, qr_facebook_title, qr_facebook_subtitle,
            xanh_sm_url, qr_xanh_sm_title, qr_xanh_sm_subtitle
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            1,
            kv.get("STORE_NAME") || INITIAL_SETTINGS.storeName,
            kv.get("STORE_STATUS") || INITIAL_SETTINGS.storeStatus,
            kv.get("STORE_STATUS_MESSAGE") || INITIAL_SETTINGS.storeStatusMessage,
            mergedHotline,
            mergedHotline,
            "Hải Châu, Thanh Khê, Ngũ Hành Sơn, Đà Nẵng",
            kv.get("OPEN_TIME") || INITIAL_SETTINGS.openTime,
            kv.get("CLOSE_TIME") || INITIAL_SETTINGS.closeTime,
            INITIAL_SETTINGS.shippingFeeMode || "AUTO",
            Number(kv.get("BASE_DELIVERY_FEE")) || INITIAL_SETTINGS.baseDeliveryFee,
            Number(kv.get("FREE_DELIVERY_MIN_CUPS")) || INITIAL_SETTINGS.freeDeliveryMinCups,
            Number(kv.get("MAX_SLOT_CAPACITY_CUPS")) || INITIAL_SETTINGS.maxSlotCapacityCups,
            Number(kv.get("PREPARATION_LEAD_TIME_MINUTES")) || INITIAL_SETTINGS.prepLeadTimeMinutes,
            kv.get("VIETQR_BANK_ID") || INITIAL_SETTINGS.vietqrBankId,
            kv.get("VIETQR_ACCOUNT_NO") || INITIAL_SETTINGS.vietqrAccountNo,
            kv.get("VIETQR_ACCOUNT_NAME") || INITIAL_SETTINGS.vietqrAccountName,
            INITIAL_SETTINGS.heroBadgeBrand,
            INITIAL_SETTINGS.heroLocation,
            INITIAL_SETTINGS.heroEyebrow,
            INITIAL_SETTINGS.heroHeadlinePrimary,
            INITIAL_SETTINGS.heroHeadlineHighlight,
            INITIAL_SETTINGS.heroDescription,
            INITIAL_SETTINGS.heroServiceNote,
            INITIAL_SETTINGS.heroPriceBadge1,
            INITIAL_SETTINGS.heroPriceBadge2,
            INITIAL_SETTINGS.heroPriceBadge3,
            INITIAL_SETTINGS.heroPrimaryCtaText,
            INITIAL_SETTINGS.heroSecondaryCtaText,
            INITIAL_SETTINGS.heroWatermarkText,
            INITIAL_SETTINGS.heroLogoUrl,
            INITIAL_SETTINGS.heroMascotTitle,
            INITIAL_SETTINGS.heroMascotSubtitle,
            INITIAL_SETTINGS.facebookUrl,
            INITIAL_SETTINGS.qrFacebookTitle,
            INITIAL_SETTINGS.qrFacebookSubtitle,
            INITIAL_SETTINGS.xanhSmUrl,
            INITIAL_SETTINGS.qrXanhSmTitle,
            INITIAL_SETTINGS.qrXanhSmSubtitle,
          ]
        );
        settingsCols = await getExistingColumns(conn, "business_settings");
        console.info("[MySQL Auto-Migration] Đã chuyển đổi bảng business_settings từ key-value sang cấu trúc chuẩn.");
      } catch (err: any) {
        console.warn("[MySQL Auto-Migration] Không thể chuyển đổi business_settings:", err?.message);
      }
    }
    if (settingsCols.has("id")) {
      await addColumnIfMissing(conn, settingsCols, "business_settings", "shipping_fee_mode", "VARCHAR(30) NOT NULL DEFAULT 'AUTO'");
      for (const def of HERO_SETTINGS_COLUMNS) {
        await addColumnIfMissing(conn, settingsCols, "business_settings", def.col, "TEXT DEFAULT NULL");
      }
    }

    // Nâng cấp bảng promotions từ schema cũ (PK code, description, ENUM PERCENT/FIXED_AMOUNT/FREE_SHIP)
    const promoMeta = await getColumnMetadata(conn, "promotions");
    const promoCols = new Set(promoMeta.keys());
    if (!promoCols.has("id")) {
      try {
        await conn.query(`
          ALTER TABLE \`promotions\`
            DROP PRIMARY KEY,
            ADD COLUMN \`id\` INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST,
            ADD UNIQUE KEY \`uq_promotions_code\` (\`code\`)
        `);
        promoCols.add("id");
      } catch (err: any) {
        console.warn("[MySQL Auto-Migration] Không thể thêm cột id cho promotions:", err?.message);
      }
    }
    if (!promoCols.has("name")) {
      try {
        await conn.query(`ALTER TABLE \`promotions\` ADD COLUMN \`name\` VARCHAR(255) NOT NULL DEFAULT '' AFTER \`code\``);
        promoCols.add("name");
        if (promoCols.has("description")) {
          await conn.query(`UPDATE \`promotions\` SET \`name\` = \`description\` WHERE \`name\` = ''`);
          await conn.query(`ALTER TABLE \`promotions\` MODIFY COLUMN \`description\` VARCHAR(255) DEFAULT NULL`);
        }
      } catch (err: any) {
        console.warn("[MySQL Auto-Migration] Không thể thêm cột name cho promotions:", err?.message);
      }
    }
    if (
      promoMeta.get("discount_type")?.dataType === "enum" ||
      promoMeta.get("start_time")?.dataType === "datetime" ||
      promoMeta.get("end_time")?.dataType === "datetime" ||
      promoMeta.get("usage_limit")?.isNullable === false
    ) {
      try {
        await conn.query(`
          ALTER TABLE \`promotions\`
            MODIFY COLUMN \`code\` VARCHAR(50) NOT NULL,
            MODIFY COLUMN \`discount_type\` VARCHAR(30) NOT NULL,
            MODIFY COLUMN \`usage_limit\` INT DEFAULT NULL,
            MODIFY COLUMN \`start_time\` VARCHAR(64) DEFAULT NULL,
            MODIFY COLUMN \`end_time\` VARCHAR(64) DEFAULT NULL
        `);
        await conn.query(`UPDATE \`promotions\` SET \`discount_type\` = 'PERCENTAGE' WHERE \`discount_type\` = 'PERCENT'`);
        await conn.query(`UPDATE \`promotions\` SET \`discount_type\` = 'FIXED' WHERE \`discount_type\` = 'FIXED_AMOUNT'`);
        await conn.query(`UPDATE \`promotions\` SET \`discount_type\` = 'FREESHIP' WHERE \`discount_type\` = 'FREE_SHIP'`);
      } catch (err: any) {
        console.warn("[MySQL Auto-Migration] Không thể nâng cấp kiểu cột promotions:", err?.message);
      }
    }
    await addColumnIfMissing(conn, promoCols, "promotions", "max_discount_amount", "DOUBLE DEFAULT NULL");
    await addColumnIfMissing(conn, promoCols, "promotions", "usage_limit", "INT DEFAULT NULL");
    await addColumnIfMissing(conn, promoCols, "promotions", "used_count", "INT NOT NULL DEFAULT 0");
    await addColumnIfMissing(conn, promoCols, "promotions", "start_time", "VARCHAR(64) DEFAULT NULL");
    await addColumnIfMissing(conn, promoCols, "promotions", "end_time", "VARCHAR(64) DEFAULT NULL");

    // 3. Auto-seed dữ liệu nền tảng (chỉ nạp khi bảng trống)
    for (const [id, name, description] of DEFAULT_ROLES) {
      await conn.query(
        `INSERT IGNORE INTO \`roles\` (\`id\`, \`name\`, \`description\`) VALUES (?, ?, ?)`,
        [id, name, description]
      );
    }

    for (const [id, code, name, category, description] of DEFAULT_PERMISSIONS) {
      await conn.query(
        `INSERT IGNORE INTO \`permissions\` (\`id\`, \`code\`, \`name\`, \`category\`, \`description\`) VALUES (?, ?, ?, ?, ?)`,
        [id, code, name, category, description]
      );
    }

    const [rpCountRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM \`role_permissions\``);
    if (Number(rpCountRows[0]?.cnt || 0) === 0) {
      for (const [roleName, permCode] of DEFAULT_ROLE_PERMISSIONS) {
        await conn.query(
          `INSERT IGNORE INTO \`role_permissions\` (\`role_name\`, \`permission_code\`) VALUES (?, ?)`,
          [roleName, permCode]
        );
      }
    }

    // Tự động khởi tạo tài khoản SUPER_ADMIN từ ADMIN_USERNAME & ADMIN_PASSWORD (hoặc INIT_ADMIN_PASSWORD)
    const envAdminUsername = (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
    const envInitPwd = (process.env.ADMIN_PASSWORD || process.env.INIT_ADMIN_PASSWORD || "").trim();
    const envAdminEmail = process.env.ADMIN_EMAIL?.trim() || null;

    if (envAdminUsername && envInitPwd.length >= 8) {
      const [adminRows] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM \`users\` WHERE LOWER(username) = ? LIMIT 1`,
        [envAdminUsername]
      );
      if (adminRows.length === 0) {
        await conn.query(
          `INSERT INTO \`users\` (\`id\`, \`username\`, \`password_hash\`, \`plain_password\`, \`pin\`, \`full_name\`, \`phone\`, \`email\`, \`role_id\`, \`is_active\`, \`token_version\`)
           VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, 1, 1, 1)`,
          [
            crypto.randomUUID(),
            envAdminUsername,
            hashPassword(envInitPwd),
            "Quản Trị Viên (Chủ Quán)",
            "0905249733",
            envAdminEmail,
          ]
        );
        console.info(
          `[MySQL Auto-Migration] Đã tự động tạo tài khoản "${envAdminUsername}" (SUPER_ADMIN) từ biến môi trường.`
        );
      }
    }

    const [userCountRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM \`users\``);
    const totalUsers = Number(userCountRows[0]?.cnt || 0);

    if (totalUsers > 0) {
      // Nâng cấp bảo mật cho user đã tồn tại (plain_password / INIT_REQUIRED / unhashed PIN)
      const [existingUsers] = await conn.query<RowDataPacket[]>(`
        SELECT u.id, u.username, u.password_hash, u.plain_password, u.pin, r.name as role_name
        FROM users u
        JOIN roles r ON u.role_id = r.id
      `);
      for (const u of existingUsers) {
        if (u.plain_password && String(u.plain_password).trim()) {
          if (!isScryptHash(String(u.password_hash || ""))) {
            await conn.query(`UPDATE users SET password_hash = ?, plain_password = NULL WHERE id = ?`, [
              hashPassword(String(u.plain_password).trim()),
              u.id,
            ]);
          } else {
            await conn.query(`UPDATE users SET plain_password = NULL WHERE id = ?`, [u.id]);
          }
        } else if (u.password_hash === "INIT_REQUIRED" && u.role_name === "SUPER_ADMIN") {
          const bootstrapPwd =
            envInitPwd && envInitPwd.length >= 8
              ? envInitPwd
              : `Cx!${crypto.randomBytes(9).toString("base64url")}`;
          await conn.query(`UPDATE users SET password_hash = ?, plain_password = NULL WHERE id = ?`, [
            hashPassword(bootstrapPwd),
            u.id,
          ]);
          if (!envInitPwd || envInitPwd.length < 8) {
            console.warn(
              `[Cà Xòi Security Bootstrap] Tài khoản "${u.username}" đã được khởi tạo mật khẩu ngẫu nhiên 1 lần: ${bootstrapPwd}`
            );
          }
        }

        if ((u.role_name === "SUPER_ADMIN" || u.role_name === "STORE_MANAGER") && u.pin) {
          await conn.query(`UPDATE users SET pin = NULL WHERE id = ?`, [u.id]);
        } else if (
          (u.role_name === "BARISTA" || u.role_name === "CASHIER") &&
          u.pin &&
          String(u.pin).trim() &&
          !isScryptHash(String(u.pin).trim())
        ) {
          await conn.query(`UPDATE users SET pin = ? WHERE id = ?`, [hashPassword(String(u.pin).trim()), u.id]);
        }
      }
    }

    // Seed categories, products, variants nếu trống
    const [catCountRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM \`categories\``);
    if (Number(catCountRows[0]?.cnt || 0) === 0) {
      for (const c of INITIAL_CATEGORIES) {
        await conn.query(
          `INSERT INTO \`categories\` (\`id\`, \`name\`, \`slug\`, \`description\`, \`image_url\`, \`display_order\`, \`is_active\`)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [c.id, c.name, c.slug, c.description || "", c.imageUrl || "", c.displayOrder, c.isActive ? 1 : 0]
        );
      }
    }

    const [prodCountRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM \`products\``);
    if (Number(prodCountRows[0]?.cnt || 0) === 0) {
      for (const p of INITIAL_PRODUCTS) {
        await conn.query(
          `INSERT INTO \`products\` (\`id\`, \`category_id\`, \`name\`, \`slug\`, \`description\`, \`image_url\`, \`base_price\`, \`sale_price\`, \`is_available\`, \`is_featured\`, \`prep_time_minutes\`, \`tags\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id,
            p.categoryId,
            p.name,
            p.slug,
            p.description || "",
            p.imageUrl || "",
            p.basePrice,
            p.salePrice ?? null,
            p.isAvailable ? 1 : 0,
            p.isFeatured ? 1 : 0,
            p.prepTimeMinutes || 4,
            Array.isArray(p.tags) ? p.tags.join(",") : "",
          ]
        );
        for (const v of p.variants) {
          await conn.query(
            `INSERT INTO \`product_variants\` (\`product_id\`, \`size_name\`, \`extra_price\`, \`is_default\`)
             VALUES (?, ?, ?, ?)`,
            [p.id, v.sizeName, v.extraPrice, v.isDefault ? 1 : 0]
          );
        }
      }
    }

    // Seed product_options & values nếu trống
    const [optCountRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM \`product_options\``);
    if (Number(optCountRows[0]?.cnt || 0) === 0) {
      for (const [id, name, isReq, isMul, ord] of DEFAULT_OPTIONS) {
        await conn.query(
          `INSERT INTO \`product_options\` (\`id\`, \`name\`, \`is_required\`, \`is_multiple\`, \`display_order\`)
           VALUES (?, ?, ?, ?, ?)`,
          [id, name, isReq, isMul, ord]
        );
      }
      for (const [id, optId, name, extra, isDef, ord] of DEFAULT_OPTION_VALUES) {
        await conn.query(
          `INSERT INTO \`product_option_values\` (\`id\`, \`option_id\`, \`name\`, \`extra_price\`, \`is_default\`, \`display_order\`)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, optId, name, extra, isDef, ord]
        );
      }
    }

    // Seed business_settings nếu trống
    if (settingsCols.has("id")) {
      const [bsCountRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM \`business_settings\``);
      if (Number(bsCountRows[0]?.cnt || 0) === 0) {
        await conn.query(
          `INSERT INTO \`business_settings\` (
            \`id\`, \`store_name\`, \`store_status\`, \`store_status_message\`, \`hotline\`, \`phone\`, \`address\`,
            \`open_time\`, \`close_time\`, \`shipping_fee_mode\`, \`base_delivery_fee\`, \`free_delivery_min_cups\`,
            \`max_slot_capacity_cups\`, \`prep_lead_time_minutes\`, \`vietqr_bank_id\`, \`vietqr_account_no\`, \`vietqr_account_name\`,
            \`hero_badge_brand\`, \`hero_location\`, \`hero_eyebrow\`, \`hero_headline_primary\`, \`hero_headline_highlight\`,
            \`hero_description\`, \`hero_service_note\`, \`hero_price_badge_1\`, \`hero_price_badge_2\`, \`hero_price_badge_3\`,
            \`hero_primary_cta_text\`, \`hero_secondary_cta_text\`, \`hero_watermark_text\`, \`hero_logo_url\`,
            \`hero_mascot_title\`, \`hero_mascot_subtitle\`, \`facebook_url\`, \`qr_facebook_title\`, \`qr_facebook_subtitle\`,
            \`xanh_sm_url\`, \`qr_xanh_sm_title\`, \`qr_xanh_sm_subtitle\`
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            1,
            INITIAL_SETTINGS.storeName,
            INITIAL_SETTINGS.storeStatus,
            INITIAL_SETTINGS.storeStatusMessage,
            INITIAL_SETTINGS.hotline,
            INITIAL_SETTINGS.hotline,
            INITIAL_SETTINGS.heroLocation,
            INITIAL_SETTINGS.openTime,
            INITIAL_SETTINGS.closeTime,
            INITIAL_SETTINGS.shippingFeeMode,
            INITIAL_SETTINGS.baseDeliveryFee,
            INITIAL_SETTINGS.freeDeliveryMinCups,
            INITIAL_SETTINGS.maxSlotCapacityCups,
            INITIAL_SETTINGS.prepLeadTimeMinutes,
            INITIAL_SETTINGS.vietqrBankId,
            INITIAL_SETTINGS.vietqrAccountNo,
            INITIAL_SETTINGS.vietqrAccountName,
            INITIAL_SETTINGS.heroBadgeBrand,
            INITIAL_SETTINGS.heroLocation,
            INITIAL_SETTINGS.heroEyebrow,
            INITIAL_SETTINGS.heroHeadlinePrimary,
            INITIAL_SETTINGS.heroHeadlineHighlight,
            INITIAL_SETTINGS.heroDescription,
            INITIAL_SETTINGS.heroServiceNote,
            INITIAL_SETTINGS.heroPriceBadge1,
            INITIAL_SETTINGS.heroPriceBadge2,
            INITIAL_SETTINGS.heroPriceBadge3,
            INITIAL_SETTINGS.heroPrimaryCtaText,
            INITIAL_SETTINGS.heroSecondaryCtaText,
            INITIAL_SETTINGS.heroWatermarkText,
            INITIAL_SETTINGS.heroLogoUrl,
            INITIAL_SETTINGS.heroMascotTitle,
            INITIAL_SETTINGS.heroMascotSubtitle,
            INITIAL_SETTINGS.facebookUrl,
            INITIAL_SETTINGS.qrFacebookTitle,
            INITIAL_SETTINGS.qrFacebookSubtitle,
            INITIAL_SETTINGS.xanhSmUrl,
            INITIAL_SETTINGS.qrXanhSmTitle,
            INITIAL_SETTINGS.qrXanhSmSubtitle,
          ]
        );
      }
    }

    // Seed companies nếu trống và đúng cấu trúc cột
    const compCols = await getExistingColumns(conn, "companies");
    if (compCols.has("building_name") && compCols.has("address")) {
      const [compCountRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM \`companies\``);
      if (Number(compCountRows[0]?.cnt || 0) === 0) {
        for (const [id, name, building, addr, isPartner] of DEFAULT_COMPANIES) {
          await conn.query(
            `INSERT INTO \`companies\` (\`id\`, \`name\`, \`building_name\`, \`address\`, \`is_partner\`) VALUES (?, ?, ?, ?, ?)`,
            [id, name, building, addr, isPartner]
          );
        }
      }
    }

    // Seed promotions nếu trống
    const [promoCountRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM \`promotions\``);
    if (Number(promoCountRows[0]?.cnt || 0) === 0) {
      for (const [code, name, type, val, minAmt, isAct, maxDisc] of DEFAULT_PROMOTIONS) {
        await conn.query(
          `INSERT IGNORE INTO \`promotions\` (\`code\`, \`name\`, \`discount_type\`, \`discount_value\`, \`min_order_amount\`, \`is_active\`, \`max_discount_amount\`)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [code, name, type, val, minAmt, isAct, maxDisc]
        );
      }
    }
  } finally {
    conn.release();
  }
}

/**
 * Đảm bảo toàn bộ bảng MySQL đã được tạo và seed dữ liệu nền tảng 1 lần duy nhất mỗi tiến trình.
 */
export async function ensureMySqlInitialized(): Promise<Pool> {
  if (!initPromise) {
    initPromise = runMySqlAutoMigration().catch((err) => {
      initPromise = null;
      console.error("[MySQL Auto-Migration Error]", err);
      throw err;
    });
  }
  await initPromise;
  return getMySqlPool();
}

/**
 * Kiểm tra trạng thái kết nối tới MySQL
 */
export async function checkMySqlConnection(): Promise<DatabaseStatus> {
  const cfg = getDbConfig();
  const baseStatus: DatabaseStatus = {
    connected: false,
    type: "MEMORY_CACHE",
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    database: cfg.database,
    message: "Chưa kết nối được tới máy chủ MySQL.",
  };

  try {
    const currentPool = await ensureMySqlInitialized();
    const getCount = async (tbl: string) => {
      try {
        const [rows] = await currentPool.query<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM \`${tbl}\``);
        return Number(rows[0]?.cnt || 0);
      } catch {
        return 0;
      }
    };

    const [
      usersCount,
      productsCount,
      variantsCount,
      ordersCount,
      orderItemsCount,
      categoriesCount,
      optionsCount,
      settingsCount,
      groupSessionsCount,
      permissionsCount,
      rolePermissionsCount,
      promotionsCount,
    ] = await Promise.all([
      getCount("users"),
      getCount("products"),
      getCount("product_variants"),
      getCount("orders"),
      getCount("order_items"),
      getCount("categories"),
      getCount("product_options"),
      getCount("business_settings"),
      getCount("group_sessions"),
      getCount("permissions"),
      getCount("role_permissions"),
      getCount("promotions"),
    ]);

    return {
      connected: true,
      type: "MYSQL",
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      database: cfg.database,
      message: `Đã kết nối thành công tới MySQL [${cfg.database}@${cfg.host}:${cfg.port}]`,
      tables: {
        usersCount,
        productsCount,
        variantsCount,
        ordersCount,
        orderItemsCount,
        categoriesCount,
        optionsCount,
        settingsCount,
        groupSessionsCount,
        permissionsCount,
        rolePermissionsCount,
        promotionsCount,
      },
    };
  } catch (err: any) {
    baseStatus.message = `Không thể kết nối MySQL (${err?.code || err?.message || "UNKNOWN"}). Vui lòng kiểm tra biến môi trường MYSQL_*.`;
    return baseStatus;
  }
}

export async function getDatabaseStatus(): Promise<MySqlAdminStatus> {
  const cfg = getDbConfig();
  const status = await checkMySqlConnection();
  let sizeBytes = 0;

  if (status.connected) {
    try {
      const currentPool = getMySqlPool();
      const [rows] = await currentPool.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(data_length + index_length), 0) AS size_bytes
         FROM information_schema.tables
         WHERE table_schema = DATABASE()`
      );
      sizeBytes = Number(rows[0]?.size_bytes || 0);
    } catch {}
  }

  const sizeKb = sizeBytes / 1024;
  const sizeFormatted = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb.toFixed(1)} KB`;

  return {
    connected: status.connected,
    engine: "MYSQL",
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    filePath: `mysql://${cfg.host}:${cfg.port}/${cfg.database}`,
    fileName: cfg.database,
    fileSizeBytes: sizeBytes,
    fileSizeFormatted: sizeFormatted,
    journalMode: "InnoDB (ACID Transaction)",
    foreignKeys: true,
    tables: {
      usersCount: status.tables?.usersCount ?? 0,
      productsCount: status.tables?.productsCount ?? 0,
      variantsCount: status.tables?.variantsCount ?? 0,
      ordersCount: status.tables?.ordersCount ?? 0,
      orderItemsCount: status.tables?.orderItemsCount ?? 0,
      categoriesCount: status.tables?.categoriesCount ?? 0,
      optionsCount: status.tables?.optionsCount ?? 0,
      settingsCount: status.tables?.settingsCount ?? 0,
      groupSessionsCount: status.tables?.groupSessionsCount ?? 0,
      permissionsCount: status.tables?.permissionsCount ?? 0,
      rolePermissionsCount: status.tables?.rolePermissionsCount ?? 0,
      promotionsCount: status.tables?.promotionsCount ?? 0,
    },
    optimizedFor: "MySQL / MariaDB (Hostinger Web Hosting)",
    sqlFileLastModified: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    sqlFilePath: "database/phpmyadmin_caxoi_cafe.sql",
  };
}

/**
 * Chỉ nạp lại 5 món & 3 quy cách chuẩn Quán Cà Xòi (categories, products, product_variants) trong transaction.
 * Tuyệt đối KHÔNG xóa orders, users, promotions, business_settings hay group_sessions.
 */
export async function resetMenuTablesOnlyInMySql(): Promise<boolean> {
  const currentPool = await ensureMySqlInitialized();
  const conn = await currentPool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    await conn.query("DELETE FROM product_variants");
    await conn.query("DELETE FROM products");
    await conn.query("DELETE FROM categories");

    for (const c of INITIAL_CATEGORIES) {
      await conn.query(
        `INSERT INTO categories (id, name, slug, description, image_url, display_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.slug, c.description || "", c.imageUrl || "", c.displayOrder, c.isActive ? 1 : 0]
      );
    }

    for (const p of INITIAL_PRODUCTS) {
      await conn.query(
        `INSERT INTO products (id, category_id, name, slug, description, image_url, base_price, sale_price, is_available, is_featured, prep_time_minutes, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id,
          p.categoryId,
          p.name,
          p.slug,
          p.description || "",
          p.imageUrl || "",
          p.basePrice,
          p.salePrice ?? null,
          p.isAvailable ? 1 : 0,
          p.isFeatured ? 1 : 0,
          p.prepTimeMinutes || 4,
          Array.isArray(p.tags) ? p.tags.join(",") : "",
        ]
      );
      for (const v of p.variants) {
        await conn.query(
          `INSERT INTO product_variants (product_id, size_name, extra_price, is_default)
           VALUES (?, ?, ?, ?)`,
          [p.id, v.sizeName, v.extraPrice, v.isDefault ? 1 : 0]
        );
      }
    }

    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    await conn.commit();
    return true;
  } catch (error) {
    try {
      await conn.rollback();
      await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    } catch {}
    console.error("[MySQL] Lỗi khôi phục bảng thực đơn:", error);
    return false;
  } finally {
    conn.release();
  }
}

// ============================================================================
// 1. DANH MỤC (CATEGORIES)
// ============================================================================
export async function getCategoriesFromMySql(): Promise<Category[]> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>(
      "SELECT * FROM categories WHERE is_active = 1 ORDER BY display_order ASC"
    );
    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      slug: String(r.slug),
      description: r.description || "",
      imageUrl: r.image_url || "",
      displayOrder: Number(r.display_order),
      isActive: Boolean(r.is_active),
    }));
  } catch (error) {
    console.error("[MySQL] Lỗi getCategoriesFromMySql:", error);
    return INITIAL_CATEGORIES.map((c) => ({ ...c }));
  }
}

// ============================================================================
// 2. SẢN PHẨM & QUY CÁCH (PRODUCTS & VARIANTS)
// ============================================================================
export async function getProductsFromMySql(): Promise<Product[]> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>("SELECT * FROM products ORDER BY id ASC");
    const [variantsRows] = await currentPool.query<RowDataPacket[]>(
      "SELECT * FROM product_variants ORDER BY id ASC"
    );

    return rows.map((r) => {
      const pVariants = variantsRows
        .filter((v) => v.product_id === r.id)
        .map((v) => ({
          id: Number(v.id),
          productId: String(v.product_id),
          sizeName: String(v.size_name),
          extraPrice: Number(v.extra_price),
          isDefault: Boolean(v.is_default),
        }));

      const tags = parseProductTags(r.tags);

      return {
        id: String(r.id),
        categoryId: Number(r.category_id),
        name: String(r.name),
        slug: String(r.slug),
        description: r.description || "",
        imageUrl: r.image_url || "",
        basePrice: Number(r.base_price),
        salePrice: r.sale_price != null ? Number(r.sale_price) : null,
        isAvailable: Boolean(r.is_available),
        isFeatured: Boolean(r.is_featured),
        prepTimeMinutes: Number(r.prep_time_minutes) || 4,
        tags,
        variants:
          pVariants.length > 0
            ? pVariants
            : [
                { id: 1, productId: String(r.id), sizeName: "Ly", extraPrice: 0, isDefault: true },
                { id: 2, productId: String(r.id), sizeName: "100ml", extraPrice: 12000, isDefault: false },
                { id: 3, productId: String(r.id), sizeName: "250ml", extraPrice: 37000, isDefault: false },
              ],
      };
    });
  } catch (error) {
    console.error("[MySQL] Lỗi getProductsFromMySql:", error);
    return INITIAL_PRODUCTS.map((p) => ({
      ...p,
      tags: [...p.tags],
      variants: p.variants.map((v) => ({ ...v })),
    }));
  }
}

export async function createProductInMySql(product: Product): Promise<boolean> {
  const currentPool = await ensureMySqlInitialized();
  const conn = await currentPool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO products (id, category_id, name, slug, description, image_url, base_price, sale_price, is_available, is_featured, prep_time_minutes, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product.id,
        product.categoryId || 1,
        product.name,
        product.slug,
        product.description || "",
        product.imageUrl || "",
        product.basePrice,
        product.salePrice ?? null,
        product.isAvailable ? 1 : 0,
        product.isFeatured ? 1 : 0,
        product.prepTimeMinutes || 4,
        Array.isArray(product.tags) ? product.tags.join(",") : String(product.tags || "NEW"),
      ]
    );

    if (product.variants && product.variants.length > 0) {
      for (const v of product.variants) {
        await conn.query(
          `INSERT INTO product_variants (product_id, size_name, extra_price, is_default)
           VALUES (?, ?, ?, ?)`,
          [product.id, v.sizeName, v.extraPrice, v.isDefault ? 1 : 0]
        );
      }
    }

    await conn.commit();
    return true;
  } catch (error) {
    try {
      await conn.rollback();
    } catch {}
    console.error("[MySQL] Lỗi createProductInMySql:", error);
    return false;
  } finally {
    conn.release();
  }
}

export async function updateProductInMySql(product: Product): Promise<boolean> {
  const currentPool = await ensureMySqlInitialized();
  const conn = await currentPool.getConnection();
  try {
    await conn.beginTransaction();
    const serializedTags = Array.isArray(product.tags) ? product.tags.join(",") : "";

    await conn.query(
      `UPDATE products
       SET name = ?, description = ?, base_price = ?, sale_price = ?, is_available = ?, is_featured = ?, image_url = ?, category_id = ?, prep_time_minutes = ?, tags = ?
       WHERE id = ?`,
      [
        product.name,
        product.description || "",
        product.basePrice,
        product.salePrice ?? null,
        product.isAvailable ? 1 : 0,
        product.isFeatured ? 1 : 0,
        product.imageUrl || "",
        product.categoryId || 1,
        product.prepTimeMinutes || 4,
        serializedTags,
        product.id,
      ]
    );

    if (product.variants && product.variants.length > 0) {
      const [existingRows] = await conn.query<RowDataPacket[]>(
        "SELECT id, size_name FROM product_variants WHERE product_id = ?",
        [product.id]
      );
      const existingById = new Map<number, RowDataPacket>(existingRows.map((r) => [Number(r.id), r]));
      const keptIds = new Set<number>();

      for (const v of product.variants) {
        const cleanSize = v.sizeName.trim();
        const extra = Number(v.extraPrice) || 0;
        const isDef = v.isDefault ? 1 : 0;

        if (v.id && existingById.has(v.id) && !keptIds.has(v.id)) {
          await conn.query(
            `UPDATE product_variants SET size_name = ?, extra_price = ?, is_default = ? WHERE id = ? AND product_id = ?`,
            [cleanSize, extra, isDef, v.id, product.id]
          );
          keptIds.add(v.id);
        } else {
          const matchedByName = existingRows.find(
            (r) =>
              !keptIds.has(Number(r.id)) &&
              String(r.size_name).trim().toLowerCase() === cleanSize.toLowerCase()
          );
          if (matchedByName) {
            await conn.query(
              `UPDATE product_variants SET size_name = ?, extra_price = ?, is_default = ? WHERE id = ? AND product_id = ?`,
              [cleanSize, extra, isDef, Number(matchedByName.id), product.id]
            );
            keptIds.add(Number(matchedByName.id));
          } else {
            const [res] = await conn.query<ResultSetHeader>(
              `INSERT INTO product_variants (product_id, size_name, extra_price, is_default) VALUES (?, ?, ?, ?)`,
              [product.id, cleanSize, extra, isDef]
            );
            keptIds.add(Number(res.insertId));
          }
        }
      }

      for (const row of existingRows) {
        const rowId = Number(row.id);
        if (!keptIds.has(rowId)) {
          await conn.query("DELETE FROM product_variants WHERE id = ? AND product_id = ?", [rowId, product.id]);
        }
      }
    }

    await conn.commit();
    return true;
  } catch (error) {
    try {
      await conn.rollback();
    } catch {}
    console.error("[MySQL] Lỗi updateProductInMySql:", error);
    return false;
  } finally {
    conn.release();
  }
}

export async function deleteProductFromMySql(id: string): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    await currentPool.query("DELETE FROM products WHERE id = ?", [id]);
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi deleteProductFromMySql:", error);
    return false;
  }
}

export async function toggleProductAvailabilityInMySql(
  productId: string,
  isAvailable: boolean
): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    await currentPool.query("UPDATE products SET is_available = ? WHERE id = ?", [
      isAvailable ? 1 : 0,
      productId,
    ]);
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi toggleProductAvailabilityInMySql:", error);
    return false;
  }
}

// ============================================================================
// 3. TÙY CHỌN MÓN (PRODUCT OPTIONS)
// ============================================================================
export async function getProductOptionsFromMySql(): Promise<ProductOption[]> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [optionRows] = await currentPool.query<RowDataPacket[]>(
      "SELECT * FROM product_options ORDER BY display_order ASC"
    );
    const [valueRows] = await currentPool.query<RowDataPacket[]>(
      "SELECT * FROM product_option_values ORDER BY display_order ASC"
    );

    return optionRows.map((opt) => ({
      id: Number(opt.id),
      name: String(opt.name),
      isRequired: Boolean(opt.is_required),
      isMultiple: Boolean(opt.is_multiple),
      displayOrder: Number(opt.display_order),
      values: valueRows
        .filter((val) => Number(val.option_id) === Number(opt.id))
        .map((val) => ({
          id: Number(val.id),
          optionId: Number(val.option_id),
          name: String(val.name),
          extraPrice: Number(val.extra_price),
          isDefault: Boolean(val.is_default),
          displayOrder: Number(val.display_order),
        })),
    }));
  } catch (error) {
    console.error("[MySQL] Lỗi getProductOptionsFromMySql:", error);
    return INITIAL_OPTIONS.map((o) => ({
      ...o,
      values: o.values.map((v) => ({ ...v })),
    }));
  }
}

export async function createOptionValueInMySql(data: {
  optionId: number;
  name: string;
  extraPrice: number;
  isDefault?: boolean;
}): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [maxRows] = await currentPool.query<RowDataPacket[]>(
      "SELECT MAX(display_order) as maxOrder FROM product_option_values WHERE option_id = ?",
      [data.optionId]
    );
    const nextOrder = Number(maxRows[0]?.maxOrder ?? 0) + 1;

    if (data.isDefault) {
      const [optRows] = await currentPool.query<RowDataPacket[]>(
        "SELECT is_multiple FROM product_options WHERE id = ?",
        [data.optionId]
      );
      if (optRows[0] && !optRows[0].is_multiple) {
        await currentPool.query("UPDATE product_option_values SET is_default = 0 WHERE option_id = ?", [
          data.optionId,
        ]);
      }
    }

    await currentPool.query(
      `INSERT INTO product_option_values (option_id, name, extra_price, is_default, display_order)
       VALUES (?, ?, ?, ?, ?)`,
      [data.optionId, data.name.trim(), Number(data.extraPrice) || 0, data.isDefault ? 1 : 0, nextOrder]
    );
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi createOptionValueInMySql:", error);
    return false;
  }
}

export async function updateOptionValueInMySql(
  id: number,
  updates: {
    name?: string;
    extraPrice?: number;
    isDefault?: boolean;
    displayOrder?: number;
  }
): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>(
      "SELECT * FROM product_option_values WHERE id = ?",
      [id]
    );
    const current = rows[0];
    if (!current) return false;

    const newName = updates.name !== undefined ? updates.name.trim() : current.name;
    const newExtraPrice = updates.extraPrice !== undefined ? Number(updates.extraPrice) : current.extra_price;
    const newIsDefault = updates.isDefault !== undefined ? (updates.isDefault ? 1 : 0) : current.is_default;
    const newDisplayOrder = updates.displayOrder !== undefined ? updates.displayOrder : current.display_order;

    if (updates.isDefault) {
      const [optRows] = await currentPool.query<RowDataPacket[]>(
        "SELECT is_multiple FROM product_options WHERE id = ?",
        [current.option_id]
      );
      if (optRows[0] && !optRows[0].is_multiple) {
        await currentPool.query("UPDATE product_option_values SET is_default = 0 WHERE option_id = ?", [
          current.option_id,
        ]);
      }
    }

    await currentPool.query(
      `UPDATE product_option_values
       SET name = ?, extra_price = ?, is_default = ?, display_order = ?
       WHERE id = ?`,
      [newName, newExtraPrice, newIsDefault, newDisplayOrder, id]
    );
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi updateOptionValueInMySql:", error);
    return false;
  }
}

export async function deleteOptionValueInMySql(id: number): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    await currentPool.query("DELETE FROM product_option_values WHERE id = ?", [id]);
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi deleteOptionValueInMySql:", error);
    return false;
  }
}

// ============================================================================
// 4. CẤU HÌNH VẬN HÀNH & VIETQR (BUSINESS SETTINGS)
// ============================================================================
export async function getBusinessSettingsFromMySql(): Promise<BusinessSettings> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>("SELECT * FROM business_settings WHERE id = 1 LIMIT 1");
    const row = rows[0];
    if (!row) {
      return { ...INITIAL_SETTINGS };
    }

    const shippingFeeMode: ShippingFeeMode =
      row.shipping_fee_mode === "MANUAL_ZERO" ? "MANUAL_ZERO" : "AUTO";

    const result: BusinessSettings = {
      ...INITIAL_SETTINGS,
      storeName: row.store_name || INITIAL_SETTINGS.storeName,
      storeStatus: (row.store_status as any) || INITIAL_SETTINGS.storeStatus,
      storeStatusMessage:
        row.store_status_message || row.rush_mode_message || INITIAL_SETTINGS.storeStatusMessage,
      hotline: row.hotline || row.phone || INITIAL_SETTINGS.hotline,
      openTime: row.open_time || INITIAL_SETTINGS.openTime,
      closeTime: row.close_time || INITIAL_SETTINGS.closeTime,
      shippingFeeMode,
      baseDeliveryFee: Number(row.base_delivery_fee ?? INITIAL_SETTINGS.baseDeliveryFee),
      freeDeliveryMinCups: Number(row.free_delivery_min_cups ?? INITIAL_SETTINGS.freeDeliveryMinCups),
      maxSlotCapacityCups: Number(row.max_slot_capacity_cups ?? INITIAL_SETTINGS.maxSlotCapacityCups),
      prepLeadTimeMinutes: Number(row.prep_lead_time_minutes ?? INITIAL_SETTINGS.prepLeadTimeMinutes),
      vietqrBankId: row.vietqr_bank_id || row.bank_bin || INITIAL_SETTINGS.vietqrBankId,
      vietqrAccountNo: row.vietqr_account_no || row.bank_account_no || INITIAL_SETTINGS.vietqrAccountNo,
      vietqrAccountName: row.vietqr_account_name || row.bank_account_name || INITIAL_SETTINGS.vietqrAccountName,
    };

    for (const def of HERO_SETTINGS_COLUMNS) {
      const rawVal = row[def.col];
      const fallback = INITIAL_SETTINGS[def.key] as string;
      if (def.required) {
        (result as any)[def.key] = rawVal && String(rawVal).trim() ? String(rawVal) : fallback;
      } else {
        (result as any)[def.key] = rawVal === null || rawVal === undefined ? fallback : String(rawVal);
      }
    }

    return result;
  } catch (error) {
    console.error("[MySQL] Lỗi getBusinessSettingsFromMySql:", error);
    return { ...INITIAL_SETTINGS };
  }
}

export async function updateBusinessSettingsInMySql(
  updates: Partial<BusinessSettings>
): Promise<BusinessSettings> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const current = await getBusinessSettingsFromMySql();
    const merged: BusinessSettings = { ...current, ...updates };
    const safeMode: ShippingFeeMode =
      merged.shippingFeeMode === "MANUAL_ZERO" ? "MANUAL_ZERO" : "AUTO";
    merged.shippingFeeMode = safeMode;

    const assignments = [
      "store_name = ?",
      "store_status = ?",
      "store_status_message = ?",
      "hotline = ?",
      "phone = ?",
      "open_time = ?",
      "close_time = ?",
      "shipping_fee_mode = ?",
      "base_delivery_fee = ?",
      "free_delivery_min_cups = ?",
      "max_slot_capacity_cups = ?",
      "prep_lead_time_minutes = ?",
      "vietqr_bank_id = ?",
      "vietqr_account_no = ?",
      "vietqr_account_name = ?",
      ...HERO_SETTINGS_COLUMNS.map((d) => `${d.col} = ?`),
    ];

    const values: any[] = [
      merged.storeName,
      merged.storeStatus,
      merged.storeStatusMessage,
      merged.hotline,
      merged.hotline,
      merged.openTime,
      merged.closeTime,
      safeMode,
      merged.baseDeliveryFee,
      merged.freeDeliveryMinCups,
      merged.maxSlotCapacityCups,
      merged.prepLeadTimeMinutes,
      merged.vietqrBankId,
      merged.vietqrAccountNo,
      merged.vietqrAccountName,
      ...HERO_SETTINGS_COLUMNS.map((d) => {
        const val = merged[d.key];
        return val === null || val === undefined ? INITIAL_SETTINGS[d.key] : String(val);
      }),
    ];

    await currentPool.query(`UPDATE business_settings SET ${assignments.join(", ")} WHERE id = 1`, values);
    return merged;
  } catch (error) {
    console.error("[MySQL] Lỗi updateBusinessSettingsInMySql:", error);
    return getBusinessSettingsFromMySql();
  }
}

// ============================================================================
// 5. ĐƠN HÀNG (ORDERS, ORDER ITEMS & WEBHOOK TRANSACTIONS)
// ============================================================================
export async function hasWebhookTransactionInMySql(txId: string): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>(
      "SELECT tx_id FROM webhook_transactions WHERE tx_id = ? LIMIT 1",
      [txId]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function recordWebhookTransactionInMySql(
  txId: string,
  orderId: string,
  orderCode: string,
  amount: number,
  gateway?: string
): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    await currentPool.query(
      `INSERT IGNORE INTO webhook_transactions (tx_id, order_id, order_code, amount, gateway, processed_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [txId, orderId, orderCode, amount, gateway || "VIETQR"]
    );
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi recordWebhookTransactionInMySql:", error);
    return false;
  }
}

function mapOrderRow(o: RowDataPacket, itemRows: RowDataPacket[]): Order {
  const items: OrderItemRecord[] = itemRows.map((i) => {
    let opts = [];
    try {
      opts = JSON.parse(i.selected_options_json || i.options_json || "[]");
    } catch {}
    return {
      id: String(i.id),
      orderId: String(i.order_id),
      productId: String(i.product_id),
      productName: String(i.product_name),
      variantName: String(i.variant_name),
      quantity: Number(i.quantity),
      unitPrice: Number(i.unit_price),
      totalPrice: Number(i.total_price),
      recipientLabel: i.recipient_label || undefined,
      itemNotes: i.item_notes || undefined,
      options: opts,
    };
  });

  return {
    id: String(o.id),
    orderCode: String(o.order_code),
    orderType: o.order_type,
    status: o.status,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method,
    recipientName: String(o.recipient_name),
    recipientPhone: String(o.recipient_phone),
    companyName: o.company_name || undefined,
    buildingName: o.building_name || undefined,
    floorRoom: o.floor_room || undefined,
    deliveryAddress: o.delivery_address || undefined,
    deliveryNotes: o.delivery_notes || undefined,
    scheduledType: o.scheduled_type || "ASAP",
    scheduledTime: o.scheduled_time || undefined,
    subtotalAmount: Number(o.subtotal_amount),
    discountAmount: Number(o.discount_amount || 0),
    deliveryFee: Number(o.delivery_fee || 0),
    totalAmount: Number(o.total_amount),
    promotionCode: o.promotion_code || undefined,
    groupSessionId: o.group_session_id || undefined,
    baristaNotes: o.barista_notes || undefined,
    shipperName: o.shipper_name || undefined,
    shipperPhone: o.shipper_phone || undefined,
    estimatedDeliveryTime: o.estimated_delivery_time || undefined,
    trackingNotes: o.tracking_notes || undefined,
    trackingToken: o.tracking_token || undefined,
    createdAt: normalizeTimestamp(o.created_at),
    updatedAt: normalizeTimestamp(o.updated_at),
    items,
  };
}

export async function getOrdersFromMySql(filter?: {
  status?: string;
  orderType?: string;
  phone?: string;
  exactPhone?: string;
  exactOrderCode?: string;
  search?: string;
  date?: string; // 'TODAY' | 'YESTERDAY' | '7DAYS' | 'ALL'
  limit?: number;
}): Promise<Order[]> {
  try {
    const currentPool = await ensureMySqlInitialized();

    let query = "SELECT * FROM orders";
    const params: any[] = [];
    const conditions: string[] = [];

    if (filter?.status && filter.status !== "ALL") {
      conditions.push("status = ?");
      params.push(filter.status);
    }

    if (filter?.orderType && filter.orderType !== "ALL") {
      conditions.push("order_type = ?");
      params.push(filter.orderType);
    }

    if (filter?.exactPhone) {
      const normalized = filter.exactPhone.replace(/[^\d+]/g, "");
      conditions.push("REPLACE(REPLACE(REPLACE(recipient_phone, ' ', ''), '.', ''), '-', '') = ?");
      params.push(normalized);
    } else if (filter?.phone) {
      conditions.push("recipient_phone LIKE ?");
      params.push(`%${filter.phone}%`);
    }

    if (filter?.exactOrderCode) {
      conditions.push("(LOWER(order_code) = LOWER(?) OR id = ?)");
      params.push(filter.exactOrderCode.trim(), filter.exactOrderCode.trim());
    }

    if (filter?.search && filter.search.trim()) {
      const s = `%${filter.search.trim()}%`;
      conditions.push(
        "(order_code LIKE ? OR recipient_name LIKE ? OR recipient_phone LIKE ? OR building_name LIKE ? OR company_name LIKE ?)"
      );
      params.push(s, s, s, s, s);
    }

    if (filter?.date && filter.date !== "ALL") {
      if (filter.date === "TODAY") {
        conditions.push("DATE(created_at) = CURDATE()");
      } else if (filter.date === "YESTERDAY") {
        conditions.push("DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)");
      } else if (filter.date === "7DAYS") {
        conditions.push("DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
      }
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY created_at DESC";

    if (filter?.limit && filter.limit > 0) {
      query += " LIMIT ?";
      params.push(Math.min(500, Math.floor(filter.limit)));
    }

    const [orderRows] = await currentPool.query<RowDataPacket[]>(query, params);
    if (orderRows.length === 0) return [];

    const orderIds = orderRows.map((o) => String(o.id));
    const placeholders = orderIds.map(() => "?").join(", ");
    const [itemRows] = await currentPool.query<RowDataPacket[]>(
      `SELECT * FROM order_items WHERE order_id IN (${placeholders})`,
      orderIds
    );

    const itemsByOrder = new Map<string, RowDataPacket[]>();
    for (const item of itemRows) {
      const oid = String(item.order_id);
      const bucket = itemsByOrder.get(oid) || [];
      bucket.push(item);
      itemsByOrder.set(oid, bucket);
    }

    return orderRows.map((o) => mapOrderRow(o, itemsByOrder.get(String(o.id)) || []));
  } catch (error) {
    console.error("[MySQL] Lỗi getOrdersFromMySql:", error);
    return [];
  }
}

export async function getOrderByIdFromMySql(idOrCode: string): Promise<Order | null> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>(
      "SELECT * FROM orders WHERE id = ? OR LOWER(order_code) = LOWER(?) LIMIT 1",
      [idOrCode, idOrCode]
    );
    const row = rows[0];
    if (!row) return null;

    const [itemsRows] = await currentPool.query<RowDataPacket[]>(
      "SELECT * FROM order_items WHERE order_id = ?",
      [row.id]
    );

    return mapOrderRow(row, itemsRows);
  } catch (error) {
    console.error("[MySQL] Lỗi getOrderByIdFromMySql:", error);
    return null;
  }
}

async function allocateNextOrderCodeTx(conn: PoolConnection): Promise<string> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT order_code FROM orders WHERE order_code LIKE 'CF2611-%' FOR UPDATE"
  );
  let maxSeq = 0;
  for (const r of rows) {
    const match = String(r.order_code || "").match(/^CF2611-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxSeq) maxSeq = num;
    }
  }
  return `CF2611-${String(maxSeq + 1).padStart(3, "0")}`;
}

export async function saveOrderToMySql(order: Order): Promise<boolean> {
  const currentPool = await ensureMySqlInitialized();
  const conn = await currentPool.getConnection();
  try {
    await conn.beginTransaction();

    let finalCode = order.orderCode;
    if (!finalCode) {
      finalCode = await allocateNextOrderCodeTx(conn);
      order.orderCode = finalCode;
    } else {
      const [dup] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM orders WHERE LOWER(order_code) = LOWER(?) LIMIT 1",
        [finalCode]
      );
      if (dup.length > 0) {
        finalCode = await allocateNextOrderCodeTx(conn);
        order.orderCode = finalCode;
      }
    }

    if (!order.trackingToken) {
      order.trackingToken = crypto.randomBytes(16).toString("hex");
    }

    await conn.query(
      `INSERT INTO orders
       (id, order_code, order_type, recipient_name, recipient_phone, company_name, building_name, floor_room,
        delivery_address, delivery_notes, scheduled_type, scheduled_time, subtotal_amount, discount_amount,
        delivery_fee, total_amount, payment_method, payment_status, status, promotion_code, group_session_id,
        barista_notes, tracking_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        finalCode,
        order.orderType,
        order.recipientName,
        order.recipientPhone,
        order.companyName || "",
        order.buildingName || "",
        order.floorRoom || "",
        order.deliveryAddress || "",
        order.deliveryNotes || "",
        order.scheduledType || "ASAP",
        order.scheduledTime || null,
        order.subtotalAmount,
        order.discountAmount || 0,
        order.deliveryFee || 0,
        order.totalAmount,
        order.paymentMethod,
        order.paymentStatus,
        order.status,
        order.promotionCode || null,
        order.groupSessionId || null,
        order.baristaNotes || "",
        order.trackingToken,
        toMysqlDatetime(order.createdAt),
        toMysqlDatetime(order.updatedAt),
      ]
    );

    if (order.items && order.items.length > 0) {
      for (const item of order.items) {
        await conn.query(
          `INSERT INTO order_items
           (id, order_id, product_id, product_name, variant_name, quantity, unit_price, total_price, recipient_label, item_notes, selected_options_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            order.id,
            item.productId,
            item.productName,
            item.variantName,
            item.quantity,
            item.unitPrice,
            item.totalPrice,
            item.recipientLabel || "",
            item.itemNotes || "",
            JSON.stringify(item.options || []),
          ]
        );
      }
    }

    if (order.promotionCode && (order.discountAmount || 0) > 0) {
      await conn.query(
        "UPDATE promotions SET used_count = COALESCE(used_count, 0) + 1 WHERE UPPER(code) = UPPER(?)",
        [order.promotionCode]
      );
    }

    if (order.groupSessionId) {
      await conn.query(
        "UPDATE group_sessions SET status = 'ORDERED' WHERE id = ? OR UPPER(session_code) = UPPER(?)",
        [order.groupSessionId, order.groupSessionId]
      );
    }

    await conn.commit();
    return true;
  } catch (error) {
    try {
      await conn.rollback();
    } catch {}
    console.error("[MySQL] Lỗi saveOrderToMySql:", error);
    return false;
  } finally {
    conn.release();
  }
}

export async function updateOrderStatusInMySql(
  orderId: string,
  status: string,
  options?:
    | string
    | {
        baristaNotes?: string;
        paymentStatus?: string;
        shipperName?: string;
        shipperPhone?: string;
        estimatedDeliveryTime?: string;
        trackingNotes?: string;
        deliveryNotes?: string;
        deliveryFee?: number;
      }
): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();

    if (typeof options === "string") {
      await currentPool.query(
        `UPDATE orders
         SET status = ?, barista_notes = ?, updated_at = NOW()
         WHERE id = ? OR LOWER(order_code) = LOWER(?)`,
        [status, options, orderId, orderId]
      );
    } else if (options && typeof options === "object") {
      const updates: string[] = ["status = ?"];
      const params: any[] = [status];

      if (options.baristaNotes !== undefined) {
        updates.push("barista_notes = ?");
        params.push(options.baristaNotes);
      }
      if (options.paymentStatus !== undefined) {
        updates.push("payment_status = ?");
        params.push(options.paymentStatus);
      }
      if (options.shipperName !== undefined) {
        updates.push("shipper_name = ?");
        params.push(options.shipperName);
      }
      if (options.shipperPhone !== undefined) {
        updates.push("shipper_phone = ?");
        params.push(options.shipperPhone);
      }
      if (options.estimatedDeliveryTime !== undefined) {
        updates.push("estimated_delivery_time = ?");
        params.push(options.estimatedDeliveryTime);
      }
      if (options.trackingNotes !== undefined) {
        updates.push("tracking_notes = ?");
        params.push(options.trackingNotes);
      }
      if (options.deliveryNotes !== undefined) {
        updates.push("delivery_notes = ?");
        params.push(options.deliveryNotes);
      }
      if (options.deliveryFee !== undefined) {
        const fee = Math.max(0, Number(options.deliveryFee) || 0);
        updates.push("delivery_fee = ?");
        params.push(fee);
        updates.push("total_amount = GREATEST(0, subtotal_amount + ? - discount_amount)");
        params.push(fee);
      }

      updates.push("updated_at = NOW()");
      params.push(orderId, orderId);

      await currentPool.query(
        `UPDATE orders SET ${updates.join(", ")} WHERE id = ? OR LOWER(order_code) = LOWER(?)`,
        params
      );
    } else {
      await currentPool.query(
        `UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ? OR LOWER(order_code) = LOWER(?)`,
        [status, orderId, orderId]
      );
    }

    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi updateOrderStatusInMySql:", error);
    return false;
  }
}

export async function cancelOrderInMySql(orderId: string, reason?: string): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    await currentPool.query(
      `UPDATE orders
       SET status = 'CANCELLED',
           tracking_notes = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE tracking_notes END,
           updated_at = NOW()
       WHERE id = ? OR LOWER(order_code) = LOWER(?)`,
      [reason || null, reason || null, reason || null, orderId, orderId]
    );
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi cancelOrderInMySql:", error);
    return false;
  }
}

export async function updatePaymentStatusInMySql(
  orderCodeOrId: string,
  paymentStatus: string,
  status?: string
): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    if (status) {
      await currentPool.query(
        `UPDATE orders SET payment_status = ?, status = ?, updated_at = NOW()
         WHERE id = ? OR LOWER(order_code) = LOWER(?)`,
        [paymentStatus, status, orderCodeOrId, orderCodeOrId]
      );
    } else {
      await currentPool.query(
        `UPDATE orders SET payment_status = ?, updated_at = NOW()
         WHERE id = ? OR LOWER(order_code) = LOWER(?)`,
        [paymentStatus, orderCodeOrId, orderCodeOrId]
      );
    }
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi updatePaymentStatusInMySql:", error);
    return false;
  }
}

// ============================================================================
// 6. THỐNG KÊ DOANH THU & GIỜ CAO ĐIỂM
// ============================================================================
export async function getStatsFromMySql(timeRange: string = "TODAY") {
  try {
    const currentPool = await ensureMySqlInitialized();

    let orderDateClause = "";
    let cupsDateClause = "";
    if (timeRange === "TODAY") {
      orderDateClause = "AND DATE(created_at) = CURDATE()";
      cupsDateClause = "AND DATE(o.created_at) = CURDATE()";
    } else if (timeRange === "YESTERDAY") {
      orderDateClause = "AND DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)";
      cupsDateClause = "AND DATE(o.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)";
    } else if (timeRange === "LAST_7_DAYS") {
      orderDateClause = "AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)";
      cupsDateClause = "AND DATE(o.created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)";
    } else if (timeRange === "THIS_MONTH") {
      orderDateClause = "AND DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')";
      cupsDateClause = "AND DATE_FORMAT(o.created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')";
    }

    const [revRows] = await currentPool.query<RowDataPacket[]>(`
      SELECT
        COALESCE(SUM(total_amount), 0) as totalRevenue,
        COUNT(*) as totalOrders
      FROM orders
      WHERE status != 'CANCELLED' ${orderDateClause}
    `);
    const revRow = revRows[0];

    const [cupsRows] = await currentPool.query<RowDataPacket[]>(`
      SELECT COALESCE(SUM(oi.quantity), 0) as totalCupsSold
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status != 'CANCELLED' ${cupsDateClause}
    `);
    const cupsRow = cupsRows[0];

    const [statusRows] = await currentPool.query<RowDataPacket[]>(`
      SELECT status, COUNT(*) as cnt
      FROM orders
      WHERE 1=1 ${orderDateClause}
      GROUP BY status
    `);

    let newOrdersCount = 0;
    let brewingCount = 0;
    let readyCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;

    for (const s of statusRows) {
      const cnt = Number(s.cnt || 0);
      if (s.status === "PENDING_PAYMENT" || s.status === "CONFIRMED") {
        newOrdersCount += cnt;
      } else if (s.status === "BREWING") {
        brewingCount += cnt;
      } else if (s.status === "READY" || s.status === "DELIVERING") {
        readyCount += cnt;
      } else if (s.status === "COMPLETED") {
        completedCount += cnt;
      } else if (s.status === "CANCELLED") {
        cancelledCount += cnt;
      }
    }

    const [paymentRows] = await currentPool.query<RowDataPacket[]>(`
      SELECT
        COALESCE(payment_method, 'COD') as method,
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as revenue
      FROM orders
      WHERE status != 'CANCELLED' ${orderDateClause}
      GROUP BY COALESCE(payment_method, 'COD')
    `);

    let vietqrRevenue = 0;
    let vietqrOrdersCount = 0;
    let codRevenue = 0;
    let codOrdersCount = 0;

    for (const p of paymentRows) {
      const m = String(p.method || "").toUpperCase();
      if (m.includes("VIETQR") || m.includes("BANKING")) {
        vietqrRevenue += Number(p.revenue || 0);
        vietqrOrdersCount += Number(p.count || 0);
      } else {
        codRevenue += Number(p.revenue || 0);
        codOrdersCount += Number(p.count || 0);
      }
    }

    const totalRevenue = Number(revRow?.totalRevenue || 0);
    const totalOrders = Number(revRow?.totalOrders || 0);
    const totalCupsSold = Number(cupsRow?.totalCupsSold || 0);
    const averageOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
    const completionRate =
      totalOrders + cancelledCount > 0
        ? Math.round((completedCount / (totalOrders + cancelledCount)) * 100)
        : 100;

    const [topProductsRows] = await currentPool.query<RowDataPacket[]>(`
      SELECT
        oi.product_id as productId,
        COALESCE(p.name, MAX(oi.product_name)) as name,
        COALESCE(p.image_url, '') as imageUrl,
        COALESCE(p.base_price, MAX(oi.unit_price)) as basePrice,
        SUM(oi.quantity) as count,
        SUM(oi.total_price) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE o.status != 'CANCELLED' ${cupsDateClause}
      GROUP BY oi.product_id, p.name, p.image_url, p.base_price
      ORDER BY count DESC, revenue DESC
      LIMIT 5
    `);

    const topProducts = topProductsRows.map((item, idx) => ({
      productId: item.productId,
      name: item.name,
      imageUrl: item.imageUrl,
      basePrice: Number(item.basePrice || 0),
      count: Number(item.count || 0),
      revenue: Number(item.revenue || 0),
      rank: idx + 1,
      percentage: totalRevenue > 0 ? Math.round((Number(item.revenue || 0) / totalRevenue) * 100) : 0,
    }));

    const hoursList = [
      "07:00", "08:00", "09:00", "10:00", "11:00", "12:00",
      "13:00", "14:00", "15:00", "16:00", "17:00", "18:00",
      "19:00", "20:00", "21:00", "22:00",
    ];

    const hourlyMap: Record<string, { count: number; revenue: number }> = {};
    for (const h of hoursList) {
      hourlyMap[h] = { count: 0, revenue: 0 };
    }

    const [hourlyRows] = await currentPool.query<RowDataPacket[]>(`
      SELECT
        DATE_FORMAT(created_at, '%H:00') as hour,
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as revenue
      FROM orders
      WHERE created_at IS NOT NULL AND status != 'CANCELLED' ${orderDateClause}
      GROUP BY DATE_FORMAT(created_at, '%H:00')
      ORDER BY hour ASC
    `);

    let maxHourlyCount = 0;
    let peakHour = "";

    for (const h of hourlyRows) {
      const hourStr = String(h.hour || "");
      const cnt = Number(h.count || 0);
      if (hourStr && hourlyMap[hourStr]) {
        hourlyMap[hourStr].count = cnt;
        hourlyMap[hourStr].revenue = Number(h.revenue || 0);
        if (cnt > maxHourlyCount) {
          maxHourlyCount = cnt;
          peakHour = hourStr;
        }
      }
    }

    const hourlyDistribution = hoursList.map((h) => ({
      hour: h,
      count: hourlyMap[h].count,
      revenue: hourlyMap[h].revenue,
      isPeak: maxHourlyCount > 0 && hourlyMap[h].count === maxHourlyCount,
    }));

    const hourlyOrders: Record<string, number> = {};
    for (const h of hoursList) {
      hourlyOrders[h] = hourlyMap[h].count;
    }

    const peakHourLabel = peakHour
      ? `Khung giờ cao điểm: ${peakHour} (${maxHourlyCount} đơn • ${new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(hourlyMap[peakHour]?.revenue || 0)})`
      : "Chưa có khung giờ cao điểm";

    const storeSettings = await getBusinessSettingsFromMySql();

    return {
      timeRange,
      totalRevenue,
      totalOrders,
      totalCupsSold,
      averageOrderValue,
      completionRate,
      newOrdersCount,
      brewingCount,
      readyCount,
      completedCount,
      cancelledCount,
      vietqrRevenue,
      vietqrOrdersCount,
      codRevenue,
      codOrdersCount,
      topProducts,
      hourlyDistribution,
      hourlyOrders,
      peakHourLabel,
      maxHourlyCount,
      storeSettings,
    };
  } catch (error) {
    console.error("[MySQL] Lỗi getStatsFromMySql:", error);
    return {
      timeRange,
      totalRevenue: 0,
      totalOrders: 0,
      totalCupsSold: 0,
      averageOrderValue: 0,
      completionRate: 100,
      newOrdersCount: 0,
      brewingCount: 0,
      readyCount: 0,
      completedCount: 0,
      cancelledCount: 0,
      vietqrRevenue: 0,
      vietqrOrdersCount: 0,
      codRevenue: 0,
      codOrdersCount: 0,
      topProducts: [],
      hourlyDistribution: [],
      hourlyOrders: {},
      peakHourLabel: "Chưa có khung giờ cao điểm",
      maxHourlyCount: 0,
      storeSettings: await getBusinessSettingsFromMySql(),
    };
  }
}

// ============================================================================
// 7. PHÒNG ĐẶT NHÓM CÔNG SỞ (GROUP SESSIONS)
// ============================================================================
export async function getGroupSessionFromMySql(code: string): Promise<GroupSession | null> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>(
      "SELECT * FROM group_sessions WHERE UPPER(session_code) = UPPER(?) LIMIT 1",
      [code]
    );
    const row = rows[0];
    if (!row) return null;

    let currentStatus = row.status;
    if (
      currentStatus === "OPEN" &&
      row.expires_at &&
      !Number.isNaN(new Date(row.expires_at).getTime()) &&
      new Date(row.expires_at).getTime() <= Date.now()
    ) {
      currentStatus = "EXPIRED";
      try {
        await currentPool.query("UPDATE group_sessions SET status = 'EXPIRED' WHERE id = ?", [row.id]);
      } catch {}
    }

    const [itemRows] = await currentPool.query<RowDataPacket[]>(
      "SELECT * FROM group_session_items WHERE UPPER(session_code) = UPPER(?) ORDER BY created_at ASC",
      [code]
    );

    const items: CartItem[] = itemRows.map((i) => {
      if (i.item_payload_json) {
        try {
          return JSON.parse(i.item_payload_json);
        } catch {}
      }
      return {
        cartItemId: String(i.cart_item_id || i.id),
        product: {
          id: String(i.product_id),
          name: String(i.product_name),
          basePrice: Number(i.unit_price),
        } as any,
        variant: {
          sizeName: String(i.variant_name),
        } as any,
        selectedOptions: [],
        quantity: Number(i.quantity),
        recipientLabel: i.recipient_label || undefined,
        notes: i.notes || undefined,
        unitPrice: Number(i.unit_price),
        totalPrice: Number(i.total_price),
      };
    });

    return {
      id: String(row.id),
      sessionCode: String(row.session_code),
      hostName: String(row.host_name),
      hostPhone: String(row.host_phone),
      hostToken: row.host_token || undefined,
      buildingName: row.building_name || undefined,
      status: currentStatus as any,
      expiresAt: String(row.expires_at),
      createdAt: normalizeTimestamp(row.created_at),
      items,
    };
  } catch (error) {
    console.error("[MySQL] Lỗi getGroupSessionFromMySql:", error);
    return null;
  }
}

export async function createGroupSessionInMySql(session: GroupSession): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    await currentPool.query(
      `INSERT INTO group_sessions (id, session_code, host_name, host_phone, host_token, building_name, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.sessionCode.toUpperCase(),
        session.hostName,
        session.hostPhone,
        session.hostToken || crypto.randomBytes(16).toString("hex"),
        session.buildingName || "",
        session.status || "OPEN",
        session.expiresAt,
        toMysqlDatetime(session.createdAt),
      ]
    );
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi createGroupSessionInMySql:", error);
    return false;
  }
}

export async function addGroupItemToMySql(sessionCode: string, item: CartItem): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const itemId = `item-g-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const fullPayloadJson = JSON.stringify({
      ...item,
      cartItemId: itemId,
    });

    await currentPool.query(
      `INSERT INTO group_session_items
       (id, session_code, cart_item_id, product_id, product_name, variant_name, quantity, unit_price, total_price, recipient_label, notes, item_payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        sessionCode.toUpperCase(),
        itemId,
        item.product.id,
        item.product.name,
        item.variant.sizeName,
        item.quantity || 1,
        item.unitPrice,
        item.totalPrice,
        item.recipientLabel || "",
        item.notes || "",
        fullPayloadJson,
      ]
    );
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi addGroupItemToMySql:", error);
    return false;
  }
}

export async function lockGroupSessionInMySql(sessionCode: string): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    await currentPool.query(
      "UPDATE group_sessions SET status = 'LOCKED' WHERE UPPER(session_code) = UPPER(?) AND status = 'OPEN'",
      [sessionCode]
    );
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi lockGroupSessionInMySql:", error);
    return false;
  }
}

export async function removeGroupItemFromMySql(
  sessionCode: string,
  cartItemId: string
): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>(
      "SELECT status FROM group_sessions WHERE UPPER(session_code) = UPPER(?) LIMIT 1",
      [sessionCode]
    );
    if (!rows[0] || rows[0].status !== "OPEN") {
      return false;
    }
    await currentPool.query(
      "DELETE FROM group_session_items WHERE UPPER(session_code) = UPPER(?) AND (cart_item_id = ? OR id = ?)",
      [sessionCode, cartItemId, cartItemId]
    );
    return true;
  } catch (error) {
    console.error("[MySQL] Lỗi removeGroupItemFromMySql:", error);
    return false;
  }
}

// ============================================================================
// 8. PHÂN QUYỀN, NHÂN VIÊN & XÁC THỰC (RBAC, USERS & AUTH)
// ============================================================================
export async function getAuthUserByIdFromMySql(userId: string): Promise<{
  id: string;
  username: string;
  fullName: string;
  role: "SUPER_ADMIN" | "STORE_MANAGER" | "BARISTA" | "CASHIER";
  isActive: boolean;
  tokenVersion: number;
  permissions: string[];
} | null> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.full_name, u.is_active, u.token_version, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?
       LIMIT 1`,
      [userId]
    );
    const row = rows[0];
    if (!row) return null;

    const [permRows] = await currentPool.query<RowDataPacket[]>(
      "SELECT permission_code FROM role_permissions WHERE role_name = ?",
      [row.role_name]
    );

    return {
      id: String(row.id),
      username: String(row.username),
      fullName: String(row.full_name),
      role: row.role_name,
      isActive: Boolean(row.is_active),
      tokenVersion: Number(row.token_version || 1),
      permissions: permRows.map((p) => String(p.permission_code)),
    };
  } catch {
    return null;
  }
}

export async function incrementUserTokenVersionInMySql(userId: string): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    await currentPool.query(
      "UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?",
      [userId]
    );
    return true;
  } catch {
    return false;
  }
}

export async function getRolesAndPermissionsFromMySql(): Promise<{
  definitions: PermissionDefinition[];
  roles: RolePermissionConfig[];
  staff: StaffAccount[];
}> {
  try {
    const currentPool = await ensureMySqlInitialized();

    const [permRows] = await currentPool.query<RowDataPacket[]>("SELECT * FROM permissions ORDER BY id ASC");
    const definitions: PermissionDefinition[] = permRows.map((p) => ({
      id: String(p.id),
      code: String(p.code),
      name: String(p.name),
      category: p.category,
      description: p.description || "",
    }));

    const [roleRows] = await currentPool.query<RowDataPacket[]>("SELECT * FROM roles ORDER BY id ASC");
    const [rolePermRows] = await currentPool.query<RowDataPacket[]>("SELECT * FROM role_permissions");

    const roles: RolePermissionConfig[] = roleRows.map((r) => {
      const assignedPerms = rolePermRows
        .filter((rp) => rp.role_name === r.name)
        .map((rp) => String(rp.permission_code));

      let displayName = String(r.name);
      if (r.name === "SUPER_ADMIN") displayName = "Chủ Quán (Super Admin)";
      else if (r.name === "STORE_MANAGER") displayName = "Cửa Hàng Trưởng (Store Manager)";
      else if (r.name === "BARISTA") displayName = "Pha Chế (Barista - KDS)";
      else if (r.name === "CASHIER") displayName = "Thu Ngân (Cashier)";

      return {
        roleId: String(r.name),
        roleName: r.name as any,
        displayName,
        description: r.description || "",
        permissions: assignedPerms,
      };
    });

    const [userRows] = await currentPool.query<RowDataPacket[]>(`
      SELECT u.id, u.username, u.full_name, u.phone, u.email, u.pin, u.is_active, u.created_at, r.name as role_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      ORDER BY u.created_at ASC
    `);

    const staff: StaffAccount[] = userRows.map((u) => ({
      id: String(u.id),
      username: String(u.username),
      fullName: String(u.full_name),
      role: u.role_name as any,
      phone: u.phone || undefined,
      email: u.email || undefined,
      hasPin: Boolean(u.pin && String(u.pin).trim()),
      isActive: Boolean(u.is_active),
      createdAt: normalizeTimestamp(u.created_at),
    }));

    return { definitions, roles, staff };
  } catch (error) {
    console.error("[MySQL] Lỗi getRolesAndPermissionsFromMySql:", error);
    return { definitions: [], roles: [], staff: [] };
  }
}

export async function toggleRolePermissionInMySql(
  roleName: string,
  permissionCode: string
): Promise<{
  success: boolean;
  message: string;
  hasPerm?: boolean;
}> {
  try {
    const currentPool = await ensureMySqlInitialized();
    if (roleName === "SUPER_ADMIN") {
      return { success: false, message: "Không thể thu hồi quyền của Chủ Quán (Super Admin)." };
    }

    const [existing] = await currentPool.query<RowDataPacket[]>(
      "SELECT id FROM role_permissions WHERE role_name = ? AND permission_code = ?",
      [roleName, permissionCode]
    );

    if (existing.length > 0) {
      await currentPool.query(
        "DELETE FROM role_permissions WHERE role_name = ? AND permission_code = ?",
        [roleName, permissionCode]
      );
      return {
        success: true,
        message: `Đã thu hồi quyền [${permissionCode}] từ vai trò ${roleName}`,
        hasPerm: false,
      };
    } else {
      await currentPool.query(
        "INSERT INTO role_permissions (role_name, permission_code) VALUES (?, ?)",
        [roleName, permissionCode]
      );
      return {
        success: true,
        message: `Đã cấp quyền [${permissionCode}] cho vai trò ${roleName}`,
        hasPerm: true,
      };
    }
  } catch (error: any) {
    return { success: false, message: "Lỗi phân quyền: " + error.message };
  }
}

export async function updateStaffInMySql(
  staffId: string,
  updates: {
    fullName?: string;
    role?: string;
    pin?: string;
    isActive?: boolean;
    phone?: string;
    email?: string;
    password?: string;
  },
  actorUserId?: string
): Promise<{ success: boolean; message?: string }> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [targetRows] = await currentPool.query<RowDataPacket[]>(
      `SELECT u.id, u.is_active, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?
       LIMIT 1`,
      [staffId]
    );
    const target = targetRows[0];

    if (!target) {
      return { success: false, message: "Không tìm thấy tài khoản nhân viên." };
    }

    if (actorUserId && staffId === actorUserId && updates.isActive === false) {
      return { success: false, message: "Không thể tự khóa tài khoản đang đăng nhập." };
    }

    const effectiveRole = updates.role || target.role_name;

    if (
      target.role_name === "SUPER_ADMIN" &&
      (updates.isActive === false || (updates.role && updates.role !== "SUPER_ADMIN"))
    ) {
      const [saRows] = await currentPool.query<RowDataPacket[]>(`
        SELECT COUNT(*) as count
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE r.name = 'SUPER_ADMIN' AND u.is_active = 1
      `);
      if (Number(saRows[0]?.count || 0) <= 1) {
        return {
          success: false,
          message: "Không thể khóa hoặc hạ quyền Chủ Quán (SUPER_ADMIN) duy nhất đang hoạt động.",
        };
      }
    }

    let roleId: number | null = null;
    if (updates.role) {
      const [rRows] = await currentPool.query<RowDataPacket[]>(
        "SELECT id FROM roles WHERE name = ?",
        [updates.role]
      );
      if (!rRows[0]) return { success: false, message: "Vai trò không hợp lệ." };
      roleId = Number(rRows[0].id);
    }

    const fields: string[] = [];
    const values: any[] = [];
    let shouldBumpTokenVersion = false;

    if (updates.fullName !== undefined) {
      fields.push("full_name = ?");
      values.push(updates.fullName.trim());
    }
    if (roleId !== null) {
      fields.push("role_id = ?");
      values.push(roleId);
      shouldBumpTokenVersion = true;
    }
    if (effectiveRole === "SUPER_ADMIN" || effectiveRole === "STORE_MANAGER") {
      fields.push("pin = NULL");
    } else if (updates.pin !== undefined) {
      const cleanPin = updates.pin.trim();
      if (cleanPin && !/^\d{4,6}$/.test(cleanPin)) {
        return { success: false, message: "Mã PIN KDS phải gồm 4 đến 6 chữ số." };
      }
      fields.push("pin = ?");
      values.push(cleanPin ? hashPassword(cleanPin) : null);
    }
    if (updates.isActive !== undefined) {
      fields.push("is_active = ?");
      values.push(updates.isActive ? 1 : 0);
      shouldBumpTokenVersion = true;
    }
    if (updates.phone !== undefined) {
      fields.push("phone = ?");
      values.push(updates.phone.trim() || null);
    }
    if (updates.email !== undefined) {
      fields.push("email = ?");
      values.push(updates.email.trim() || null);
    }
    if (updates.password !== undefined && updates.password.trim()) {
      if (updates.password.trim().length < 8) {
        return { success: false, message: "Mật khẩu mới phải có ít nhất 8 ký tự." };
      }
      fields.push("password_hash = ?");
      values.push(hashPassword(updates.password.trim()));
      fields.push("plain_password = NULL");
      shouldBumpTokenVersion = true;
    }
    if (shouldBumpTokenVersion) {
      fields.push("token_version = COALESCE(token_version, 1) + 1");
    }

    if (fields.length === 0) return { success: true };

    values.push(staffId);
    await currentPool.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
    return { success: true };
  } catch (error: any) {
    console.error("[MySQL] Lỗi updateStaffInMySql:", error);
    return {
      success: false,
      message: `Lỗi cập nhật nhân viên trong MySQL (${error?.code || "MYSQL_ERR"}: ${error?.sqlMessage || error?.message || "unknown"}).`,
    };
  }
}

export async function deleteStaffInMySql(
  staffId: string,
  actorUserId?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const currentPool = await ensureMySqlInitialized();
    if (actorUserId && staffId === actorUserId) {
      return { success: false, message: "Không thể tự xóa tài khoản đang đăng nhập." };
    }

    const [rows] = await currentPool.query<RowDataPacket[]>(
      `SELECT u.*, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`,
      [staffId]
    );
    const targetUser = rows[0];

    if (!targetUser) {
      return { success: false, message: "Không tìm thấy tài khoản nhân viên." };
    }

    if (targetUser.role_name === "SUPER_ADMIN") {
      const [saRows] = await currentPool.query<RowDataPacket[]>(`
        SELECT COUNT(*) as count
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE r.name = 'SUPER_ADMIN'
      `);
      if (Number(saRows[0]?.count || 0) <= 1) {
        return { success: false, message: "Không thể xóa tài khoản Chủ Quán duy nhất trong hệ thống!" };
      }
    }

    await currentPool.query("DELETE FROM users WHERE id = ?", [staffId]);
    return { success: true, message: `Đã xóa tài khoản "${targetUser.full_name}" thành công!` };
  } catch (error) {
    console.error("[MySQL] Lỗi deleteStaffInMySql:", error);
    return { success: false, message: "Lỗi xóa tài khoản nhân viên." };
  }
}

export async function createStaffInMySql(staff: {
  username: string;
  fullName: string;
  role: string;
  phone?: string;
  email?: string;
  pin?: string;
  password?: string;
}): Promise<{ success: boolean; message?: string }> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rRows] = await currentPool.query<RowDataPacket[]>(
      "SELECT id FROM roles WHERE name = ?",
      [staff.role]
    );
    if (!rRows[0]) {
      return { success: false, message: "Vai trò không hợp lệ." };
    }

    const rawPwd = staff.password?.trim() || "";
    if (rawPwd.length < 8) {
      return { success: false, message: "Vui lòng nhập mật khẩu tối thiểu 8 ký tự cho nhân viên mới." };
    }

    const allowPin = staff.role === "BARISTA" || staff.role === "CASHIER";
    const cleanPin = allowPin && staff.pin?.trim() ? staff.pin.trim() : null;
    if (cleanPin && !/^\d{4,6}$/.test(cleanPin)) {
      return { success: false, message: "Mã PIN KDS phải gồm 4 đến 6 chữ số." };
    }

    const id = `staff-${crypto.randomUUID()}`;
    const pwdHash = hashPassword(rawPwd);
    const pinHash = cleanPin ? hashPassword(cleanPin) : null;

    await currentPool.query(
      `INSERT INTO users (id, username, password_hash, plain_password, pin, full_name, phone, email, role_id, is_active, token_version, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 1, 1, NOW())`,
      [
        id,
        staff.username.trim().toLowerCase(),
        pwdHash,
        pinHash,
        staff.fullName.trim(),
        staff.phone?.trim() || null,
        staff.email?.trim() || null,
        Number(rRows[0].id),
      ]
    );

    return { success: true };
  } catch (error: any) {
    console.error("[MySQL] Lỗi createStaffInMySql:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return { success: false, message: "Tên đăng nhập đã tồn tại trong hệ thống." };
    }
    return {
      success: false,
      message: `Lỗi tạo tài khoản nhân viên trong MySQL (${error?.code || "MYSQL_ERR"}: ${error?.sqlMessage || error?.message || "unknown"}).`,
    };
  }
}

export async function getNotificationStaffEmails(): Promise<
  { email: string; fullName: string; role: string }[]
> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>(`
      SELECT u.email, u.full_name, r.name as role_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.is_active = 1
        AND u.email IS NOT NULL
        AND TRIM(u.email) != ''
        AND r.name IN ('SUPER_ADMIN', 'BARISTA', 'STORE_MANAGER')
    `);

    return rows.map((r) => ({
      email: String(r.email).trim(),
      fullName: String(r.full_name),
      role: String(r.role_name),
    }));
  } catch (error) {
    console.error("[MySQL] Lỗi getNotificationStaffEmails:", error);
    return [];
  }
}

export async function findUserInMySql(
  usernameOrPin: string,
  isPin = false
): Promise<{
  id: string;
  username: string;
  fullName: string;
  role: "SUPER_ADMIN" | "STORE_MANAGER" | "BARISTA" | "CASHIER";
  passwordHash: string;
  tokenVersion: number;
} | null> {
  try {
    const currentPool = await ensureMySqlInitialized();

    if (isPin) {
      const [rows] = await currentPool.query<RowDataPacket[]>(`
        SELECT u.id, u.username, u.full_name, u.password_hash, u.pin, u.token_version, r.name as role_name
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE u.is_active = 1
          AND u.pin IS NOT NULL
          AND TRIM(u.pin) != ''
          AND r.name IN ('BARISTA', 'CASHIER')
      `);

      const inputPin = usernameOrPin.trim();
      const matched = rows.find((row) => verifyPassword(inputPin, String(row.pin || "").trim()));
      if (!matched) return null;

      return {
        id: String(matched.id),
        username: String(matched.username),
        fullName: String(matched.full_name),
        role: matched.role_name,
        passwordHash: String(matched.password_hash),
        tokenVersion: Number(matched.token_version || 1),
      };
    }

    const [rows] = await currentPool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.full_name, u.password_hash, u.token_version, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE LOWER(u.username) = LOWER(?) AND u.is_active = 1
       LIMIT 1`,
      [usernameOrPin.trim()]
    );

    const row = rows[0];
    if (row) {
      return {
        id: String(row.id),
        username: String(row.username),
        fullName: String(row.full_name),
        role: row.role_name,
        passwordHash: String(row.password_hash),
        tokenVersion: Number(row.token_version || 1),
      };
    }
    return null;
  } catch (error) {
    console.error("[MySQL] Lỗi findUserInMySql:", error);
    return null;
  }
}

export async function getStaffByUsernameFromMySql(username: string): Promise<{
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
} | null> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_active, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE LOWER(u.username) = LOWER(?)
       LIMIT 1`,
      [username.trim()]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      username: String(row.username),
      fullName: String(row.full_name),
      email: row.email || null,
      phone: row.phone || null,
      role: String(row.role_name),
      isActive: Boolean(row.is_active),
    };
  } catch (err: any) {
    console.error("[MySQL] Lỗi getStaffByUsernameFromMySql:", err?.message);
    return null;
  }
}

export async function savePasswordResetOtpInMySql(
  userId: string,
  otp: string,
  ttlMs = 10 * 60 * 1000
): Promise<boolean> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const otpHash = hashPassword(otp);
    const expiresAt = Date.now() + ttlMs;
    await currentPool.query(
      `INSERT INTO password_resets (user_id, otp_hash, attempts, expires_at, created_at)
       VALUES (?, ?, 0, ?, NOW())
       ON DUPLICATE KEY UPDATE
         otp_hash = VALUES(otp_hash),
         attempts = 0,
         expires_at = VALUES(expires_at),
         created_at = NOW()`,
      [userId, otpHash, expiresAt]
    );
    return true;
  } catch (err: any) {
    console.error("[MySQL] Lỗi savePasswordResetOtpInMySql:", err?.message);
    return false;
  }
}

export async function verifyAndResetPasswordWithOtpInMySql(
  userId: string,
  otp: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const currentPool = await ensureMySqlInitialized();
  const conn = await currentPool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT user_id, otp_hash, attempts, expires_at FROM password_resets WHERE user_id = ? LIMIT 1",
      [userId]
    );
    const record = rows[0];

    if (!record) {
      return { success: false, message: "Chưa có yêu cầu đặt lại mật khẩu hoặc mã OTP đã hết hạn." };
    }
    if (Date.now() > Number(record.expires_at)) {
      await conn.query("DELETE FROM password_resets WHERE user_id = ?", [userId]);
      return { success: false, message: "Mã OTP đã hết hạn (quá 10 phút). Vui lòng yêu cầu mã mới." };
    }
    if (Number(record.attempts) >= 5) {
      await conn.query("DELETE FROM password_resets WHERE user_id = ?", [userId]);
      return { success: false, message: "Bạn đã nhập sai OTP quá 5 lần. Vui lòng yêu cầu mã mới." };
    }

    if (!verifyPassword(otp.trim(), String(record.otp_hash))) {
      await conn.query("UPDATE password_resets SET attempts = attempts + 1 WHERE user_id = ?", [userId]);
      return { success: false, message: "Mã OTP không chính xác. Vui lòng kiểm tra lại." };
    }

    const cleanPwd = newPassword.trim();
    if (cleanPwd.length < 8) {
      return { success: false, message: "Mật khẩu mới phải có tối thiểu 8 ký tự." };
    }

    const newHash = hashPassword(cleanPwd);
    await conn.beginTransaction();
    await conn.query(
      "UPDATE users SET password_hash = ?, plain_password = NULL, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?",
      [newHash, userId]
    );
    await conn.query("DELETE FROM password_resets WHERE user_id = ?", [userId]);
    await conn.commit();

    return { success: true, message: "Đặt lại mật khẩu thành công! Vui lòng đăng nhập bằng mật khẩu mới." };
  } catch (err: any) {
    try {
      await conn.rollback();
    } catch {}
    console.error("[MySQL] Lỗi verifyAndResetPasswordWithOtpInMySql:", err?.message);
    return { success: false, message: "Lỗi hệ thống khi đặt lại mật khẩu." };
  } finally {
    conn.release();
  }
}

// ============================================================================
// 10. QUẢN LÝ MÃ GIẢM GIÁ & VOUCHER (PROMOTIONS)
// ============================================================================
function mapPromotionRow(r: RowDataPacket): Promotion {
  return {
    id: Number(r.id),
    code: String(r.code),
    name: String(r.name),
    discountType: (r.discount_type || "PERCENTAGE") as DiscountType,
    discountValue: Number(r.discount_value),
    minOrderAmount: Number(r.min_order_amount || 0),
    isActive: Boolean(r.is_active),
    maxDiscountAmount: r.max_discount_amount != null ? Number(r.max_discount_amount) : null,
    usageLimit: r.usage_limit != null ? Number(r.usage_limit) : null,
    usedCount: Number(r.used_count || 0),
    startTime: r.start_time || null,
    endTime: r.end_time || null,
  };
}

export async function getPromotionsFromMySql(): Promise<Promotion[]> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>("SELECT * FROM promotions ORDER BY id ASC");
    return rows.map(mapPromotionRow);
  } catch (error) {
    console.error("[MySQL] Lỗi getPromotionsFromMySql:", error);
    return [];
  }
}

export async function getPromotionByCodeFromMySql(code: string): Promise<Promotion | null> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const cleanCode = (code || "").trim().toUpperCase();
    if (!cleanCode) return null;
    const [rows] = await currentPool.query<RowDataPacket[]>(
      "SELECT * FROM promotions WHERE UPPER(code) = ? LIMIT 1",
      [cleanCode]
    );
    if (!rows[0]) return null;
    return mapPromotionRow(rows[0]);
  } catch (error) {
    console.error("[MySQL] Lỗi getPromotionByCodeFromMySql:", error);
    return null;
  }
}

export async function createPromotionInMySql(data: {
  code: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  minOrderAmount: number;
  isActive?: boolean;
  maxDiscountAmount?: number | null;
  usageLimit?: number | null;
  startTime?: string | null;
  endTime?: string | null;
}): Promise<{ success: boolean; promotion?: Promotion; message?: string }> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const cleanCode = (data.code || "").trim().toUpperCase();
    if (!cleanCode) {
      return { success: false, message: "Mã khuyến mãi không được để trống" };
    }
    if (!data.name || !data.name.trim()) {
      return { success: false, message: "Tên chương trình không được để trống" };
    }
    if (!Number.isFinite(data.discountValue) || data.discountValue <= 0) {
      return { success: false, message: "Giá trị giảm giá phải lớn hơn 0" };
    }
    if (data.discountType === "PERCENTAGE" && data.discountValue > 100) {
      return { success: false, message: "Phần trăm giảm giá không được vượt quá 100%" };
    }
    if (data.minOrderAmount < 0) {
      return { success: false, message: "Giá trị đơn tối thiểu không được âm" };
    }

    const [existing] = await currentPool.query<RowDataPacket[]>(
      "SELECT id FROM promotions WHERE UPPER(code) = ? LIMIT 1",
      [cleanCode]
    );
    if (existing.length > 0) {
      return { success: false, message: `Mã khuyến mãi "${cleanCode}" đã tồn tại trên hệ thống` };
    }

    const isActiveVal = data.isActive !== false ? 1 : 0;
    const maxDiscount =
      data.maxDiscountAmount != null && data.maxDiscountAmount > 0 ? Number(data.maxDiscountAmount) : null;
    const usageLimit =
      data.usageLimit != null && data.usageLimit > 0 ? Math.floor(Number(data.usageLimit)) : null;

    const [result] = await currentPool.query<ResultSetHeader>(
      `INSERT INTO promotions (code, name, discount_type, discount_value, min_order_amount, is_active, max_discount_amount, usage_limit, used_count, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        cleanCode,
        data.name.trim(),
        data.discountType,
        data.discountValue,
        data.minOrderAmount || 0,
        isActiveVal,
        maxDiscount,
        usageLimit,
        data.startTime || null,
        data.endTime || null,
      ]
    );

    const newPromotion: Promotion = {
      id: Number(result.insertId),
      code: cleanCode,
      name: data.name.trim(),
      discountType: data.discountType,
      discountValue: data.discountValue,
      minOrderAmount: data.minOrderAmount || 0,
      isActive: isActiveVal === 1,
      maxDiscountAmount: maxDiscount,
      usageLimit,
      usedCount: 0,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
    };

    return { success: true, promotion: newPromotion, message: "Tạo mã khuyến mãi thành công" };
  } catch (error: any) {
    console.error("[MySQL] Lỗi createPromotionInMySql:", error);
    return {
      success: false,
      message: `Lỗi tạo khuyến mãi trong MySQL (${error?.code || "MYSQL_ERR"}: ${error?.sqlMessage || error?.message || "unknown"})`,
    };
  }
}

export async function updatePromotionInMySql(
  id: number,
  data: Partial<{
    code: string;
    name: string;
    discountType: DiscountType;
    discountValue: number;
    minOrderAmount: number;
    isActive: boolean;
    maxDiscountAmount: number | null;
    usageLimit: number | null;
    startTime: string | null;
    endTime: string | null;
  }>
): Promise<{ success: boolean; promotion?: Promotion; message?: string }> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>("SELECT * FROM promotions WHERE id = ?", [id]);
    const existing = rows[0];
    if (!existing) {
      return { success: false, message: "Không tìm thấy mã khuyến mãi cần sửa" };
    }

    let code = String(existing.code);
    if (data.code !== undefined) {
      code = data.code.trim().toUpperCase();
      if (!code) return { success: false, message: "Mã khuyến mãi không được để trống" };
      const [dup] = await currentPool.query<RowDataPacket[]>(
        "SELECT id FROM promotions WHERE UPPER(code) = ? AND id != ?",
        [code, id]
      );
      if (dup.length > 0) {
        return { success: false, message: `Mã khuyến mãi "${code}" đã được sử dụng bởi khuyến mãi khác` };
      }
    }

    const name = data.name !== undefined ? data.name.trim() : String(existing.name);
    const discountType = (
      data.discountType !== undefined ? data.discountType : existing.discount_type
    ) as DiscountType;
    const discountValue =
      data.discountValue !== undefined ? Number(data.discountValue) : Number(existing.discount_value);
    const minOrderAmount =
      data.minOrderAmount !== undefined ? Number(data.minOrderAmount) : Number(existing.min_order_amount);
    const isActiveVal = data.isActive !== undefined ? (data.isActive ? 1 : 0) : Number(existing.is_active);
    const maxDiscountAmount =
      data.maxDiscountAmount !== undefined
        ? data.maxDiscountAmount != null && data.maxDiscountAmount > 0
          ? Number(data.maxDiscountAmount)
          : null
        : existing.max_discount_amount != null
        ? Number(existing.max_discount_amount)
        : null;
    const usageLimit =
      data.usageLimit !== undefined
        ? data.usageLimit != null && data.usageLimit > 0
          ? Math.floor(Number(data.usageLimit))
          : null
        : existing.usage_limit != null
        ? Number(existing.usage_limit)
        : null;
    const startTime = data.startTime !== undefined ? data.startTime || null : existing.start_time || null;
    const endTime = data.endTime !== undefined ? data.endTime || null : existing.end_time || null;

    if (!name) {
      return { success: false, message: "Tên chương trình không được để trống" };
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      return { success: false, message: "Giá trị giảm giá phải lớn hơn 0" };
    }
    if (discountType === "PERCENTAGE" && discountValue > 100) {
      return { success: false, message: "Phần trăm giảm giá không được vượt quá 100%" };
    }
    if (!Number.isFinite(minOrderAmount) || minOrderAmount < 0) {
      return { success: false, message: "Giá trị đơn tối thiểu không hợp lệ" };
    }

    await currentPool.query(
      `UPDATE promotions
       SET code = ?, name = ?, discount_type = ?, discount_value = ?, min_order_amount = ?, is_active = ?, max_discount_amount = ?, usage_limit = ?, start_time = ?, end_time = ?
       WHERE id = ?`,
      [
        code,
        name,
        discountType,
        discountValue,
        minOrderAmount,
        isActiveVal,
        maxDiscountAmount,
        usageLimit,
        startTime,
        endTime,
        id,
      ]
    );

    const updated: Promotion = {
      id,
      code,
      name,
      discountType,
      discountValue,
      minOrderAmount,
      isActive: isActiveVal === 1,
      maxDiscountAmount,
      usageLimit,
      usedCount: Number(existing.used_count || 0),
      startTime,
      endTime,
    };

    return { success: true, promotion: updated, message: "Cập nhật mã khuyến mãi thành công" };
  } catch (error: any) {
    console.error("[MySQL] Lỗi updatePromotionInMySql:", error);
    return {
      success: false,
      message: `Lỗi cập nhật khuyến mãi trong MySQL (${error?.code || "MYSQL_ERR"}: ${error?.sqlMessage || error?.message || "unknown"})`,
    };
  }
}

export async function togglePromotionInMySql(
  id: number
): Promise<{ success: boolean; promotion?: Promotion; message?: string }> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [rows] = await currentPool.query<RowDataPacket[]>("SELECT * FROM promotions WHERE id = ?", [id]);
    const existing = rows[0];
    if (!existing) {
      return { success: false, message: "Không tìm thấy mã khuyến mãi" };
    }

    const newStatus = Number(existing.is_active) === 1 ? 0 : 1;
    await currentPool.query("UPDATE promotions SET is_active = ? WHERE id = ?", [newStatus, id]);

    return {
      success: true,
      message: `Đã ${newStatus === 1 ? "kích hoạt" : "tắt"} mã ${existing.code}`,
      promotion: mapPromotionRow({ ...existing, is_active: newStatus } as RowDataPacket),
    };
  } catch (error) {
    console.error("[MySQL] Lỗi togglePromotionInMySql:", error);
    return { success: false, message: "Lỗi chuyển đổi trạng thái" };
  }
}

export async function deletePromotionInMySql(
  id: number
): Promise<{ success: boolean; message?: string }> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const [result] = await currentPool.query<ResultSetHeader>("DELETE FROM promotions WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      return { success: true, message: "Đã xóa mã khuyến mãi thành công" };
    }
    return { success: false, message: "Không tìm thấy mã khuyến mãi để xóa" };
  } catch (error) {
    console.error("[MySQL] Lỗi deletePromotionInMySql:", error);
    return { success: false, message: "Lỗi xóa mã khuyến mãi" };
  }
}

export function calculatePromotionDiscount(
  promotion: Promotion,
  subtotalAmount: number,
  deliveryFee: number = 0
): { valid: boolean; discountAmount: number; message?: string } {
  if (!promotion.isActive) {
    return { valid: false, discountAmount: 0, message: `Mã "${promotion.code}" hiện đang tạm ngưng áp dụng.` };
  }

  const now = Date.now();
  if (
    promotion.startTime &&
    !Number.isNaN(new Date(promotion.startTime).getTime()) &&
    now < new Date(promotion.startTime).getTime()
  ) {
    return { valid: false, discountAmount: 0, message: `Mã "${promotion.code}" chưa đến thời gian áp dụng.` };
  }
  if (
    promotion.endTime &&
    !Number.isNaN(new Date(promotion.endTime).getTime()) &&
    now > new Date(promotion.endTime).getTime()
  ) {
    return { valid: false, discountAmount: 0, message: `Mã "${promotion.code}" đã hết hạn sử dụng.` };
  }
  if (
    promotion.usageLimit != null &&
    promotion.usageLimit > 0 &&
    (promotion.usedCount || 0) >= promotion.usageLimit
  ) {
    return { valid: false, discountAmount: 0, message: `Mã "${promotion.code}" đã hết lượt sử dụng.` };
  }

  if (subtotalAmount < promotion.minOrderAmount) {
    const diff = promotion.minOrderAmount - subtotalAmount;
    return {
      valid: false,
      discountAmount: 0,
      message: `Mã "${promotion.code}" áp dụng cho đơn từ ${new Intl.NumberFormat("vi-VN").format(promotion.minOrderAmount)}đ. Cần mua thêm ${new Intl.NumberFormat("vi-VN").format(diff)}đ nữa.`,
    };
  }

  let discount = 0;
  const isFreeship =
    promotion.discountType === "FREESHIP" || promotion.code.toUpperCase() === "FREESHIP";

  if (isFreeship) {
    if (deliveryFee <= 0) {
      return {
        valid: false,
        discountAmount: 0,
        message: `Đơn hàng hiện có phí giao hàng 0đ nên không áp dụng mã "${promotion.code}".`,
      };
    }
    discount = Math.min(deliveryFee, promotion.discountValue);
  } else if (promotion.discountType === "PERCENTAGE") {
    discount = Math.round(subtotalAmount * (promotion.discountValue / 100));
    if (promotion.maxDiscountAmount && promotion.maxDiscountAmount > 0) {
      discount = Math.min(discount, promotion.maxDiscountAmount);
    }
  } else {
    discount = promotion.discountValue;
  }

  discount = Math.max(0, Math.min(discount, subtotalAmount + deliveryFee));
  return { valid: true, discountAmount: discount };
}

// ============================================================================
// 11. PHÂN HỆ SAO LƯU (BACKUP) & NHẬP DỮ LIỆU (IMPORT / RESTORE)
// ============================================================================
const EXPORT_TABLES = [
  "categories",
  "products",
  "product_variants",
  "product_options",
  "product_option_values",
  "business_settings",
  "companies",
  "promotions",
  "roles",
  "permissions",
  "role_permissions",
  "users",
  "orders",
  "order_items",
  "group_sessions",
  "group_session_items",
] as const;

function sqlEscapeLiteral(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : "NULL";
  if (typeof val === "boolean") return val ? "1" : "0";
  return `'${String(val).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export async function exportLiveSqlDumpFromMySql(): Promise<string> {
  const currentPool = await ensureMySqlInitialized();
  const lines: string[] = [
    "-- ============================================================================",
    `-- CÀ XÒI COFFEE — LIVE MYSQL BACKUP DUMP (${new Date().toISOString()})`,
    "-- ============================================================================",
    "SET FOREIGN_KEY_CHECKS = 0;",
    "START TRANSACTION;",
    "",
  ];

  for (const tbl of EXPORT_TABLES) {
    try {
      const [cols] = await currentPool.query<RowDataPacket[]>(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [tbl]
      );
      if (cols.length === 0) continue;
      const colNames = cols
        .map((c) => String(c.COLUMN_NAME))
        .filter((name) => name !== "plain_password");
      const [rows] = await currentPool.query<RowDataPacket[]>(
        `SELECT ${colNames.map((c) => `\`${c}\``).join(", ")} FROM \`${tbl}\``
      );

      lines.push(`-- Table: ${tbl} (${rows.length} rows)`);
      lines.push(`DELETE FROM \`${tbl}\`;`);
      for (const row of rows) {
        const vals = colNames
          .map((c) => {
            if (tbl === "users" && c === "pin" && row[c] && !isScryptHash(String(row[c]))) {
              return "NULL";
            }
            return sqlEscapeLiteral(row[c]);
          })
          .join(", ");
        lines.push(
          `INSERT INTO \`${tbl}\` (${colNames.map((c) => `\`${c}\``).join(", ")}) VALUES (${vals});`
        );
      }
      lines.push("");
    } catch {}
  }

  lines.push("COMMIT;");
  lines.push("SET FOREIGN_KEY_CHECKS = 1;");
  return lines.join("\n");
}

function pruneOldBackupSnapshots() {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) return;
    const files = fs
      .readdirSync(BACKUPS_DIR)
      .filter((f) => f.endsWith(".json") || f.endsWith(".sql"))
      .map((f) => {
        const fullPath = path.join(BACKUPS_DIR, f);
        return { fullPath, mtime: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > MAX_BACKUP_FILES) {
      for (const old of files.slice(MAX_BACKUP_FILES)) {
        try {
          fs.unlinkSync(old.fullPath);
        } catch {}
      }
    }
  } catch {}
}

function resolveSafeBackupPath(filename: string, allowedExts: string[]): string | null {
  if (!filename || typeof filename !== "string") return null;
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeName || safeName !== path.basename(filename)) return null;
  const lower = safeName.toLowerCase();
  if (!allowedExts.some((ext) => lower.endsWith(ext))) return null;

  if (!fs.existsSync(BACKUPS_DIR)) return null;
  const candidate = path.join(BACKUPS_DIR, safeName);
  if (!fs.existsSync(candidate)) return null;

  const realDir = fs.realpathSync(BACKUPS_DIR);
  const realTarget = fs.realpathSync(candidate);
  if (!realTarget.startsWith(realDir + path.sep)) {
    return null;
  }
  return realTarget;
}

export async function exportFullDatabaseToJson(): Promise<any> {
  const currentPool = await ensureMySqlInitialized();
  const exportData: Record<string, any[]> = {};

  for (const tbl of EXPORT_TABLES) {
    try {
      const [rows] = await currentPool.query<RowDataPacket[]>(`SELECT * FROM \`${tbl}\``);
      if (tbl === "users") {
        exportData[tbl] = rows.map((u) => {
          const { plain_password: _unusedPlain, pin, ...rest } = u;
          const safePin = pin && isScryptHash(String(pin)) ? String(pin) : null;
          return { ...rest, plain_password: null, pin: safePin };
        });
      } else {
        exportData[tbl] = rows;
      }
    } catch {
      exportData[tbl] = [];
    }
  }

  return {
    version: "2.0",
    engine: "MYSQL",
    appName: "Cà Xòi Coffee",
    exportedAt: new Date().toISOString(),
    summary: {
      totalCategories: exportData.categories?.length || 0,
      totalProducts: exportData.products?.length || 0,
      totalVariants: exportData.product_variants?.length || 0,
      totalOptions: exportData.product_options?.length || 0,
      totalOptionValues: exportData.product_option_values?.length || 0,
      totalPromotions: exportData.promotions?.length || 0,
      totalOrders: exportData.orders?.length || 0,
      totalUsers: exportData.users?.length || 0,
    },
    tables: exportData,
  };
}

export async function importFullDatabaseFromJson(
  jsonData: any,
  mode: "FULL" | "MENU_ONLY" = "FULL"
): Promise<{ success: boolean; message: string; stats?: any }> {
  const currentPool = await ensureMySqlInitialized();
  const conn = await currentPool.getConnection();
  try {
    if (!jsonData || typeof jsonData !== "object") {
      return { success: false, message: "Dữ liệu JSON không hợp lệ" };
    }

    const tablesData = jsonData.tables || jsonData;
    if (!tablesData || typeof tablesData !== "object") {
      return { success: false, message: "Không tìm thấy cấu trúc bảng dữ liệu trong JSON" };
    }

    const menuTables = [
      "categories",
      "products",
      "product_variants",
      "product_options",
      "product_option_values",
    ];
    const targetTables = mode === "MENU_ONLY" ? menuTables : [...EXPORT_TABLES];

    const stats: Record<string, number> = {};
    await conn.beginTransaction();
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const tbl of targetTables) {
      const rows = tablesData[tbl];
      if (!Array.isArray(rows)) continue;

      const allowedColumns = await getExistingColumns(conn, tbl);
      if (allowedColumns.size === 0) continue;

      await conn.query(`DELETE FROM \`${tbl}\``);

      if (rows.length > 0 && rows[0] && typeof rows[0] === "object") {
        const rawKeys = Object.keys(rows[0]);
        const validColumns = rawKeys.filter(
          (c) => allowedColumns.has(c.toLowerCase()) && /^[a-z_][a-z0-9_]*$/i.test(c)
        );

        if (validColumns.length > 0) {
          const placeholders = validColumns.map(() => "?").join(", ");
          const colNames = validColumns.map((c) => `\`${c}\``).join(", ");
          const sql = `INSERT INTO \`${tbl}\` (${colNames}) VALUES (${placeholders})`;

          for (const r of rows) {
            if (!r || typeof r !== "object") continue;
            const values = validColumns.map((c) => {
              const v = r[c];
              if (v === undefined) return null;
              if ((c === "created_at" || c === "updated_at") && typeof v === "string" && v.includes("T")) {
                return toMysqlDatetime(v);
              }
              return v;
            });
            await conn.query(sql, values);
          }
        }
      }
      stats[tbl] = rows.length;
    }

    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    await conn.commit();

    const modeText = mode === "MENU_ONLY" ? "Thực đơn & Bảng giá" : "Toàn bộ CSDL";
    return {
      success: true,
      message: `Đã khôi phục thành công ${modeText}! (${stats.products ?? 0} món, ${stats.product_variants ?? 0} quy cách, ${stats.product_options ?? 0} tùy chọn).`,
      stats,
    };
  } catch (error) {
    try {
      await conn.rollback();
      await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    } catch {}
    console.error("[MySQL] Lỗi importFullDatabaseFromJson:", error);
    return {
      success: false,
      message: "Lỗi khôi phục dữ liệu JSON. Vui lòng kiểm tra cấu trúc file sao lưu.",
    };
  } finally {
    conn.release();
  }
}

export async function createDatabaseBackupSnapshot(label?: string): Promise<{
  success: boolean;
  filename: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  message: string;
}> {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const cleanLabel = label ? `_${label.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30)}` : "";
    const jsonFilename = `caxoi_backup_${ts}${cleanLabel}.json`;
    const jsonPath = path.join(BACKUPS_DIR, jsonFilename);

    const fullJson = await exportFullDatabaseToJson();
    fs.writeFileSync(jsonPath, JSON.stringify(fullJson, null, 2), "utf-8");

    pruneOldBackupSnapshots();

    const stat = fs.statSync(jsonPath);
    const sizeKb = Math.round(stat.size / 1024);
    const sizeFormatted = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;

    return {
      success: true,
      filename: jsonFilename,
      sizeBytes: stat.size,
      sizeFormatted,
      createdAt: now.toISOString(),
      message: `Đã tạo bản sao lưu ${jsonFilename} (${sizeFormatted}) an toàn trên hệ thống!`,
    };
  } catch (error) {
    console.error("[MySQL] Lỗi tạo snapshot sao lưu:", error);
    return {
      success: false,
      filename: "",
      sizeBytes: 0,
      sizeFormatted: "0 KB",
      createdAt: new Date().toISOString(),
      message: "Lỗi tạo bản sao lưu hệ thống.",
    };
  }
}

export function listDatabaseBackupSnapshots(): Array<{
  filename: string;
  format: "db" | "json" | "sql";
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  isAutoPreRestore: boolean;
}> {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const files = fs.readdirSync(BACKUPS_DIR);
    return files
      .filter((f) => f.endsWith(".json") || f.endsWith(".sql"))
      .map((f) => {
        const fullPath = path.join(BACKUPS_DIR, f);
        const stat = fs.statSync(fullPath);
        const format: "db" | "json" | "sql" = f.endsWith(".json") ? "json" : "sql";

        const sizeKb = Math.round(stat.size / 1024);
        const sizeFormatted = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;

        return {
          filename: f,
          format,
          sizeBytes: stat.size,
          sizeFormatted,
          createdAt: stat.mtime.toISOString(),
          isAutoPreRestore: f.startsWith("auto_pre_restore_") || f.includes("pre_restore"),
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function deleteBackupSnapshot(filename: string): { success: boolean; message: string } {
  try {
    const safePath = resolveSafeBackupPath(filename, [".json", ".sql"]);
    if (!safePath) {
      return { success: false, message: "Không tìm thấy hoặc tệp sao lưu không hợp lệ" };
    }
    fs.unlinkSync(safePath);
    return { success: true, message: `Đã xóa bản sao lưu ${path.basename(safePath)} thành công!` };
  } catch {
    return { success: false, message: "Lỗi xóa bản sao lưu." };
  }
}

export async function restoreDatabaseFromBackupSnapshot(
  filename: string,
  mode: "FULL" | "MENU_ONLY" = "FULL"
): Promise<{ success: boolean; message: string }> {
  try {
    const sourcePath = resolveSafeBackupPath(filename, [".json"]);
    if (!sourcePath) {
      return {
        success: false,
        message: "Chỉ hỗ trợ khôi phục snapshot định dạng .json trong thư mục backups.",
      };
    }

    await createDatabaseBackupSnapshot("pre_restore");

    const content = fs.readFileSync(sourcePath, "utf-8");
    const parsed = JSON.parse(content);
    return importFullDatabaseFromJson(parsed, mode);
  } catch (error) {
    console.error("[MySQL] Lỗi khôi phục từ snapshot:", error);
    return { success: false, message: "Lỗi khôi phục bản sao lưu." };
  }
}

export async function restoreDatabaseFromUploadedBuffer(
  buffer: Buffer,
  originalFilename: string,
  mode: "FULL" | "MENU_ONLY" = "FULL"
): Promise<{ success: boolean; message: string; stats?: any }> {
  try {
    const cleanFilename = path.basename(originalFilename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const lowerName = cleanFilename.toLowerCase();

    if (!lowerName.endsWith(".json")) {
      return {
        success: false,
        message:
          "Vì lý do bảo mật, tính năng nhập qua trình duyệt chỉ hỗ trợ tệp sao lưu .json (xuất từ nút Tải Backup JSON).",
      };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(buffer.toString("utf-8"));
    } catch {
      return { success: false, message: "Tệp tải lên không phải là định dạng JSON hợp lệ." };
    }

    const tablesData = parsed?.tables || parsed;
    if (!tablesData || typeof tablesData !== "object" || Array.isArray(tablesData)) {
      return { success: false, message: "Cấu trúc tệp JSON sao lưu không hợp lệ." };
    }

    await createDatabaseBackupSnapshot("pre_restore");

    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }
    const uploadedSaveName = `uploaded_${Date.now()}_${cleanFilename.slice(0, 60)}`;
    fs.writeFileSync(path.join(BACKUPS_DIR, uploadedSaveName), buffer);
    pruneOldBackupSnapshots();

    return importFullDatabaseFromJson(parsed, mode);
  } catch (error) {
    console.error("[MySQL] Lỗi khôi phục tệp tải lên:", error);
    return { success: false, message: "Lỗi trong quá trình khôi phục dữ liệu tải lên." };
  }
}

// ============================================================================
// 12. RATE LIMITING BỀN VỮNG BẰNG MYSQL
// ============================================================================
async function pruneExpiredRateLimits(currentPool: Pool, now: number) {
  try {
    const cutoff = now - 30 * 60 * 1000;
    await currentPool.query("DELETE FROM rate_limits WHERE updated_at < ? AND locked_until < ?", [
      cutoff,
      now,
    ]);
  } catch {}
}

export async function checkRateLimitLockInMySql(key: string): Promise<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const now = Date.now();
    const [rows] = await currentPool.query<RowDataPacket[]>(
      "SELECT `count`, `locked_until` FROM `rate_limits` WHERE `key` = ?",
      [key]
    );
    const row = rows[0];
    if (row && Number(row.locked_until) > now) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((Number(row.locked_until) - now) / 1000)),
      };
    }
    return { allowed: true, remaining: 1, retryAfterSeconds: 0 };
  } catch {
    return { allowed: true, remaining: 1, retryAfterSeconds: 0 };
  }
}

export async function consumeRateLimitInMySql(
  key: string,
  maxRequests: number,
  windowMs: number,
  lockDurationMs?: number
): Promise<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const now = Date.now();

    if (Math.random() < 0.05) {
      pruneExpiredRateLimits(currentPool, now).catch(() => {});
    }

    const [rows] = await currentPool.query<RowDataPacket[]>(
      "SELECT `count`, `window_start`, `locked_until` FROM `rate_limits` WHERE `key` = ?",
      [key]
    );
    const row = rows[0];

    if (row && Number(row.locked_until) > now) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((Number(row.locked_until) - now) / 1000)),
      };
    }

    if (!row || now - Number(row.window_start) >= windowMs) {
      const nextCount = 1;
      const exceeded = nextCount > maxRequests;
      const lockedUntil = exceeded ? now + (lockDurationMs ?? windowMs) : 0;
      await currentPool.query(
        `INSERT INTO \`rate_limits\` (\`key\`, \`count\`, \`window_start\`, \`locked_until\`, \`updated_at\`)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           \`count\` = VALUES(\`count\`),
           \`window_start\` = VALUES(\`window_start\`),
           \`locked_until\` = VALUES(\`locked_until\`),
           \`updated_at\` = VALUES(\`updated_at\`)`,
        [key, nextCount, now, lockedUntil, now]
      );

      return {
        allowed: !exceeded,
        remaining: Math.max(0, maxRequests - nextCount),
        retryAfterSeconds: exceeded ? Math.max(1, Math.ceil((lockedUntil - now) / 1000)) : 0,
      };
    }

    const nextCount = Number(row.count) + 1;
    const exceeded = nextCount > maxRequests;
    const windowRemainingMs = Math.max(1000, windowMs - (now - Number(row.window_start)));
    const lockedUntil = exceeded
      ? now + (lockDurationMs ?? windowRemainingMs)
      : nextCount >= maxRequests && lockDurationMs
      ? now + lockDurationMs
      : 0;

    await currentPool.query(
      "UPDATE `rate_limits` SET `count` = ?, `locked_until` = ?, `updated_at` = ? WHERE `key` = ?",
      [nextCount, lockedUntil, now, key]
    );

    if (exceeded) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - now) / 1000)),
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - nextCount),
      retryAfterSeconds: 0,
    };
  } catch (err: any) {
    console.error("[RateLimit MySQL Error]", err?.message);
    return { allowed: true, remaining: 1, retryAfterSeconds: 0 };
  }
}

export async function resetRateLimitInMySql(key: string): Promise<void> {
  try {
    const currentPool = await ensureMySqlInitialized();
    await currentPool.query("DELETE FROM `rate_limits` WHERE `key` = ?", [key]);
  } catch {}
}

// ============================================================================
// 13. NHẬT KÝ KIỂM TOÁN (AUDIT LOGS)
// ============================================================================
export async function recordAuditLogInMySql(entry: {
  actorId?: string | null;
  actorUsername: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  metadata?: Record<string, any> | null;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const safeMetadata = entry.metadata ? JSON.stringify(entry.metadata).slice(0, 2000) : null;
    await currentPool.query(
      `INSERT INTO audit_logs (
        actor_id, actor_username, actor_role, action, target_type, target_id, summary, metadata_json, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        entry.actorId || null,
        String(entry.actorUsername || "unknown").slice(0, 80),
        String(entry.actorRole || "UNKNOWN").slice(0, 40),
        String(entry.action || "UNKNOWN").slice(0, 80),
        String(entry.targetType || "SYSTEM").slice(0, 40),
        entry.targetId ? String(entry.targetId).slice(0, 120) : null,
        String(entry.summary || "").slice(0, 400),
        safeMetadata,
        entry.ipAddress ? String(entry.ipAddress).slice(0, 64) : null,
      ]
    );

    if (Math.random() < 0.05) {
      await currentPool.query(`
        DELETE FROM audit_logs
        WHERE id NOT IN (
          SELECT id FROM (SELECT id FROM audit_logs ORDER BY id DESC LIMIT 2000) AS keep_ids
        )
      `);
    }
  } catch (err: any) {
    console.error("[AuditLog MySQL Error]", err?.message);
  }
}

export async function getAuditLogsFromMySql(filters?: {
  action?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  try {
    const currentPool = await ensureMySqlInitialized();
    const limit = Math.max(1, Math.min(300, filters?.limit || 100));
    const whereParts: string[] = [];
    const params: any[] = [];

    if (filters?.action && filters.action !== "ALL") {
      whereParts.push("action LIKE ?");
      params.push(`${filters.action}%`);
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const [rows] = await currentPool.query<RowDataPacket[]>(
      `SELECT * FROM audit_logs ${whereClause} ORDER BY id DESC LIMIT ?`,
      [...params, limit]
    );

    return rows.map((r) => {
      let metadata: Record<string, any> | null = null;
      if (r.metadata_json) {
        try {
          metadata = JSON.parse(r.metadata_json);
        } catch {}
      }
      return {
        id: Number(r.id),
        actorId: r.actor_id || null,
        actorUsername: String(r.actor_username),
        actorRole: String(r.actor_role),
        action: String(r.action),
        targetType: String(r.target_type),
        targetId: r.target_id || null,
        summary: String(r.summary),
        metadata,
        ipAddress: r.ip_address || null,
        createdAt: normalizeTimestamp(r.created_at),
      };
    });
  } catch (err: any) {
    console.error("[AuditLog MySQL Read Error]", err?.message);
    return [];
  }
}
