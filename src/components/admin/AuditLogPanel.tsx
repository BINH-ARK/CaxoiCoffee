"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, RefreshCw, Clock, Filter } from "lucide-react";
import { AuditLogEntry } from "@/types";

const ACTION_FILTERS = [
  { key: "ALL", label: "Tất cả" },
  { key: "AUTH_", label: "Đăng nhập / Xuất" },
  { key: "ORDER_", label: "Đơn hàng / Thanh toán" },
  { key: "WEBHOOK_", label: "Webhook Ngân hàng" },
  { key: "MENU_", label: "Thực đơn & Giá" },
  { key: "STAFF_", label: "Nhân sự" },
  { key: "RBAC_", label: "Phân quyền" },
  { key: "SETTINGS_", label: "Cài đặt quán" },
  { key: "DB_", label: "CSDL / Backup" },
];

function getActionBadgeStyle(action: string): string {
  if (action.includes("FAILED") || action.includes("DELETED") || action.includes("CANCELLED") || action.includes("RESEED")) {
    return "bg-red-50 text-red-700 border-red-200";
  }
  if (action.startsWith("WEBHOOK_") || action.includes("PAYMENT")) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (action.startsWith("AUTH_")) {
    return "bg-blue-50 text-blue-700 border-blue-200";
  }
  if (action.startsWith("RBAC_") || action.startsWith("STAFF_")) {
    return "bg-purple-50 text-purple-700 border-purple-200";
  }
  if (action.startsWith("DB_")) {
    return "bg-amber-50 text-amber-800 border-amber-200";
  }
  return "bg-coffee-50 text-coffee-800 border-coffee-200";
}

export default function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [filterAction, setFilterAction] = useState("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const fetchLogs = async (actionFilter = filterAction) => {
    setIsLoading(true);
    setErrorMsg("");
    try {
      const qs = new URLSearchParams({ limit: "80" });
      if (actionFilter !== "ALL") qs.set("action", actionFilter);
      const res = await fetch(`/api/admin/audit-logs?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.success) {
        setLogs(data.data || []);
      } else {
        setErrorMsg(data.message || "Không thể tải nhật ký kiểm toán.");
      }
    } catch {
      setErrorMsg("Lỗi kết nối khi tải nhật ký kiểm toán.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(filterAction);
  }, [filterAction]);

  return (
    <div className="bg-white rounded-3xl p-5 border border-coffee-100 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-coffee-100 pb-3">
        <div>
          <h3 className="text-base font-bold text-coffee-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <span>Nhật Ký Kiểm Toán &amp; Truy Vết Bảo Mật (Audit Log)</span>
          </h3>
          <p className="text-xs text-coffee-500 mt-0.5">
            Ghi nhận tự động mọi thao tác đăng nhập, xác nhận thanh toán, đổi phí ship, chỉnh sửa giá món, phân quyền &amp; sao lưu CSDL.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchLogs(filterAction)}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-coffee-50 hover:bg-coffee-100 text-coffee-800 border border-coffee-200 text-xs font-bold transition-colors shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Làm mới</span>
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-coffee-500 mr-1">
          <Filter className="w-3.5 h-3.5" /> Lọc:
        </span>
        {ACTION_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilterAction(f.key)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
              filterAction === f.key
                ? "bg-coffee-800 text-white border-coffee-800 shadow-xs"
                : "bg-white text-coffee-600 border-coffee-200 hover:bg-coffee-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
          {errorMsg}
        </div>
      )}

      {isLoading ? (
        <div className="py-10 text-center text-xs text-coffee-500 flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-caramel" />
          <span>Đang tải nhật ký kiểm toán...</span>
        </div>
      ) : logs.length === 0 ? (
        <div className="py-10 text-center text-xs text-coffee-400">
          Chưa có bản ghi nhật ký kiểm toán nào trong mục lọc này.
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-2xl border border-coffee-100">
          <table className="w-full text-left text-xs text-coffee-800">
            <thead className="bg-coffee-50 text-coffee-600 font-bold uppercase tracking-wider text-[10px] sticky top-0 z-10">
              <tr>
                <th className="py-2.5 px-3">Thời gian</th>
                <th className="py-2.5 px-3">Người thực hiện</th>
                <th className="py-2.5 px-3">Hành động</th>
                <th className="py-2.5 px-3">Chi tiết thay đổi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-coffee-100">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-coffee-50/40 transition-colors">
                  <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px] text-coffee-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3 text-coffee-400" />
                      {log.createdAt}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="font-bold text-coffee-900 font-mono">@{log.actorUsername}</span>
                    <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200">
                      {log.actorRole}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      className={`inline-block font-mono font-bold text-[10px] px-2 py-0.5 rounded-md border ${getActionBadgeStyle(
                        log.action
                      )}`}
                    >
                      {log.action}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-coffee-800 min-w-[260px]">
                    <span>{log.summary}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
