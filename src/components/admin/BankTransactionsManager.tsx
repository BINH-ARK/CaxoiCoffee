"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Landmark,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Copy,
  Link2,
  Code2,
  X,
  ArrowDownLeft,
  Clock,
  Check,
  Sparkles,
} from "lucide-react";
import { BankTransaction, BankTransactionStatus, Order } from "@/types";
import { formatVND } from "@/lib/utils";
import {
  getRemainingOrderAmount,
  isOrderPendingOrPartial,
} from "@/lib/paymentStatus";

interface BankTransactionsSummary {
  total: number;
  matched: number;
  underpaid: number;
  unmatched: number;
  duplicate: number;
  totalMatchedAmount: number;
}

const TX_STATUS_CONFIG: Record<
  BankTransactionStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  MATCHED: {
    label: "Khớp đơn (MATCHED)",
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-300",
  },
  UNDERPAID: {
    label: "Chuyển thiếu (UNDERPAID)",
    bg: "bg-orange-50",
    text: "text-orange-800",
    border: "border-orange-300",
  },
  UNMATCHED: {
    label: "Chưa khớp (UNMATCHED)",
    bg: "bg-rose-50",
    text: "text-rose-800",
    border: "border-rose-300",
  },
  DUPLICATE: {
    label: "Trùng lặp (DUPLICATE)",
    bg: "bg-stone-100",
    text: "text-stone-700",
    border: "border-stone-300",
  },
};

export default function BankTransactionsManager() {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [summary, setSummary] = useState<BankTransactionsSummary>({
    total: 0,
    matched: 0,
    underpaid: 0,
    unmatched: 0,
    duplicate: 0,
    totalMatchedAmount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Assign Modal state
  const [assignTx, setAssignTx] = useState<BankTransaction | null>(null);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [selectedOrderCode, setSelectedOrderCode] = useState("");
  const [manualOrderCodeInput, setManualOrderCodeInput] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);

  // Raw payload modal state
  const [payloadTx, setPayloadTx] = useState<BankTransaction | null>(null);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchTransactions = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const params = new URLSearchParams();
        if (statusFilter !== "ALL") params.append("status", statusFilter);
        if (searchQuery.trim()) params.append("search", searchQuery.trim());
        params.append("limit", "150");

        const res = await fetch(`/api/admin/bank-transactions?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (data.success) {
          setTransactions(Array.isArray(data.data) ? data.data : []);
          if (data.summary) setSummary(data.summary);
        }
      } catch (err) {
        console.error("Lỗi tải bank_transactions:", err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [statusFilter, searchQuery]
  );

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchTransactions(true);
    }, 6000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchTransactions]);

  const openAssignModal = async (tx: BankTransaction) => {
    setAssignTx(tx);
    setSelectedOrderCode("");
    setManualOrderCodeInput("");
    setLoadingOrders(true);
    try {
      const res = await fetch("/api/orders?date=7DAYS", { cache: "no-store" });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        const unpaid = (data.data as Order[]).filter(
          (o) => o.status !== "CANCELLED" && isOrderPendingOrPartial(o.paymentStatus)
        );
        // Sắp xếp ưu tiên đơn có số tiền còn thiếu khớp đúng transferAmount lên đầu
        unpaid.sort((a, b) => {
          const aDue = getRemainingOrderAmount(a.totalAmount, a.paidAmount);
          const bDue = getRemainingOrderAmount(b.totalAmount, b.paidAmount);
          const aExact = aDue === tx.transferAmount ? 1 : 0;
          const bExact = bDue === tx.transferAmount ? 1 : 0;
          if (aExact !== bExact) return bExact - aExact;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        setPendingOrders(unpaid);
        // Auto-preselect nếu có đúng 1 đơn khớp chính xác số tiền
        const exactMatches = unpaid.filter(
          (o) => getRemainingOrderAmount(o.totalAmount, o.paidAmount) === tx.transferAmount
        );
        if (exactMatches.length === 1) {
          setSelectedOrderCode(exactMatches[0].orderCode);
        }
      }
    } catch (e) {
      console.error("Lỗi tải đơn chờ thanh toán:", e);
    } finally {
      setLoadingOrders(false);
    }
  };

  const handleConfirmAssign = async () => {
    if (!assignTx) return;
    const targetCode = (manualOrderCodeInput.trim() || selectedOrderCode).trim();
    if (!targetCode) {
      showToast("Vui lòng chọn một đơn hàng hoặc nhập mã đơn hàng cần gán.", "error");
      return;
    }

    setIsAssigning(true);
    try {
      const res = await fetch("/api/admin/bank-transactions/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankTransactionId: assignTx.id,
          orderCode: targetCode,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || "Đã gán giao dịch thành công!");
        setAssignTx(null);
        fetchTransactions(true);
      } else {
        showToast(data.message || "Không thể gán giao dịch vào đơn hàng.", "error");
      }
    } catch {
      showToast("Lỗi kết nối máy chủ khi gán giao dịch.", "error");
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-xl border text-sm font-bold flex items-center gap-2 ${
            toast.type === "success"
              ? "bg-emerald-50 text-emerald-900 border-emerald-300"
              : "bg-rose-50 text-rose-900 border-rose-300"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-white border border-coffee-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs text-stone-500 font-semibold">Tổng giao dịch payOS</div>
          <div className="text-2xl font-black text-coffee-950 mt-1">{summary.total}</div>
          <div className="text-[11px] text-stone-400 mt-0.5">Mới nhất lên đầu</div>
        </div>

        <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm">
          <div className="text-xs text-emerald-700 font-semibold">Khớp tự động (MATCHED)</div>
          <div className="text-2xl font-black text-emerald-600 mt-1">{summary.matched}</div>
          <div className="text-[11px] text-emerald-700/80 font-bold mt-0.5">
            {formatVND(summary.totalMatchedAmount)}
          </div>
        </div>

        <div className="bg-white border border-orange-200 rounded-2xl p-4 shadow-sm">
          <div className="text-xs text-orange-700 font-semibold">Chuyển thiếu (UNDERPAID)</div>
          <div className="text-2xl font-black text-orange-600 mt-1">{summary.underpaid}</div>
          <div className="text-[11px] text-stone-500 mt-0.5">Cần Thu ngân kiểm tra</div>
        </div>

        <div
          className={`rounded-2xl p-4 shadow-sm border ${
            summary.unmatched > 0
              ? "bg-rose-50/70 border-rose-300"
              : "bg-white border-coffee-100"
          }`}
        >
          <div className="text-xs text-rose-700 font-semibold">Chưa khớp (UNMATCHED)</div>
          <div className="text-2xl font-black text-rose-600 mt-1">{summary.unmatched}</div>
          <div className="text-[11px] text-rose-700/80 mt-0.5">
            {summary.unmatched > 0 ? "Bấm gán vào đơn chờ TT" : "Không có giao dịch treo"}
          </div>
        </div>

        <div className="bg-white border border-coffee-100 rounded-2xl p-4 shadow-sm col-span-2 lg:col-span-1">
          <div className="text-xs text-stone-600 font-semibold">Trùng lặp (DUPLICATE)</div>
          <div className="text-2xl font-black text-stone-700 mt-1">{summary.duplicate}</div>
          <div className="text-[11px] text-stone-400 mt-0.5">Đơn đã thanh toán trước</div>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="bg-white border border-coffee-100 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo mã giao dịch, nội dung CK, mã đơn (CF2611-...), mã tham chiếu..."
              className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-9 pr-8 py-2 text-sm text-coffee-950 placeholder-stone-400 focus:outline-none focus:border-caramel focus:bg-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl border transition-all ${
                autoRefresh
                  ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                  : "bg-stone-100 text-stone-600 border-stone-200"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  autoRefresh ? "bg-emerald-500 animate-pulse" : "bg-stone-400"
                }`}
              />
              <span>{autoRefresh ? "Realtime (6s)" : "Tạm dừng"}</span>
            </button>

            <button
              type="button"
              onClick={() => fetchTransactions()}
              className="flex items-center gap-1.5 text-xs font-bold bg-stone-50 hover:bg-stone-100 border border-stone-200 text-stone-700 px-3 py-2 rounded-xl transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-caramel" : ""}`} />
              <span>Làm mới</span>
            </button>
          </div>
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-stone-100">
          {[
            { id: "ALL", label: `Tất cả (${summary.total})` },
            { id: "MATCHED", label: `Khớp đơn • MATCHED (${summary.matched})` },
            { id: "UNDERPAID", label: `Chuyển thiếu • UNDERPAID (${summary.underpaid})` },
            { id: "UNMATCHED", label: `Chưa khớp • UNMATCHED (${summary.unmatched})` },
            { id: "DUPLICATE", label: `Trùng lặp • DUPLICATE (${summary.duplicate})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                statusFilter === tab.id
                  ? "bg-caramel text-white shadow ring-2 ring-caramel/30"
                  : "text-stone-600 hover:text-coffee-950 bg-stone-100 hover:bg-stone-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TRANSACTIONS TABLE */}
      <div className="bg-white border border-coffee-100 rounded-3xl shadow-sm overflow-hidden">
        {loading && transactions.length === 0 ? (
          <div className="py-16 text-center text-stone-500 space-y-2">
            <RefreshCw className="w-7 h-7 animate-spin text-caramel mx-auto" />
            <p className="text-xs font-semibold">Đang tải lịch sử biến động số dư...</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-16 text-center text-stone-500 space-y-2 px-4">
            <Landmark className="w-10 h-10 text-stone-300 mx-auto" />
            <p className="text-sm font-bold text-coffee-900">Chưa có giao dịch ngân hàng nào</p>
            <p className="text-xs text-stone-500 max-w-md mx-auto">
              Khi payOS gửi webhook về <code className="font-mono">/api/webhooks/payos</code>, toàn bộ giao dịch tiền vào sẽ xuất hiện tại đây theo thời gian thực.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-600 font-bold uppercase text-[11px]">
                  <th className="py-3 px-4">Thời gian / Mã giao dịch</th>
                  <th className="py-3 px-4">Ngân hàng &amp; Mã TC</th>
                  <th className="py-3 px-4 text-right">Số tiền vào</th>
                  <th className="py-3 px-4">Nội dung chuyển khoản</th>
                  <th className="py-3 px-4">Đơn hàng khớp</th>
                  <th className="py-3 px-4">Trạng thái</th>
                  <th className="py-3 px-4 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {transactions.map((tx) => {
                  const cfg = TX_STATUS_CONFIG[tx.status] || TX_STATUS_CONFIG.UNMATCHED;
                  return (
                    <tr key={tx.id} className="hover:bg-amber-50/30 transition-colors">
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-bold text-coffee-950 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-stone-400" />
                          <span>{tx.transactionDate || new Date(tx.createdAt).toLocaleString("vi-VN")}</span>
                        </div>
                        <div className="text-[11px] font-mono text-stone-500 mt-0.5">
                          GD #{tx.sepayId}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-bold text-coffee-900">{tx.gateway || "Sacombank"}</div>
                        {tx.referenceCode && (
                          <div className="text-[11px] font-mono text-stone-500 mt-0.5">
                            Ref: {tx.referenceCode}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap text-right">
                        <span className="inline-flex items-center gap-1 font-mono font-black text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                          <ArrowDownLeft className="w-3.5 h-3.5" />
                          +{formatVND(tx.transferAmount)}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-mono text-[11px] text-coffee-900 break-words bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5">
                          {tx.content || "(Không có nội dung)"}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {tx.matchedOrderCode ? (
                          <span className="font-mono font-black text-coffee-950 bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-lg">
                            #{tx.matchedOrderCode}
                          </span>
                        ) : (
                          <span className="text-stone-400 italic flex items-center gap-1">
                            <HelpCircle className="w-3.5 h-3.5" />
                            <span>Chưa gán đơn</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full border text-[11px] font-extrabold ${cfg.bg} ${cfg.text} ${cfg.border}`}
                        >
                          {cfg.label}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {tx.status === "UNMATCHED" && (
                            <button
                              type="button"
                              onClick={() => openAssignModal(tx)}
                              className="inline-flex items-center gap-1 bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-xl shadow-sm transition-all active:scale-95"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                              <span>Gán vào đơn</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setPayloadTx(tx)}
                            className="inline-flex items-center gap-1 bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 font-bold text-[11px] px-2.5 py-1.5 rounded-xl transition-all"
                            title="Xem rawPayload JSON từ payOS"
                          >
                            <Code2 className="w-3.5 h-3.5" />
                            <span>JSON</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: GÁN NHANH GIAO DỊCH UNMATCHED VÀO ĐƠN HÀNG ĐANG CHỜ THANH TOÁN */}
      {assignTx && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !isAssigning && setAssignTx(null)}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl border border-stone-200 flex flex-col max-h-[88vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-coffee-950 via-coffee-900 to-coffee-800 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold">
                <Link2 className="w-5 h-5 text-amber-300" />
                <span>Gán giao dịch payOS #{assignTx.sepayId} vào đơn hàng</span>
              </div>
              <button
                type="button"
                disabled={isAssigning}
                onClick={() => setAssignTx(null)}
                className="text-stone-300 hover:text-white p-1 rounded-lg hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {/* Transaction summary */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900">Số tiền giao dịch nhận được:</span>
                  <span className="text-base font-black font-mono text-emerald-700">
                    +{formatVND(assignTx.transferAmount)}
                  </span>
                </div>
                <div className="text-emerald-900/90">
                  <strong>Nội dung CK:</strong>{" "}
                  <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-emerald-200">
                    {assignTx.content}
                  </span>
                </div>
                <div className="text-[11px] text-emerald-800">
                  {assignTx.gateway} • {assignTx.transactionDate}
                  {assignTx.referenceCode ? ` • Ref: ${assignTx.referenceCode}` : ""}
                </div>
              </div>

              {/* Manual order code input */}
              <div className="space-y-1">
                <label className="font-bold text-coffee-900 block">
                  Chọn nhanh từ đơn đang chờ thanh toán (7 ngày qua) hoặc nhập mã đơn:
                </label>
                <input
                  type="text"
                  value={manualOrderCodeInput}
                  onChange={(e) => {
                    setManualOrderCodeInput(e.target.value.toUpperCase());
                    if (e.target.value.trim()) setSelectedOrderCode("");
                  }}
                  placeholder="Nhập mã đơn thủ công (VD: CF2611-003) nếu không nằm trong danh sách dưới..."
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 font-mono font-bold text-coffee-950 focus:outline-none focus:border-caramel focus:bg-white"
                />
              </div>

              {/* Pending orders list */}
              <div className="space-y-2">
                {loadingOrders ? (
                  <div className="py-8 text-center text-stone-500">
                    <RefreshCw className="w-5 h-5 animate-spin text-caramel mx-auto mb-1" />
                    Đang tải danh sách đơn chờ thanh toán...
                  </div>
                ) : pendingOrders.length === 0 ? (
                  <div className="py-6 text-center text-stone-500 bg-stone-50 rounded-2xl border border-stone-200">
                    Không có đơn hàng nào đang chờ thanh toán trong 7 ngày qua. Bạn có thể nhập mã đơn trực tiếp ở ô trên.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {pendingOrders.map((o) => {
                      const remainingDue = getRemainingOrderAmount(o.totalAmount, o.paidAmount);
                      const isExactMatch = remainingDue === assignTx.transferAmount;
                      const isSelected = selectedOrderCode === o.orderCode && !manualOrderCodeInput.trim();
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => {
                            setSelectedOrderCode(o.orderCode);
                            setManualOrderCodeInput("");
                          }}
                          className={`w-full text-left p-3 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 ${
                            isSelected
                              ? "bg-amber-50 border-caramel shadow-sm"
                              : isExactMatch
                              ? "bg-emerald-50/40 border-emerald-300 hover:border-emerald-500"
                              : "bg-white border-stone-200 hover:border-coffee-300"
                          }`}
                        >
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono font-black text-sm text-coffee-950">
                                #{o.orderCode}
                              </span>
                              {isExactMatch && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded-full">
                                  <Sparkles className="w-3 h-3" />
                                  Khớp đúng số tiền
                                </span>
                              )}
                              {o.paymentStatus === "PARTIAL" && (
                                <span className="text-[10px] font-bold bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded-full">
                                  Đang thiếu
                                </span>
                              )}
                            </div>
                            <div className="text-stone-600 truncate">
                              {o.recipientName} • {o.recipientPhone}
                            </div>
                            <div className="text-[11px] text-stone-400">
                              Đặt lúc{" "}
                              {new Date(o.createdAt).toLocaleString("vi-VN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                day: "2-digit",
                                month: "2-digit",
                              })}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="font-black text-sm text-caramel">
                              {formatVND(remainingDue)}
                            </div>
                            <div className="text-[10px] text-stone-500">
                              {o.paymentStatus === "PARTIAL"
                                ? `Đã nhận ${formatVND(o.paidAmount || 0)}`
                                : "Cần thanh toán"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-stone-50 border-t border-stone-200 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isAssigning}
                onClick={() => setAssignTx(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-stone-600 hover:text-stone-900"
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={isAssigning || (!selectedOrderCode && !manualOrderCodeInput.trim())}
                onClick={handleConfirmAssign}
                className="px-5 py-2 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white shadow disabled:opacity-50 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isAssigning ? "Đang gán..." : "Xác nhận gán & Đối soát"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: XEM RAW PAYLOAD JSON */}
      {payloadTx && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPayloadTx(null)}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-stone-200 flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-stone-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Code2 className="w-4 h-4 text-amber-300" />
                <span>Raw Payload payOS #{payloadTx.sepayId}</span>
              </div>
              <button
                type="button"
                onClick={() => setPayloadTx(null)}
                className="text-stone-300 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-auto bg-stone-950 text-emerald-300 font-mono text-xs flex-1">
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(payloadTx.rawPayload ?? {}, null, 2)}
              </pre>
            </div>
            <div className="p-3 bg-stone-50 border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => setPayloadTx(null)}
                className="px-4 py-1.5 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-800 text-xs font-bold"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
