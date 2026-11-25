"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  Send,
} from "lucide-react";

interface PayOsConfigState {
  clientId: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  hasChecksumKey: boolean;
  checksumKeyMasked: string;
  webhookUrl: string;
  isConfigured: boolean;
}

export default function PayOsConfigManager({ currentUser }: { currentUser?: any }) {
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";

  const [config, setConfig] = useState<PayOsConfigState | null>(null);
  const [loading, setLoading] = useState(true);

  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [checksumKey, setChecksumKey] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");

  const [showApiKey, setShowApiKey] = useState(false);
  const [showChecksumKey, setShowChecksumKey] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingWebhook, setIsConfirmingWebhook] = useState(false);
  const [isTestingSignature, setIsTestingSignature] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const defaultWebhookEndpoint = useMemo(() => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/webhooks/payos`;
    }
    return "/api/webhooks/payos";
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/payos-config", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.data) {
        const d: PayOsConfigState = data.data;
        setConfig(d);
        setClientId(d.clientId || "");
        setWebhookUrl(d.webhookUrl || defaultWebhookEndpoint);
      }
    } catch (err) {
      console.error("Lỗi tải cấu hình payOS:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopyWebhook = () => {
    const val = (webhookUrl || defaultWebhookEndpoint).trim();
    navigator.clipboard.writeText(val);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setIsSaving(true);
    try {
      const res = await fetch("/api/admin/payos-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId.trim(),
          apiKey: apiKey.trim(),
          checksumKey: checksumKey.trim(),
          webhookUrl: webhookUrl.trim() || defaultWebhookEndpoint,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(data.data);
        setApiKey("");
        setChecksumKey("");
        setNotice({ type: "success", text: data.message || "Đã lưu cấu hình payOS thành công!" });
      } else {
        setNotice({ type: "error", text: data.message || "Không thể lưu cấu hình payOS." });
      }
    } catch {
      setNotice({ type: "error", text: "Lỗi kết nối máy chủ khi lưu cấu hình payOS." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmWebhook = async () => {
    setNotice(null);
    setIsConfirmingWebhook(true);
    try {
      const res = await fetch("/api/admin/payos-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CONFIRM_WEBHOOK",
          webhookUrl: webhookUrl.trim() || defaultWebhookEndpoint,
        }),
      });
      const data = await res.json();
      setNotice({
        type: data.success ? "success" : "error",
        text: data.message || (data.success ? "Xác thực Webhook thành công!" : "Xác thực Webhook thất bại."),
      });
    } catch {
      setNotice({ type: "error", text: "Lỗi kết nối khi gọi xác thực Webhook payOS." });
    } finally {
      setIsConfirmingWebhook(false);
    }
  };

  const handleTestSignature = async () => {
    setNotice(null);
    setIsTestingSignature(true);
    try {
      const res = await fetch("/api/admin/payos-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "TEST_SIGNATURE" }),
      });
      const data = await res.json();
      setNotice({
        type: data.success ? "success" : "error",
        text: data.message || "Hoàn tất kiểm tra chữ ký.",
      });
    } catch {
      setNotice({ type: "error", text: "Lỗi kết nối khi kiểm tra chữ ký payOS." });
    } finally {
      setIsTestingSignature(false);
    }
  };

  return (
    <div className="bg-white border border-coffee-100 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-stone-100 pb-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center shrink-0">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-black text-coffee-950">
                Cấu hình Cổng Thanh Toán &amp; Webhook payOS
              </h2>
              {loading ? (
                <span className="text-[11px] font-bold bg-stone-100 text-stone-500 px-2.5 py-0.5 rounded-full">
                  Đang tải...
                </span>
              ) : config?.isConfigured ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Đã kích hoạt payOS
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200 px-2.5 py-0.5 rounded-full">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Chưa cấu hình khóa payOS
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500 mt-1">
              Tự động tạo mã VietQR động qua payOS cho từng đơn hàng và tự động xác nhận{" "}
              <strong>ĐÃ THANH TOÁN</strong> ngay khi khách chuyển khoản thành công.
            </p>
          </div>
        </div>

        <a
          href="https://my.payos.vn"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3.5 py-2 rounded-xl transition-colors shrink-0 self-start"
        >
          <span>Mở trang quản trị my.payos.vn</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Notice Banner */}
      {notice && (
        <div
          className={`rounded-2xl p-3.5 text-xs font-bold border flex items-start gap-2 ${
            notice.type === "success"
              ? "bg-emerald-50 text-emerald-900 border-emerald-200"
              : "bg-rose-50 text-rose-900 border-rose-200"
          }`}
        >
          {notice.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Main Grid: Form + Quick Guide */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleSave} className="lg:col-span-7 space-y-4">
          {/* Client ID */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-coffee-900 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
              <span>Client ID (PAYOS_CLIENT_ID)</span>
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={!isSuperAdmin || isSaving}
              placeholder="Ví dụ: a1b2c3d4-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs font-mono text-coffee-950 focus:outline-none focus:border-indigo-500 focus:bg-white disabled:opacity-60"
            />
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-coffee-900 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                <span>API Key (PAYOS_API_KEY)</span>
              </label>
              {config?.hasApiKey && (
                <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                  Đang lưu: {config.apiKeyMasked}
                </span>
              )}
            </div>
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!isSuperAdmin || isSaving}
                placeholder={
                  config?.hasApiKey
                    ? "Để trống nếu giữ nguyên API Key hiện tại..."
                    : "Nhập API Key từ my.payos.vn..."
                }
                className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-3.5 pr-10 py-2.5 text-xs font-mono text-coffee-950 focus:outline-none focus:border-indigo-500 focus:bg-white disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Checksum Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-coffee-900 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                <span>Checksum Key (PAYOS_CHECKSUM_KEY)</span>
              </label>
              {config?.hasChecksumKey && (
                <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                  Đang lưu: {config.checksumKeyMasked}
                </span>
              )}
            </div>
            <div className="relative">
              <input
                type={showChecksumKey ? "text" : "password"}
                value={checksumKey}
                onChange={(e) => setChecksumKey(e.target.value)}
                disabled={!isSuperAdmin || isSaving}
                placeholder={
                  config?.hasChecksumKey
                    ? "Để trống nếu giữ nguyên Checksum Key hiện tại..."
                    : "Nhập Checksum Key dùng xác thực chữ ký HMAC-SHA256..."
                }
                className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-3.5 pr-10 py-2.5 text-xs font-mono text-coffee-950 focus:outline-none focus:border-indigo-500 focus:bg-white disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowChecksumKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
              >
                {showChecksumKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Webhook URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-coffee-900 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>Webhook URL nhận thông báo (PAYOS_WEBHOOK_URL)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                disabled={!isSuperAdmin || isSaving}
                placeholder="https://ten-mien-cua-ban.com/api/webhooks/payos"
                className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs font-mono text-coffee-950 focus:outline-none focus:border-indigo-500 focus:bg-white disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleCopyWebhook}
                className="inline-flex items-center gap-1.5 text-xs font-bold bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-700 px-3 py-2 rounded-xl shrink-0"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUrl ? "Đã chép" : "Chép"}</span>
              </button>
            </div>
            <p className="text-[11px] text-stone-500">
              Khi chạy thật (production) hoặc test qua Cloudflare Tunnel / ngrok, điền URL{" "}
              <code className="font-mono bg-stone-100 px-1 rounded">https://.../api/webhooks/payos</code> rồi bấm nút xác thực bên dưới.
            </p>
          </div>

          {/* Action Buttons */}
          {isSuperAdmin ? (
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold px-4 py-2.5 rounded-xl shadow-sm transition-all disabled:opacity-50"
              >
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{isSaving ? "Đang lưu..." : "Lưu cấu hình payOS"}</span>
              </button>

              <button
                type="button"
                onClick={handleConfirmWebhook}
                disabled={isConfirmingWebhook || !config?.isConfigured}
                className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-sm transition-all disabled:opacity-50"
                title="Gọi API /confirm-webhook của payOS để đăng ký & xác thực URL"
              >
                {isConfirmingWebhook ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>{isConfirmingWebhook ? "Đang xác thực..." : "Đăng ký & Xác thực Webhook với payOS"}</span>
              </button>

              <button
                type="button"
                onClick={handleTestSignature}
                disabled={isTestingSignature || !config?.isConfigured}
                className="inline-flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-800 text-xs font-bold px-3.5 py-2.5 rounded-xl transition-all disabled:opacity-50"
              >
                {isTestingSignature ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                )}
                <span>Test chữ ký cục bộ</span>
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-semibold">
              Chỉ tài khoản <strong>Chủ Quán (SUPER_ADMIN)</strong> mới có quyền chỉnh sửa khóa bí mật payOS.
            </p>
          )}
        </form>

        {/* Quick Setup Guide */}
        <div className="lg:col-span-5 bg-gradient-to-br from-indigo-50/70 to-amber-50/40 border border-indigo-100 rounded-2xl p-4 sm:p-5 space-y-3 text-xs text-coffee-900">
          <h3 className="font-black text-sm text-indigo-950 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <span>Hướng dẫn kết nối payOS trong 3 bước</span>
          </h3>
          <ol className="list-decimal list-inside space-y-2 leading-relaxed text-stone-700">
            <li>
              Đăng nhập{" "}
              <a
                href="https://my.payos.vn"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-indigo-700 underline"
              >
                my.payos.vn
              </a>{" "}
              → tạo <strong>Kênh thanh toán</strong> liên kết với tài khoản ngân hàng của quán.
            </li>
            <li>
              Sao chép 3 thông số <strong>Client ID</strong>, <strong>API Key</strong>,{" "}
              <strong>Checksum Key</strong> dán vào form bên trái rồi bấm{" "}
              <strong>Lưu cấu hình payOS</strong>.
            </li>
            <li>
              Điền <strong>Webhook URL</strong> dạng HTTPS công khai (
              <code className="font-mono bg-white px-1 rounded border border-indigo-100">
                https://domain-cua-ban/api/webhooks/payos
              </code>
              ) rồi bấm <strong>Đăng ký &amp; Xác thực Webhook với payOS</strong> (hoặc dán trực tiếp trên trang cấu hình kênh payOS).
            </li>
          </ol>

          <div className="bg-white/90 border border-indigo-100 rounded-xl p-3 space-y-1 text-[11px] text-stone-600">
            <div className="font-bold text-coffee-950">Cơ chế hoạt động tự động:</div>
            <p>
              • Khi khách đặt đơn chuyển khoản, trang theo dõi đơn tự động tạo mã QR động từ payOS (nếu chưa cấu hình payOS sẽ tự fallback về VietQR thường).
            </p>
            <p>
              • Khi khách quét mã thanh toán thành công, payOS gọi{" "}
              <code className="font-mono">/api/webhooks/payos</code> → hệ thống verify chữ ký{" "}
              <code className="font-mono">HMAC-SHA256</code> → tự động chuyển đơn sang{" "}
              <strong>PAID + CONFIRMED</strong> và ghi log đối soát ngay bảng bên dưới.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
