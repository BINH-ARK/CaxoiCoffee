-- ============================================================================
-- ONLINE CAFÉ ORDERING & OFFICE DELIVERY PLATFORM
-- MINIMAL INIT SEED (Roles + SUPER_ADMIN 'quynhnhu' only)
-- ============================================================================

INSERT INTO roles (id, name, description) VALUES
(1, 'SUPER_ADMIN', 'Toàn quyền quản trị hệ thống, menu, doanh thu và cấu hình máy chủ'),
(2, 'STORE_MANAGER', 'Quản lý cửa hàng, duyệt khuyến mãi, cấu hình giờ mở cửa và tải quầy bar'),
(3, 'BARISTA', 'Nhân viên pha chế: Xem màn hình KDS, cập nhật tiến độ món, in tem dán ly'),
(4, 'CASHIER', 'Thu ngân: Kiểm tra hóa đơn, hỗ trợ xác nhận thanh toán tiền mặt');

-- Đặt mật khẩu quản trị thật qua ADMIN_PASSWORD trong .env hoặc giao diện Admin sau khi khởi tạo
INSERT INTO users (id, username, password_hash, full_name, phone, role_id, is_active) VALUES
('a0000000-0000-0000-0000-000000000001', 'quynhnhu', 'INIT_REQUIRED', 'Quản Trị Viên (Chủ Quán)', NULL, 1, TRUE);
