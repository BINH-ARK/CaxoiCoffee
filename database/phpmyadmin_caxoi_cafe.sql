-- ============================================================================
-- PHPMYADMIN / MYSQL DATABASE SCHEMA & ADMIN INIT FOR CÀ XÒI
-- Target System: phpMyAdmin / MySQL / MariaDB
-- Character Set: utf8mb4
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+07:00";

-- --------------------------------------------------------
-- 1. TẠO CƠ SỞ DỮ LIỆU
-- --------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `caxoi_cafe` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `caxoi_cafe`;

-- --------------------------------------------------------
-- 2. BẢNG PHÂN QUYỀN (ROLES)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `roles`;
CREATE TABLE `roles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_role_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `roles` (`id`, `name`, `description`) VALUES
(1, 'SUPER_ADMIN', 'Chủ quán - Toàn quyền quản trị hệ thống, thực đơn, doanh thu và cấu hình máy chủ'),
(2, 'STORE_MANAGER', 'Quản lý cửa hàng - Điều phối quán, cập nhật thực đơn, duyệt khuyến mãi và giờ mở cửa'),
(3, 'BARISTA', 'Nhân viên pha chế - Màn hình KDS nhận đơn, cập nhật tiến độ pha chế và in tem dán ly'),
(4, 'CASHIER', 'Thu ngân - Kiểm tra hóa đơn, đối soát và hỗ trợ xác nhận thanh toán');

-- --------------------------------------------------------
-- 3. BẢNG TÀI KHOẢN QUẢN TRỊ (CHỈ KHỞI TẠO ADMIN: quynhnhu)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` varchar(36) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `plain_password` varchar(100) DEFAULT NULL,
  `pin` varchar(10) DEFAULT NULL,
  `full_name` varchar(100) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `role_id` int(11) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_user_username` (`username`),
  KEY `fk_users_roles` (`role_id`),
  CONSTRAINT `fk_users_roles` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Không lưu mật khẩu dạng rõ trong tệp SQL công khai; cấu hình ADMIN_PASSWORD trong .env khi khởi chạy
INSERT INTO `users` (`id`, `username`, `password_hash`, `plain_password`, `pin`, `full_name`, `phone`, `role_id`, `is_active`) VALUES
('a0000000-0000-0000-0000-000000000001', 'quynhnhu', 'INIT_REQUIRED', NULL, NULL, 'Quản Trị Viên (Chủ Quán)', NULL, 1, 1);

-- --------------------------------------------------------
-- 4. BẢNG DANH MỤC SẢN PHẨM (CATEGORIES)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `image_url` varchar(500) DEFAULT NULL,
  `display_order` int(11) NOT NULL DEFAULT 1,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_category_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 5. BẢNG SẢN PHẨM (PRODUCTS)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `products`;
CREATE TABLE `products` (
  `id` varchar(36) NOT NULL,
  `category_id` int(11) NOT NULL,
  `name` varchar(150) NOT NULL,
  `slug` varchar(150) NOT NULL,
  `description` text DEFAULT NULL,
  `image_url` varchar(500) DEFAULT NULL,
  `base_price` decimal(12,2) NOT NULL,
  `sale_price` decimal(12,2) DEFAULT NULL,
  `is_available` tinyint(1) NOT NULL DEFAULT 1,
  `is_featured` tinyint(1) NOT NULL DEFAULT 1,
  `prep_time_minutes` int(11) NOT NULL DEFAULT 4,
  `tags` varchar(255) DEFAULT 'BEST_SELLER',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_product_slug` (`slug`),
  KEY `fk_products_categories` (`category_id`),
  CONSTRAINT `fk_products_categories` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 6. BẢNG QUY CÁCH / SIZE (PRODUCT_VARIANTS)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `product_variants`;
CREATE TABLE `product_variants` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` varchar(36) NOT NULL,
  `size_name` varchar(50) NOT NULL,
  `extra_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `fk_variants_products` (`product_id`),
  CONSTRAINT `fk_variants_products` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 7. BẢNG TÙY CHỌN (OPTIONS & VALUES)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `product_options`;
CREATE TABLE `product_options` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `is_required` tinyint(1) NOT NULL DEFAULT 0,
  `is_multiple` tinyint(1) NOT NULL DEFAULT 0,
  `display_order` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `product_option_values`;
CREATE TABLE `product_option_values` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `option_id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `extra_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `display_order` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `fk_optval_options` (`option_id`),
  CONSTRAINT `fk_optval_options` FOREIGN KEY (`option_id`) REFERENCES `product_options` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 8. BẢNG CẤU HÌNH QUÁN (BUSINESS_SETTINGS)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `business_settings`;
CREATE TABLE `business_settings` (
  `setting_key` varchar(50) NOT NULL,
  `setting_value` text NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 9. BẢNG ĐỐI TÁC VĂN PHÒNG (COMPANIES)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `companies`;
CREATE TABLE `companies` (
  `id` varchar(36) NOT NULL,
  `name` varchar(150) NOT NULL,
  `tax_code` varchar(30) DEFAULT NULL,
  `preferred_building` varchar(255) NOT NULL,
  `is_corporate_partner` tinyint(1) NOT NULL DEFAULT 1,
  `discount_rate` decimal(5,2) NOT NULL DEFAULT 10.00,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 10. BẢNG KHUYẾN MÃI (PROMOTIONS)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `promotions`;
CREATE TABLE `promotions` (
  `code` varchar(30) NOT NULL,
  `description` varchar(255) NOT NULL,
  `discount_type` enum('PERCENT','FIXED_AMOUNT','FREE_SHIP') NOT NULL,
  `discount_value` decimal(12,2) NOT NULL,
  `min_order_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `max_discount_amount` decimal(12,2) DEFAULT NULL,
  `usage_limit` int(11) NOT NULL DEFAULT 1000,
  `used_count` int(11) NOT NULL DEFAULT 0,
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 11. BẢNG ĐƠN HÀNG (ORDERS)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `id` varchar(64) NOT NULL,
  `order_code` varchar(40) NOT NULL,
  `customer_id` varchar(36) DEFAULT NULL,
  `group_session_id` varchar(64) DEFAULT NULL,
  `order_type` varchar(30) NOT NULL DEFAULT 'OFFICE_DELIVERY',
  `status` varchar(30) NOT NULL DEFAULT 'CONFIRMED',
  `payment_status` varchar(30) NOT NULL DEFAULT 'PENDING',
  `payment_method` varchar(40) NOT NULL DEFAULT 'VIETQR_BANKING',
  `recipient_name` varchar(120) NOT NULL,
  `recipient_phone` varchar(30) NOT NULL,
  `company_name` varchar(150) DEFAULT NULL,
  `building_name` varchar(200) DEFAULT NULL,
  `floor_room` varchar(80) DEFAULT NULL,
  `delivery_address` varchar(255) DEFAULT NULL,
  `delivery_notes` text DEFAULT NULL,
  `scheduled_type` varchar(20) DEFAULT 'ASAP',
  `scheduled_time` varchar(64) DEFAULT NULL,
  `subtotal_amount` decimal(12,2) NOT NULL,
  `discount_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `delivery_fee` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total_amount` decimal(12,2) NOT NULL,
  `paid_amount` double NOT NULL DEFAULT 0,
  `paid_at` datetime DEFAULT NULL,
  `payment_note` text DEFAULT NULL,
  `promotion_code` varchar(30) DEFAULT NULL,
  `barista_notes` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_order_code` (`order_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 12. BẢNG CHI TIẾT MÓN TRONG ĐƠN (ORDER_ITEMS)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `order_items`;
CREATE TABLE `order_items` (
  `id` varchar(64) NOT NULL,
  `order_id` varchar(64) NOT NULL,
  `product_id` varchar(64) NOT NULL,
  `product_name` varchar(150) NOT NULL,
  `variant_name` varchar(50) NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 1,
  `unit_price` decimal(12,2) NOT NULL,
  `total_price` decimal(12,2) NOT NULL,
  `recipient_label` varchar(100) DEFAULT NULL,
  `item_notes` text DEFAULT NULL,
  `options_json` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_orderitems_orders` (`order_id`),
  CONSTRAINT `fk_orderitems_orders` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
COMMIT;
