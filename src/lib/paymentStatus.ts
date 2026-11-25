import { PaymentStatus } from "@/types";

export const DEFAULT_BANK_CONFIG = {
  bankId: "MB",
  bankName: "MBBank",
  accountNo: "999988886666",
  accountName: "CA XOI CAFE",
} as const;

export function normalizePaymentStatus(status?: string | null): PaymentStatus {
  const upper = String(status || "PENDING").trim().toUpperCase();
  if (upper === "PAID") return "PAID";
  if (upper === "MANUAL_PAID") return "MANUAL_PAID";
  if (upper === "PARTIAL") return "PARTIAL";
  if (upper === "REFUNDED") return "REFUNDED";
  if (upper === "UNPAID" || upper === "PENDING") return "PENDING";
  return "PENDING";
}

export function isOrderPaidStatus(status?: string | null): boolean {
  const normalized = normalizePaymentStatus(status);
  return normalized === "PAID" || normalized === "MANUAL_PAID";
}

export function isOrderPendingOrPartial(status?: string | null): boolean {
  const normalized = normalizePaymentStatus(status);
  return normalized === "PENDING" || normalized === "PARTIAL";
}

export function getRemainingOrderAmount(totalAmount: number, paidAmount?: number | null): number {
  const total = Math.max(0, Number(totalAmount) || 0);
  const paid = Math.max(0, Number(paidAmount) || 0);
  return Math.max(0, total - paid);
}

export function normalizeOrderCodeKey(code: string): string {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function extractOrderCodeCandidates(
  ...sources: Array<string | null | undefined>
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (val: string) => {
    const clean = val.trim().toUpperCase();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      candidates.push(clean);
    }
  };

  for (const rawSource of sources) {
    if (!rawSource) continue;
    const text = String(rawSource).toUpperCase();

    const cfBoundaryRegex = /(?:^|[^A-Z0-9])CF\s*[-_./]?\s*(\d{4})\s*[-_./]?\s*(\d{3,6})(?=$|[^0-9])/g;
    let m: RegExpExecArray | null;
    while ((m = cfBoundaryRegex.exec(text)) !== null) {
      pushCandidate(`CF${m[1]}-${m[2]}`);
    }

    const cfShortSeqRegex = /(?:^|[^A-Z0-9])CF\s*[-_./]?\s*(\d{4})\s*[-_./\s]+\s*(\d{1,2})(?=$|[^0-9])/g;
    while ((m = cfShortSeqRegex.exec(text)) !== null) {
      const padded = m[2].padStart(3, "0");
      pushCandidate(`CF${m[1]}-${padded}`);
      pushCandidate(`CF${m[1]}-${m[2]}`);
    }

    const cfLooseRegex = /CF\s*[-_./]?\s*(\d{4})\s*[-_./]?\s*(\d{3,6})(?=$|[^0-9])/g;
    while ((m = cfLooseRegex.exec(text)) !== null) {
      pushCandidate(`CF${m[1]}-${m[2]}`);
    }

    const cxRegex = /(?:^|[^A-Z0-9])CX\s*[-_./]?\s*(\d{3,6})(?=$|[^0-9])/g;
    while ((m = cxRegex.exec(text)) !== null) {
      pushCandidate(`CX-${m[1]}`);
    }
  }

  return candidates;
}

export function getPaymentStatusMeta(paymentStatus?: string | null) {
  const normalized = normalizePaymentStatus(paymentStatus);
  switch (normalized) {
    case "PAID":
      return {
        code: "PAID" as const,
        label: "Đã thanh toán payOS",
        shortLabel: "Đã TT payOS",
        customerLabel: "Đã thanh toán thành công",
        bg: "bg-emerald-50",
        text: "text-emerald-800",
        border: "border-emerald-300",
        dot: "bg-emerald-500",
      };
    case "MANUAL_PAID":
      return {
        code: "MANUAL_PAID" as const,
        label: "Xác nhận tay",
        shortLabel: "Xác nhận tay",
        customerLabel: "Đã thanh toán thành công",
        bg: "bg-sky-50",
        text: "text-sky-800",
        border: "border-sky-300",
        dot: "bg-sky-500",
      };
    case "PARTIAL":
      return {
        code: "PARTIAL" as const,
        label: "Chuyển thiếu",
        shortLabel: "Chuyển thiếu",
        customerLabel: "Đã nhận một phần (Chuyển thiếu)",
        bg: "bg-orange-50",
        text: "text-orange-800",
        border: "border-orange-300",
        dot: "bg-orange-500",
      };
    case "REFUNDED":
      return {
        code: "REFUNDED" as const,
        label: "Đã hoàn tiền",
        shortLabel: "Hoàn tiền",
        customerLabel: "Đã hoàn tiền",
        bg: "bg-stone-100",
        text: "text-stone-700",
        border: "border-stone-300",
        dot: "bg-stone-500",
      };
    case "PENDING":
    default:
      return {
        code: "PENDING" as const,
        label: "Chờ thanh toán",
        shortLabel: "Chờ thanh toán",
        customerLabel: "Chờ thanh toán",
        bg: "bg-amber-50",
        text: "text-amber-900",
        border: "border-amber-300",
        dot: "bg-amber-500",
      };
  }
}
