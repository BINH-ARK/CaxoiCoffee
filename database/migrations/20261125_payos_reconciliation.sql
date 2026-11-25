-- ============================================================================
-- Migration: payOS Automatic Bank Reconciliation
-- Date: 2026-11-25
-- Notes: Schema-only migration for MySQL 5.7+ / 8.0+ / MariaDB
-- ============================================================================

ALTER TABLE `orders`
  MODIFY COLUMN `payment_status` VARCHAR(30) NOT NULL DEFAULT 'PENDING';

ALTER TABLE `orders`
  ADD COLUMN `paid_amount` DOUBLE NOT NULL DEFAULT 0 AFTER `total_amount`,
  ADD COLUMN `paid_at` DATETIME DEFAULT NULL AFTER `paid_amount`,
  ADD COLUMN `payment_note` TEXT DEFAULT NULL AFTER `paid_at`;

CREATE TABLE IF NOT EXISTS `bank_transactions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `sepay_id` VARCHAR(128) NOT NULL,
  `gateway` VARCHAR(80) DEFAULT NULL,
  `transaction_date` VARCHAR(64) DEFAULT NULL,
  `account_number` VARCHAR(50) DEFAULT NULL,
  `transfer_type` VARCHAR(20) NOT NULL DEFAULT 'in',
  `transfer_amount` DOUBLE NOT NULL DEFAULT 0,
  `content` TEXT DEFAULT NULL,
  `reference_code` VARCHAR(128) DEFAULT NULL,
  `matched_order_code` VARCHAR(40) DEFAULT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'UNMATCHED',
  `raw_payload` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bank_transactions_sepay_id` (`sepay_id`),
  KEY `idx_bank_transactions_status` (`status`),
  KEY `idx_bank_transactions_order_code` (`matched_order_code`),
  KEY `idx_bank_transactions_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
