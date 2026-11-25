-- ============================================================================
-- SQLITE DATABASE SCHEMA & ADMIN INIT FOR CÀ XÒI
-- File: database/sqlite_caxoi_cafe.sql
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

DROP TABLE IF EXISTS group_session_items;
DROP TABLE IF EXISTS group_sessions;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS product_option_values;
DROP TABLE IF EXISTS product_options;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS business_settings;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS promotions;

CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
);

INSERT INTO roles (id, name, description) VALUES
(1, 'SUPER_ADMIN', 'Chủ quán - Toàn quyền quản trị hệ thống, thực đơn, doanh thu và cấu hình máy chủ'),
(2, 'STORE_MANAGER', 'Quản lý cửa hàng - Điều phối quán, cập nhật thực đơn, duyệt khuyến mãi và giờ mở cửa'),
(3, 'BARISTA', 'Nhân viên pha chế - Màn hình KDS nhận đơn, cập nhật tiến độ pha chế và in tem dán ly'),
(4, 'CASHIER', 'Thu ngân - Kiểm tra hóa đơn, đối soát và hỗ trợ xác nhận thanh toán');

CREATE TABLE permissions (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT
);

INSERT INTO permissions (id, code, name, category, description) VALUES
('p_orders_view', 'orders.view', 'Xem đơn hàng', 'ORDERS', 'Xem chi tiết đơn hàng cá nhân, đơn tòa nhà và đơn nhóm'),
('p_orders_status', 'orders.update_status', 'Cập nhật tiến độ pha chế', 'ORDERS', 'Đổi trạng thái đơn: Chờ pha -> Đang pha -> Sẵn sàng -> Hoàn tất'),
('p_orders_print', 'orders.print', 'In tem ly & Hóa đơn', 'ORDERS', 'Gửi lệnh in tem dán ly 50x30mm và hóa đơn thanh toán'),
('p_orders_cancel', 'orders.cancel', 'Hủy đơn hàng', 'ORDERS', 'Hủy đơn hàng khi khách yêu cầu hoặc quầy gặp sự cố'),
('p_menu_view', 'menu.view', 'Xem thực đơn', 'MENU', 'Xem danh mục, sản phẩm, kích cỡ và bảng giá'),
('p_menu_toggle', 'menu.toggle_availability', 'Bật/Tắt còn hàng', 'MENU', 'Gạt nút khóa món tức thì khi hết nguyên liệu'),
('p_menu_pricing', 'menu.edit_pricing', 'Sửa giá & Tạo món', 'MENU', 'Thêm món mới, điều chỉnh giá bán và kích cỡ'),
('p_promotions_view', 'promotions.view', 'Xem mã giảm giá', 'PROMOTIONS', 'Xem danh sách mã khuyến mãi đang áp dụng'),
('p_promotions_manage', 'promotions.manage', 'Quản lý Voucher', 'PROMOTIONS', 'Tạo voucher mới, chỉnh sửa tỷ lệ chiết khấu và hạn mức'),
('p_finance_revenue', 'finance.view_revenue', 'Xem doanh thu', 'FINANCE', 'Xem số liệu doanh thu thực tế, tiền hàng theo ngày/tuần/tháng'),
('p_finance_analytics', 'finance.view_analytics', 'Biểu đồ giờ cao điểm', 'FINANCE', 'Xem phân bổ đơn theo khung giờ để tối ưu ca làm việc'),
('p_system_pause', 'system.emergency_pause', 'Tạm dừng nhận đơn cao điểm', 'SYSTEM', 'Nút khẩn cấp đóng nhận đơn trực tuyến khi quán quá tải'),
('p_system_settings', 'system.settings', 'Cấu hình ngân hàng & Vận hành', 'SYSTEM', 'Cấu hình tài khoản VietQR, phí giao hàng, giờ mở cửa'),
('p_system_roles', 'system.manage_roles', 'Quản lý Phân quyền & Nhân viên', 'SYSTEM', 'Cấp phát quyền hạn, cấp mã PIN và tài khoản nhân viên');

CREATE TABLE role_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_name TEXT NOT NULL,
    permission_code TEXT NOT NULL,
    UNIQUE(role_name, permission_code)
);

INSERT INTO role_permissions (role_name, permission_code) VALUES
('SUPER_ADMIN', 'orders.view'),
('SUPER_ADMIN', 'orders.update_status'),
('SUPER_ADMIN', 'orders.print'),
('SUPER_ADMIN', 'orders.cancel'),
('SUPER_ADMIN', 'menu.view'),
('SUPER_ADMIN', 'menu.toggle_availability'),
('SUPER_ADMIN', 'menu.edit_pricing'),
('SUPER_ADMIN', 'promotions.view'),
('SUPER_ADMIN', 'promotions.manage'),
('SUPER_ADMIN', 'finance.view_revenue'),
('SUPER_ADMIN', 'finance.view_analytics'),
('SUPER_ADMIN', 'system.emergency_pause'),
('SUPER_ADMIN', 'system.settings'),
('SUPER_ADMIN', 'system.manage_roles');

INSERT INTO role_permissions (role_name, permission_code) VALUES
('STORE_MANAGER', 'orders.view'),
('STORE_MANAGER', 'orders.update_status'),
('STORE_MANAGER', 'orders.print'),
('STORE_MANAGER', 'orders.cancel'),
('STORE_MANAGER', 'menu.view'),
('STORE_MANAGER', 'menu.toggle_availability'),
('STORE_MANAGER', 'promotions.view'),
('STORE_MANAGER', 'finance.view_revenue'),
('STORE_MANAGER', 'finance.view_analytics'),
('STORE_MANAGER', 'system.emergency_pause');

INSERT INTO role_permissions (role_name, permission_code) VALUES
('BARISTA', 'orders.view'),
('BARISTA', 'orders.update_status'),
('BARISTA', 'orders.print'),
('BARISTA', 'menu.view');

INSERT INTO role_permissions (role_name, permission_code) VALUES
('CASHIER', 'orders.view'),
('CASHIER', 'orders.update_status'),
('CASHIER', 'orders.print'),
('CASHIER', 'menu.view'),
('CASHIER', 'promotions.view');

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    plain_password TEXT,
    pin TEXT,
    full_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    role_id INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- Không lưu mật khẩu dạng rõ trong mã nguồn; đặt ADMIN_PASSWORD trong .env để khởi tạo mật khẩu cho admin: quynhnhu
INSERT INTO users (id, username, password_hash, plain_password, pin, full_name, phone, email, role_id, is_active, token_version) VALUES
('a0000000-0000-0000-0000-000000000001', 'quynhnhu', 'INIT_REQUIRED', NULL, NULL, 'Quản Trị Viên (Chủ Quán)', NULL, NULL, 1, 1, 1);

CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    image_url TEXT,
    display_order INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE products (
    id TEXT PRIMARY KEY,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    base_price REAL NOT NULL,
    sale_price REAL,
    is_available INTEGER NOT NULL DEFAULT 1,
    is_featured INTEGER NOT NULL DEFAULT 1,
    prep_time_minutes INTEGER NOT NULL DEFAULT 4,
    tags TEXT DEFAULT 'BEST_SELLER',
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    size_name TEXT NOT NULL,
    extra_price REAL NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE product_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 0,
    is_multiple INTEGER NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE product_option_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    option_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    extra_price REAL NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (option_id) REFERENCES product_options(id) ON DELETE CASCADE
);

CREATE TABLE business_settings (
    id INTEGER PRIMARY KEY,
    store_name TEXT NOT NULL,
    store_status TEXT NOT NULL DEFAULT 'OPEN',
    store_status_message TEXT,
    hotline TEXT,
    phone TEXT,
    address TEXT,
    open_time TEXT,
    close_time TEXT,
    shipping_fee_mode TEXT NOT NULL DEFAULT 'AUTO',
    base_delivery_fee REAL NOT NULL DEFAULT 15000,
    free_delivery_min_cups INTEGER NOT NULL DEFAULT 3,
    max_slot_capacity_cups INTEGER NOT NULL DEFAULT 30,
    prep_lead_time_minutes INTEGER NOT NULL DEFAULT 5,
    vietqr_bank_id TEXT DEFAULT 'MB',
    vietqr_account_no TEXT DEFAULT '999988886666',
    vietqr_account_name TEXT DEFAULT 'CA XOI CAFE',
    bank_account_no TEXT,
    bank_account_name TEXT,
    bank_bin TEXT,
    bank_name TEXT,
    is_auto_confirm_qr INTEGER NOT NULL DEFAULT 1,
    rush_mode_message TEXT,
    hero_badge_brand TEXT,
    hero_location TEXT,
    hero_eyebrow TEXT,
    hero_headline_primary TEXT,
    hero_headline_highlight TEXT,
    hero_description TEXT,
    hero_service_note TEXT,
    hero_price_badge_1 TEXT,
    hero_price_badge_2 TEXT,
    hero_price_badge_3 TEXT,
    hero_primary_cta_text TEXT,
    hero_secondary_cta_text TEXT,
    hero_watermark_text TEXT,
    hero_logo_url TEXT,
    hero_mascot_title TEXT,
    hero_mascot_subtitle TEXT,
    facebook_url TEXT,
    qr_facebook_title TEXT,
    qr_facebook_subtitle TEXT,
    xanh_sm_url TEXT,
    qr_xanh_sm_title TEXT,
    qr_xanh_sm_subtitle TEXT
);

CREATE TABLE companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    building_name TEXT NOT NULL,
    address TEXT NOT NULL,
    is_partner INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    discount_type TEXT NOT NULL,
    discount_value REAL NOT NULL,
    min_order_amount REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    max_discount_amount REAL DEFAULT NULL,
    usage_limit INTEGER DEFAULT NULL,
    used_count INTEGER NOT NULL DEFAULT 0,
    start_time TEXT DEFAULT NULL,
    end_time TEXT DEFAULT NULL
);

CREATE TABLE group_sessions (
    id TEXT PRIMARY KEY,
    session_code TEXT NOT NULL UNIQUE,
    host_name TEXT NOT NULL,
    host_phone TEXT NOT NULL,
    host_token TEXT,
    building_name TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN',
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE group_session_items (
    id TEXT PRIMARY KEY,
    session_code TEXT NOT NULL,
    cart_item_id TEXT,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    variant_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    recipient_label TEXT,
    notes TEXT,
    item_payload_json TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (session_code) REFERENCES group_sessions(session_code) ON DELETE CASCADE
);

CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    order_code TEXT NOT NULL UNIQUE,
    order_type TEXT NOT NULL DEFAULT 'OFFICE_DELIVERY',
    recipient_name TEXT NOT NULL,
    recipient_phone TEXT NOT NULL,
    company_name TEXT,
    building_name TEXT,
    floor_room TEXT,
    delivery_address TEXT,
    delivery_notes TEXT,
    scheduled_type TEXT DEFAULT 'ASAP',
    scheduled_time TEXT,
    subtotal_amount REAL NOT NULL,
    discount_amount REAL NOT NULL DEFAULT 0,
    delivery_fee REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    status TEXT NOT NULL,
    promotion_code TEXT,
    group_session_id TEXT,
    barista_notes TEXT,
    shipper_name TEXT,
    shipper_phone TEXT,
    estimated_delivery_time TEXT,
    tracking_notes TEXT,
    tracking_token TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    variant_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    recipient_label TEXT,
    item_notes TEXT,
    selected_options_json TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE webhook_transactions (
    tx_id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    order_code TEXT NOT NULL,
    amount REAL NOT NULL,
    gateway TEXT,
    processed_at TEXT DEFAULT (datetime('now', 'localtime'))
);
