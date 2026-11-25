import { Order } from "@/types";
import {
  getOrderByIdFromMySql,
  processBankWebhookInMySql,
  recordAuditLogInMySql,
} from "@/lib/mysql";
import {
  derivePayOsNumericOrderCode,
  getPayOsConfig,
  getPayOsPaymentLinkInfo,
} from "@/lib/payos";
import { isOrderPaidStatus } from "@/lib/paymentStatus";
import { sendOrderNotificationEmail } from "@/lib/mail";

const MIN_POLL_INTERVAL_MS = 3000;
const lastSyncTimestampMap = new Map<string, number>();
const inFlightSyncMap = new Map<string, Promise<PayOsSyncResult>>();

export interface PayOsSyncResult {
  checked: boolean;
  updated: boolean;
  paid: boolean;
  payosStatus?: string;
  amountPaid?: number;
  message?: string;
  order: Order;
}

/**
 * Chủ động truy vấn trạng thái thanh toán từ API payOS (`GET /v2/payment-requests/{orderCode}`)
 * và đối soát nguyên tử vào MySQL (dùng chung khóa idempotency `payos_<reference>` với Webhook).
 * Giúp đơn tự động chuyển sang PAID ngay cả khi chạy trên localhost hoặc khi Webhook bị trễ/nghẽn.
 */
export async function syncOrderPaymentWithPayOs(
  order: Order,
  options?: { force?: boolean; ipAddress?: string }
): Promise<PayOsSyncResult> {
  if (
    !order ||
    order.paymentMethod !== "VIETQR_BANKING" ||
    order.status === "CANCELLED" ||
    isOrderPaidStatus(order.paymentStatus)
  ) {
    return {
      checked: false,
      updated: false,
      paid: isOrderPaidStatus(order?.paymentStatus),
      order,
    };
  }

  const cfg = getPayOsConfig();
  if (!cfg.isConfigured) {
    return {
      checked: false,
      updated: false,
      paid: false,
      message: "payOS chưa được cấu hình.",
      order,
    };
  }

  const now = Date.now();
  const lastChecked = lastSyncTimestampMap.get(order.id) || 0;
  if (!options?.force && now - lastChecked < MIN_POLL_INTERVAL_MS) {
    return { checked: false, updated: false, paid: false, order };
  }

  const existingInFlight = inFlightSyncMap.get(order.id);
  if (existingInFlight) {
    return existingInFlight;
  }

  const task = (async (): Promise<PayOsSyncResult> => {
    lastSyncTimestampMap.set(order.id, Date.now());
    try {
      const numericOrderCode = derivePayOsNumericOrderCode(order.orderCode);
      const infoRes = await getPayOsPaymentLinkInfo(numericOrderCode);
      if (!infoRes.ok) {
        return {
          checked: true,
          updated: false,
          paid: false,
          message: infoRes.message,
          order,
        };
      }

      const info = infoRes.data;
      let anyUpdated = false;
      let matchedNow = false;
      const txs = Array.isArray(info.transactions)
        ? info.transactions.filter((t) => Number(t.amount) > 0)
        : [];

      if (txs.length > 0) {
        for (const tx of txs) {
          const ref = tx.reference ? String(tx.reference).trim().slice(0, 128) : null;
          const rawKey = ref || `${info.id || "link"}_${info.orderCode}_${tx.amount}`;
          const txId = `payos_${rawKey}`.slice(0, 128);

          const proc = await processBankWebhookInMySql({
            sepayId: txId,
            gateway: "payOS",
            transactionDate: tx.transactionDateTime || new Date().toISOString(),
            accountNumber: tx.virtualAccountNumber || tx.accountNumber || null,
            transferType: "in",
            transferAmount: Number(tx.amount),
            content: tx.description || order.orderCode,
            referenceCode: ref,
            orderCodeCandidates: [order.orderCode],
            rawPayload: {
              source: "payos_active_sync",
              paymentLinkId: info.id,
              orderCode: info.orderCode,
              status: info.status,
              transaction: tx,
            },
          });

          if (proc.outcome === "MATCHED" || proc.outcome === "UNDERPAID") {
            anyUpdated = true;
          }
          if (proc.outcome === "MATCHED") {
            matchedNow = true;
            recordAuditLogInMySql({
              actorUsername: "sync:payos",
              actorRole: "SYSTEM",
              action: "PAYOS_SYNC_PAYMENT_MATCHED",
              targetType: "ORDER",
              targetId: order.orderCode,
              summary: `payOS Active Sync xác nhận ${Number(tx.amount).toLocaleString("vi-VN")}đ cho đơn ${order.orderCode} (Ref: ${ref || info.orderCode})`,
              metadata: {
                txId,
                payosOrderCode: info.orderCode,
                transferAmount: tx.amount,
                paidAmount: proc.paidAmount,
                totalAmount: proc.totalAmount,
                referenceCode: ref,
              },
              ipAddress: options?.ipAddress,
            }).catch(() => {});
          }
        }
      } else if (info.status === "PAID" && info.amountPaid > 0) {
        const txId = `payos_${info.id || info.orderCode}_${info.orderCode}`.slice(0, 128);
        const proc = await processBankWebhookInMySql({
          sepayId: txId,
          gateway: "payOS",
          transactionDate: new Date().toISOString(),
          accountNumber: null,
          transferType: "in",
          transferAmount: info.amountPaid,
          content: order.orderCode,
          referenceCode: info.id || String(info.orderCode),
          orderCodeCandidates: [order.orderCode],
          rawPayload: {
            source: "payos_active_sync_status",
            paymentLinkId: info.id,
            orderCode: info.orderCode,
            status: info.status,
            amountPaid: info.amountPaid,
          },
        });
        if (proc.outcome === "MATCHED" || proc.outcome === "UNDERPAID") {
          anyUpdated = true;
        }
        if (proc.outcome === "MATCHED") {
          matchedNow = true;
        }
      }

      const latestOrder = anyUpdated ? (await getOrderByIdFromMySql(order.id)) || order : order;
      const isNowPaid = isOrderPaidStatus(latestOrder.paymentStatus);

      if (matchedNow && isNowPaid) {
        sendOrderNotificationEmail(latestOrder).catch((err) =>
          console.error("[payOS Sync] Email notification error:", err)
        );
      }

      return {
        checked: true,
        updated: anyUpdated,
        paid: isNowPaid,
        payosStatus: info.status,
        amountPaid: info.amountPaid,
        message: isNowPaid
          ? "Đã xác nhận thanh toán thành công từ payOS!"
          : info.amountPaid > 0
          ? `payOS đã nhận ${info.amountPaid.toLocaleString("vi-VN")}đ (còn thiếu ${Math.max(0, info.amountRemaining).toLocaleString("vi-VN")}đ).`
          : "payOS chưa ghi nhận giao dịch chuyển khoản cho đơn này. Nếu bạn vừa chuyển, vui lòng đợi vài giây rồi thử lại.",
        order: latestOrder,
      };
    } catch (err: any) {
      console.warn("[payOS Active Sync] Lỗi kiểm tra:", err?.message);
      return {
        checked: true,
        updated: false,
        paid: false,
        message: "Không thể kết nối tới payOS lúc này.",
        order,
      };
    } finally {
      inFlightSyncMap.delete(order.id);
    }
  })();

  inFlightSyncMap.set(order.id, task);
  return task;
}
