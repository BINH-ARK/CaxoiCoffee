"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Coffee,
  Truck,
  Building,
  Copy,
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  XCircle,
  AlertTriangle,
  MessageSquare,
  X,
} from "lucide-react";
import { Order, OrderStatus, BusinessSettings } from "@/types";
import { formatVND, generateVietQrUrl, getTelHref } from "@/lib/utils";
import { isOrderPaidStatus } from "@/lib/paymentStatus";
import { getBankById } from "@/lib/vietqr";
import PaymentThankYouModal from "@/components/PaymentThankYouModal";
import OrderCancelledModal from "@/components/OrderCancelledModal";

const STATUS_STEPS: { key: OrderStatus; label: string; desc: string }[] = [
  { key: "PENDING_PAYMENT", label: "Chờ thanh toán", desc: "Đang chờ chuyển khoản" },
  { key: "CONFIRMED", label: "Đã xác nhận", desc: "Đơn đã vào quầy bar" },
  { key: "BREWING", label: "Đang pha chế", desc: "Barista đang chuẩn bị" },
  { key: "READY", label: "Đã sẵn sàng", desc: "Đã đóng gói cẩn thận" },
  { key: "DELIVERING", label: "Đang giao hàng", desc: "Đang đến văn phòng" },
  { key: "COMPLETED", label: "Hoàn tất", desc: "Thưởng thức cà phê!" },
];

const CANCEL_REASON_SUGGESTIONS = [
  "Đặt nhầm món / số lượng",
  "Muốn đổi địa chỉ hoặc giờ giao",
  "Thay đổi ý định, không còn nhu cầu",
  "Thời gian giao chưa phù hợp",
];

export default function OrderTrackingPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const [order, setOrder] = useState<Order | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [trackingToken, setTrackingToken] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelSuccessNotice, setCancelSuccessNotice] = useState<string | null>(null);
  const [showCancelledModal, setShowCancelledModal] = useState(false);
  const [showThankYouModal, setShowThankYouModal] = useState(false);
  const [payosPayment, setPayosPayment] = useState<{
    bin?: string;
    checkoutUrl?: string;
    qrImageUrl?: string | null;
    accountNumber?: string;
    accountName?: string;
    description?: string;
  } | null>(null);
  const [isCheckingPayment, setIsCheckingPayment] = useState(false);
  const [paymentCheckMsg, setPaymentCheckMsg] = useState<{
    type: "success" | "info" | "error";
    text: string;
  } | null>(null);
  const payosRequestedForRef = useRef<string | null>(null);
  const prevPaymentStatusRef = useRef<string | null>(null);

  // Đọc trackingToken từ URL (?token=...) hoặc sessionStorage khi khách vừa đặt xong
  useEffect(() => {
    try {
      const urlParams =
        typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const urlToken = urlParams?.get("token") || "";
      const storedToken = sessionStorage.getItem(`order_token_${id}`) || "";
      const resolved = urlToken || storedToken;
      if (resolved) {
        setTrackingToken(resolved);
        sessionStorage.setItem(`order_token_${id}`, resolved);
      }
      // Xóa ?token=... khỏi thanh địa chỉ trình duyệt để tránh lộ trong lịch sử/Referer
      if (urlToken && typeof window !== "undefined") {
        urlParams?.delete("token");
        const remaining = urlParams?.toString();
        const cleanUrl = remaining ? `${window.location.pathname}?${remaining}` : window.location.pathname;
        window.history.replaceState({}, "", cleanUrl);
      }
    } catch {}
  }, [id]);

  // Poll order status every 4 seconds; tự động dừng khi COMPLETED hoặc CANCELLED
  useEffect(() => {
    let isMounted = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const getAuthHeaders = (): Record<string, string> => {
      const headers: Record<string, string> = {};
      try {
        const token = trackingToken || sessionStorage.getItem(`order_token_${id}`) || "";
        const savedPhone = localStorage.getItem("caxoi_customer_phone") || "";
        if (token) headers["x-order-token"] = token;
        else if (savedPhone) headers["x-order-phone"] = savedPhone;
      } catch {}
      return headers;
    };

    const fetchOrder = () => {
      fetch(`/api/orders/${encodeURIComponent(id)}`, {
        cache: "no-store",
        headers: getAuthHeaders(),
      })
        .then((res) => res.json())
        .then((data) => {
          if (isMounted && data.success) {
            const incomingOrder: Order = data.data;
            const prevPay = prevPaymentStatusRef.current;
            prevPaymentStatusRef.current = incomingOrder.paymentStatus;

            // Kích hoạt hiệu ứng "Xòi xin cảm ơn!" khi đơn chuyển sang PAID (hoặc lần đầu mở đơn đã PAID)
            if (isOrderPaidStatus(incomingOrder.paymentStatus) && incomingOrder.status !== "CANCELLED") {
              try {
                const thankedKey = `caxoi_thanked_${incomingOrder.id}`;
                const alreadyThanked = sessionStorage.getItem(thankedKey) === "1";
                const transitionedToPaid = prevPay !== null && !isOrderPaidStatus(prevPay);
                if (transitionedToPaid || !alreadyThanked) {
                  sessionStorage.setItem(thankedKey, "1");
                  setShowThankYouModal(true);
                }
              } catch {
                if (prevPay !== null && !isOrderPaidStatus(prevPay)) {
                  setShowThankYouModal(true);
                }
              }
            }

            setOrder(incomingOrder);
            if (data.settings) {
              setSettings(data.settings);
            }
            if (
              (incomingOrder?.status === "COMPLETED" || incomingOrder?.status === "CANCELLED") &&
              intervalId
            ) {
              clearInterval(intervalId);
              intervalId = null;
            }
          }
        })
        .catch((e) => console.error("Poll order failed", e))
        .finally(() => {
          if (isMounted) setIsLoading(false);
        });
    };

    fetchOrder();
    intervalId = setInterval(fetchOrder, 4000);
    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [id, trackingToken]);

  // Tự động lấy mã QR động & link thanh toán payOS khi đơn đang chờ thanh toán
  useEffect(() => {
    if (!order || order.status !== "PENDING_PAYMENT" || isOrderPaidStatus(order.paymentStatus)) {
      return;
    }
    if (payosRequestedForRef.current === order.id) return;
    payosRequestedForRef.current = order.id;

    fetch("/api/payments/payos/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data?.data) {
          setPayosPayment({
            bin: data.data.bin,
            checkoutUrl: data.data.checkoutUrl,
            qrImageUrl: data.data.qrImageUrl,
            accountNumber: data.data.accountNumber,
            accountName: data.data.accountName,
            description: data.data.description,
          });
        }
      })
      .catch(() => {});

    if (typeof window !== "undefined" && window.location.search.includes("payos=success")) {
      fetch("/api/payments/payos/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.paid && data?.data) {
            setOrder((prev) =>
              prev
                ? {
                    ...prev,
                    paymentStatus: data.data.paymentStatus,
                    status: data.data.status,
                    paidAmount: data.data.paidAmount,
                  }
                : null
            );
          }
        })
        .catch(() => {});
    }
  }, [order]);

  const handleManualCheckPayment = async () => {
    if (!order || isCheckingPayment) return;
    setIsCheckingPayment(true);
    setPaymentCheckMsg(null);
    try {
      const res = await fetch("/api/payments/payos/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await res.json();
      if (data?.success && data?.paid && data?.data) {
        setOrder((prev) =>
          prev
            ? {
                ...prev,
                paymentStatus: data.data.paymentStatus,
                status: data.data.status,
                paidAmount: data.data.paidAmount,
              }
            : null
        );
        setShowThankYouModal(true);
        setPaymentCheckMsg({
          type: "success",
          text: data.message || "Đã xác nhận thanh toán thành công!",
        });
      } else {
        setPaymentCheckMsg({
          type: data?.success ? "info" : "error",
          text: data?.message || "Chưa ghi nhận giao dịch mới từ payOS.",
        });
      }
    } catch {
      setPaymentCheckMsg({
        type: "error",
        text: "Không thể kết nối máy chủ để kiểm tra thanh toán.",
      });
    } finally {
      setIsCheckingPayment(false);
    }
  };

  const handleCopyContent = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCancelOrder = async () => {
    if (!order) return;
    const trimmedReason = cancelReason.trim();
    if (!trimmedReason) {
      setCancelError("Vui lòng nhập hoặc chọn lý do bạn muốn hủy đơn hàng.");
      return;
    }

    setIsCancelling(true);
    setCancelError("");
    try {
      const qs = new URLSearchParams({ reason: trimmedReason });
      const headers: Record<string, string> = {};
      const token = trackingToken || sessionStorage.getItem(`order_token_${order.orderCode}`) || "";
      const savedPhone = localStorage.getItem("caxoi_customer_phone") || "";
      if (token) headers["x-order-token"] = token;
      else if (savedPhone) headers["x-order-phone"] = savedPhone;

      const res = await fetch(`/api/orders/${encodeURIComponent(order.orderCode)}?${qs.toString()}`, {
        method: "DELETE",
        headers,
      });
      const data = await res.json();
      if (data.success) {
        setOrder((prev) =>
          prev ? { ...prev, status: "CANCELLED", trackingNotes: trimmedReason } : null
        );
        setShowCancelModal(false);
        setCancelReason("");
        setCancelSuccessNotice(trimmedReason);
        setShowCancelledModal(true);
      } else {
        setCancelError(data.message || "Không thể hủy đơn hàng lúc này");
      }
    } catch {
      setCancelError("Lỗi kết nối khi hủy đơn hàng");
    } finally {
      setIsCancelling(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-3">
        <RefreshCw className="w-8 h-8 text-caramel animate-spin mx-auto" />
        <p className="text-xs font-semibold text-coffee-600">Đang tải thông tin đơn hàng...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-base font-bold text-coffee-900">Không tìm thấy đơn hàng</h2>
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-coffee-800 text-white font-bold text-xs px-4 py-2 rounded-xl"
        >
          <ArrowLeft className="w-4 h-4" /> Quay lại Menu
        </Link>
      </div>
    );
  }

  // Calculate current progress index
  const statusOrderIndex = STATUS_STEPS.findIndex((s) => s.key === order.status);
  const isPaid = isOrderPaidStatus(order.paymentStatus);
  const isPendingPayment = order.status === "PENDING_PAYMENT" && !isPaid;
  const isCancelled = order.status === "CANCELLED";
  // Khi tiến trình chuẩn bị đồ uống đã chạy (đã thanh toán hoặc trạng thái không còn là PENDING_PAYMENT)
  // thì tuyệt đối KHÔNG hiển thị nút hủy đơn
  const isPreparationRunning = order.status !== "PENDING_PAYMENT" || isPaid;
  const canCancel = !isPreparationRunning && !isCancelled;

  const bankId = settings?.vietqrBankId || "MB";
  const accountNo = settings?.vietqrAccountNo || "999988886666";
  const accountName = settings?.vietqrAccountName || "CA XOI CAFE";
  const bankInfo = getBankById(payosPayment?.bin || bankId);

  // Generate VietQR dynamic URL (fallback nếu chưa cấu hình payOS)
  const vietQrUrl = generateVietQrUrl({
    bankId,
    accountNo,
    accountName,
    amount: order.totalAmount,
    description: order.orderCode,
  });

  const activeQrUrl = payosPayment?.qrImageUrl || vietQrUrl;
  const displayAccountNo = payosPayment?.accountNumber || accountNo;
  const displayAccountName = payosPayment?.accountName || accountName;
  const displayTransferDesc = payosPayment?.description || order.orderCode;

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-6">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-coffee-700 hover:text-caramel"
        >
          <ArrowLeft className="w-4 h-4" /> Về trang chủ
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-coffee-800 bg-amber-100 px-3 py-1 rounded-full">
            Mã đơn: #{order.orderCode}
          </span>
          {canCancel && (
            <button
              type="button"
              onClick={() => {
                setCancelError("");
                setShowCancelModal(true);
              }}
              className="text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1 rounded-full flex items-center gap-1 transition-all active:scale-95 shadow-sm"
              title="Hủy đơn hàng nếu không muốn đặt"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Hủy đơn</span>
            </button>
          )}
        </div>
      </div>

      {/* Post-Cancellation Success Notification Banner */}
      {cancelSuccessNotice && (
        <div
          role="status"
          aria-live="polite"
          className="bg-gradient-to-r from-red-50 via-amber-50 to-pink-50 border border-red-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3 animate-xoi-pop"
        >
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 shrink-0 animate-xoi-sway drop-shadow-sm">
              <Image
                src="/images/meo-xoi-real.png"
                alt="Mèo Xòi"
                fill
                sizes="48px"
                className="object-contain"
              />
            </div>
            <div className="space-y-0.5 text-xs">
              <p className="font-bold text-coffee-950">
                Đã hủy đơn hàng #{order.orderCode} thành công
              </p>
              <p className="text-coffee-700 leading-relaxed">
                Xòi đã ghi nhận lý do hủy của bạn: <strong>&ldquo;{cancelSuccessNotice}&rdquo;</strong>. Hẹn gặp lại bạn ở lần đặt tới nhé! 🐾
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCancelSuccessNotice(null)}
            aria-label="Đóng thông báo"
            className="text-coffee-400 hover:text-coffee-700 p-1 rounded-lg transition-colors shrink-0 self-start"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* CANCELLED STATE BANNER */}
      {isCancelled ? (
        <div className="bg-gradient-to-b from-red-50 via-white to-amber-50/40 border border-red-200 rounded-3xl p-6 text-center space-y-4 shadow-sm">
          <div className="relative w-24 h-24 mx-auto animate-xoi-sway drop-shadow-[0_8px_16px_rgba(185,28,28,0.18)]">
            <Image
              src="/images/meo-xoi-real.png"
              alt="Mèo Xòi tiếc nuối"
              fill
              sizes="96px"
              className="object-contain"
            />
          </div>
          <div className="space-y-2">
            <span className="text-xs font-bold px-3 py-1 bg-red-200 text-red-800 rounded-full">
              Đơn hàng đã được hủy
            </span>
            <h2 className="text-lg font-black text-coffee-950 pt-1">
              Đơn hàng #{order.orderCode} đã bị hủy
            </h2>
            {order.trackingNotes ? (
              <div className="max-w-md mx-auto bg-white/80 border border-red-200 rounded-2xl px-4 py-2.5 text-xs text-coffee-700">
                <span className="font-bold text-red-700">Lý do hủy đơn: </span>
                <span>{order.trackingNotes}</span>
              </div>
            ) : (
              <p className="text-xs text-coffee-600 max-w-md mx-auto leading-relaxed">
                Đơn hàng đã được hủy thành công theo yêu cầu của bạn. Quán sẽ không tiến hành pha chế hoặc giao đồ uống.
              </p>
            )}
          </div>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-coffee-800 hover:bg-coffee-900 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all active:scale-95"
            >
              <ArrowLeft className="w-4 h-4" /> Quay lại Thực đơn để đặt món khác
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* 1. PROGRESS BAR */}
          <div className="bg-white rounded-3xl p-5 border border-coffee-100 shadow-sm space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold text-coffee-900">Tiến trình chuẩn bị</h1>
                <p className="text-xs text-coffee-500 mt-0.5">
                  {order.scheduledType === "PREORDER"
                    ? `Hẹn giao lúc: ${order.scheduledTime}`
                    : isPendingPayment
                    ? "Vui lòng quét mã QR thanh toán để bắt đầu pha chế đồ uống"
                    : "Giao ngay khi Barista pha chế xong"}
                </p>
              </div>
              <div
                className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border ${
                  isPendingPayment
                    ? "bg-amber-100/90 text-amber-900 border-amber-300 shadow-sm"
                    : "bg-amber-50 text-coffee-800 border-amber-200"
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-caramel" />
                <span>
                  {order.status === "CONFIRMED" && "Quán đã nhận đơn"}
                  {order.status === "BREWING" && "Đang pha chế..."}
                  {order.status === "READY" && "Sẵn sàng giao / lấy"}
                  {order.status === "DELIVERING" && "Shipper đang giao"}
                  {order.status === "COMPLETED" && "Đã hoàn thành"}
                  {order.status === "PENDING_PAYMENT" && "Chờ thanh toán QR"}
                </span>
              </div>
            </div>

            {/* Waiting for payment warning banner */}
            {isPendingPayment && (
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
                <div className="w-8 h-8 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                  <Clock className="w-4 h-4 animate-spin text-amber-700" />
                </div>
                <div className="space-y-0.5 text-xs">
                  <h3 className="font-bold text-coffee-950 text-sm flex items-center gap-2">
                    <span>Tiến trình pha chế chưa bắt đầu</span>
                    <span className="text-[10px] bg-amber-200 text-amber-900 px-2 py-0.5 rounded font-black tracking-wide">
                      CHỜ THANH TOÁN
                    </span>
                  </h3>
                  <p className="text-coffee-700 text-[11px] sm:text-xs leading-relaxed pt-0.5">
                    Quý khách vui lòng <strong>quét mã VietQR bên dưới</strong> để hoàn tất thanh toán. Quán Cà Xòi sẽ tự động đối soát qua ngân hàng hoặc Thu ngân xác nhận ngay khi nhận được tiền!
                  </p>
                </div>
              </div>
            )}

            {/* Confirmed / paid success banner */}
            {isPaid && (
              <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-3 flex items-center gap-2.5 shadow-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-xs font-bold text-emerald-950">
                  Đã thanh toán thành công! Quầy Barista Cà Xòi đang chuẩn bị đồ uống cho bạn.
                </span>
              </div>
            )}

            {/* 5-step visual track (Only runs when payment completed) */}
            <div className="grid grid-cols-5 gap-2 relative">
              {STATUS_STEPS.slice(1, 6).map((step, idx) => {
                const stepNum = idx + 1;
                const currentStepNum = isPendingPayment ? 0 : statusOrderIndex >= 1 ? statusOrderIndex : 0;
                const isCompleted = currentStepNum >= stepNum;
                const isCurrent = currentStepNum === stepNum;

                return (
                  <div key={step.key} className="flex flex-col items-center text-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                        isCompleted
                          ? "bg-caramel text-white shadow-md ring-2 ring-caramel/20"
                          : isPendingPayment
                          ? "bg-stone-100 text-stone-300 border border-dashed border-stone-300"
                          : "bg-coffee-100 text-coffee-400"
                      } ${isCurrent ? "animate-bounce" : ""}`}
                    >
                      {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : stepNum}
                    </div>
                    <span
                      className={`text-[10px] sm:text-xs font-bold mt-1.5 leading-tight ${
                        isCompleted
                          ? "text-coffee-900"
                          : isPendingPayment
                          ? "text-stone-400"
                          : "text-coffee-400"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

      {/* 2. VIETQR PAYMENT CARD (IF UNPAID) */}
      {isPendingPayment && (
        <div className="bg-gradient-to-br from-amber-50 to-orange-50/50 rounded-3xl p-5 border border-amber-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-amber-200/80 pb-3">
            <div>
              <h2 className="font-bold text-sm text-coffee-900">
                Quét mã VietQR để kích hoạt đơn hàng
              </h2>
              <p className="text-[11px] text-coffee-600 mt-0.5">
                Quét bằng mọi ứng dụng Ngân hàng (MBBank, Vietcombank, Techcombank, Momo...)
              </p>
            </div>
            <span className="text-xs font-bold text-caramel bg-white px-2.5 py-1 rounded-lg border border-amber-300">
              Chờ thanh toán
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-6 justify-center">
            {/* Mèo Xòi directly holding the real dynamic VietQR card */}
            <div className="relative w-full max-w-[320px] sm:max-w-[360px] shrink-0 select-none rounded-2xl overflow-hidden shadow-md border border-amber-200/80 bg-[#FAF3D9]">
              <Image
                src="/images/meo-xoi-qr-holder.jpg"
                alt="Mèo Xòi cầm mã VietQR"
                width={896}
                height={1200}
                unoptimized
                priority
                className="w-full h-auto block object-contain"
              />

              {/* Real Dynamic VietQR / Branded payOS QR printed naturally onto the white card between the cat's paws */}
              {payosPayment?.qrImageUrl ? (
                <div className="absolute left-[27.5%] top-[48.5%] w-[45%] h-[45%] flex flex-col items-center justify-between px-1.5 py-1.5 sm:py-2 pointer-events-none">
                  {/* Top VietQR x payOS Brand Header */}
                  <div className="w-full flex items-center justify-center gap-1 leading-none">
                    <span className="text-[11px] sm:text-xs font-black tracking-tight">
                      <span className="text-[#E11D48]">Viet</span>
                      <span className="text-[#1D3557]">QR</span>
                    </span>
                    <span className="text-[8px] sm:text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                      payOS
                    </span>
                  </div>

                  {/* Center QR with Corner Viewfinder Accents & Mini Cà Xòi Logo */}
                  <div className="relative w-[82%] aspect-square p-1.5 bg-white rounded-xl shadow-[0_2px_10px_rgba(66,14,38,0.08)] border border-pink-200/80 flex items-center justify-center">
                    <span className="pointer-events-none absolute -top-0.5 -left-0.5 w-2.5 h-2.5 border-t-2 border-l-2 border-caramel rounded-tl-md" />
                    <span className="pointer-events-none absolute -top-0.5 -right-0.5 w-2.5 h-2.5 border-t-2 border-r-2 border-caramel rounded-tr-md" />
                    <span className="pointer-events-none absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 border-b-2 border-l-2 border-caramel rounded-bl-md" />
                    <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 border-b-2 border-r-2 border-caramel rounded-br-md" />

                    <Image
                      src={payosPayment.qrImageUrl}
                      alt="payOS VietQR Transfer"
                      width={320}
                      height={320}
                      unoptimized
                      priority
                      className="w-full h-full object-contain rounded"
                    />

                    {/* Centered Cà Xòi mini logo (safe with ecc=H) */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full overflow-hidden border-2 border-white shadow-sm bg-[#FFD1E3]">
                        <Image
                          src="/images/ca-xoi-logo.jpg"
                          alt="Cà Xòi"
                          width={24}
                          height={24}
                          unoptimized
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bottom Napas247 + Bank + Amount Footer */}
                  <div className="w-full text-center leading-tight space-y-0.5">
                    <div className="flex items-center justify-center gap-1 text-[8px] sm:text-[9px] font-bold text-stone-600">
                      <span className="text-[#005BAA] font-black italic">napas 247</span>
                      <span className="text-stone-300">|</span>
                      <span className="text-coffee-900 font-extrabold truncate max-w-[70px]">
                        {bankInfo?.shortName || bankId}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-[10px] sm:text-[11px] font-black text-caramel">
                        {formatVND(order.totalAmount)}
                      </span>
                      <span className="text-[8px] sm:text-[9px] font-mono font-bold text-coffee-700 bg-amber-100/80 px-1 rounded">
                        {displayTransferDesc}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="absolute left-[28.5%] top-[50.5%] w-[44%] h-[42.5%] flex items-center justify-center pointer-events-none">
                  <Image
                    src={vietQrUrl}
                    alt="VietQR Transfer"
                    width={220}
                    height={260}
                    unoptimized
                    priority
                    className="w-full h-full object-contain mix-blend-multiply"
                  />
                </div>
              )}
            </div>

            {/* Transfer instructions */}
            <div className="space-y-2.5 text-xs text-coffee-800 w-full max-w-sm">
              <div className="flex justify-between bg-white p-2.5 rounded-xl border border-amber-200">
                <span className="text-coffee-500">Ngân hàng:</span>
                <span className="font-bold">{bankInfo ? `${bankInfo.shortName} (${bankInfo.name})` : bankId}</span>
              </div>

              <div className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-amber-200">
                <span className="text-coffee-500">Số tài khoản:</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-caramel">{displayAccountNo}</span>
                  <button
                    type="button"
                    onClick={() => handleCopyContent(displayAccountNo)}
                    className="text-caramel hover:text-caramel-dark"
                    title="Sao chép số tài khoản"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-amber-200">
                <span className="text-coffee-500">Tên chủ tài khoản:</span>
                <span className="font-bold">{displayAccountName}</span>
              </div>

              <div className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-amber-200">
                <span className="text-coffee-500">Nội dung CK:</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-caramel bg-amber-100 px-1.5 py-0.5 rounded">
                    {displayTransferDesc}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyContent(displayTransferDesc)}
                    className="text-caramel hover:text-caramel-dark"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex justify-between bg-white p-2.5 rounded-xl border border-amber-200">
                <span className="text-coffee-500">Số tiền chính xác:</span>
                <span className="font-bold text-sm text-caramel">
                  {formatVND(order.totalAmount)}
                </span>
              </div>

              {payosPayment?.checkoutUrl && (
                <a
                  href={payosPayment.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl shadow-sm transition-all"
                >
                  <span>Mở cổng thanh toán payOS</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}

              {copied && (
                <p className="text-[11px] text-emerald-600 font-bold text-center">
                  ✓ Đã sao chép vào bộ nhớ tạm
                </p>
              )}
            </div>
          </div>

          {/* Real Bank Verification Notice (Active payOS sync + Webhook, no fake simulation) */}
          <div className="pt-3 border-t border-amber-200/80 space-y-2.5 bg-white/80 p-3.5 rounded-2xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="space-y-0.5 text-left">
                <span className="text-xs font-bold text-coffee-900 flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
                  Đang chờ xác nhận thanh toán tự động từ payOS / Ngân hàng
                </span>
                <p className="text-[11px] text-coffee-600 leading-relaxed">
                  Sau khi bạn chuyển khoản đúng nội dung <strong className="font-mono text-caramel">{displayTransferDesc}</strong>, hệ thống sẽ tự động đối soát trong 2–15 giây hoặc bấm nút kiểm tra ngay bên cạnh.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleManualCheckPayment}
                  disabled={isCheckingPayment}
                  className="text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl shadow-sm transition-all whitespace-nowrap flex items-center gap-1.5 disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCheckingPayment ? "animate-spin" : ""}`} />
                  <span>{isCheckingPayment ? "Đang kiểm tra..." : "Tôi đã chuyển khoản"}</span>
                </button>
                <a
                  href={getTelHref(settings?.hotline || "0905 249 733")}
                  className="text-xs font-bold bg-coffee-800 hover:bg-coffee-900 text-white px-3.5 py-2 rounded-xl shadow-sm transition-all whitespace-nowrap"
                >
                  📞 Gọi quầy: {settings?.hotline || "0905 249 733"}
                </a>
              </div>
            </div>

            {paymentCheckMsg && (
              <div
                className={`text-[11px] font-bold px-3 py-2 rounded-xl border ${
                  paymentCheckMsg.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : paymentCheckMsg.type === "error"
                    ? "bg-rose-50 text-rose-800 border-rose-200"
                    : "bg-amber-50 text-amber-900 border-amber-200"
                }`}
              >
                {paymentCheckMsg.text}
              </div>
            )}
          </div>

          {/* Customer Cancel Option directly on payment card */}
          {canCancel && (
            <div className="pt-3 border-t border-amber-200/80 flex flex-col sm:flex-row items-center justify-between gap-2 bg-rose-50/70 p-3 rounded-2xl border border-rose-200/80">
              <div className="text-left">
                <span className="text-xs font-bold text-coffee-800">
                  Đổi ý hoặc không muốn đặt món nữa?
                </span>
                <p className="text-[11px] text-coffee-500">
                  Bạn có thể hủy đơn hàng này ngay bây giờ trước khi chuyển khoản.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCancelModal(true)}
                className="text-xs font-bold bg-white hover:bg-red-50 text-red-600 border border-red-200 px-3.5 py-1.5 rounded-xl shadow-sm transition-all whitespace-nowrap active:scale-95 flex items-center gap-1.5"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Hủy đơn hàng này</span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )}

      {/* 3. ORDER DETAILS & ITEMS */}
      <div className="bg-white rounded-3xl p-5 border border-coffee-100 shadow-sm space-y-4">
        <h2 className="font-bold text-base text-coffee-900 border-b border-coffee-100 pb-2">
          Chi tiết đồ uống đã đặt
        </h2>

        <div className="divide-y divide-coffee-100 space-y-3">
          {order.items.map((item, idx) => (
            <div key={idx} className="pt-3 first:pt-0 flex justify-between gap-3 text-xs">
              <div>
                <div className="font-bold text-sm text-coffee-900">
                  {item.quantity}x {item.productName}
                </div>
                <div className="text-coffee-500 font-medium mt-0.5">
                  Size: {item.variantName}
                </div>

                {item.options && item.options.length > 0 && (
                  <div className="text-[11px] text-coffee-600 mt-0.5">
                    {item.options.map((o) => o.valueName).join(" • ")}
                  </div>
                )}

                {item.recipientLabel && (
                  <span className="inline-block bg-amber-100 text-coffee-800 text-[10px] font-bold px-2 py-0.5 rounded mt-1">
                    Ly của: {item.recipientLabel}
                  </span>
                )}
                {item.itemNotes && (
                  <div className="text-[11px] text-amber-700 italic mt-0.5">
                    Ghi chú pha chế: {item.itemNotes}
                  </div>
                )}
              </div>

              <div className="font-bold text-sm text-coffee-900 whitespace-nowrap">
                {formatVND(item.totalPrice)}
              </div>
            </div>
          ))}
        </div>

        {/* Pricing breakdown */}
        <div className="pt-3 border-t border-coffee-100 space-y-1.5 text-xs text-coffee-600">
          <div className="flex justify-between">
            <span>Tiền hàng:</span>
            <span className="font-semibold">{formatVND(order.subtotalAmount)}</span>
          </div>
          {order.discountAmount > 0 && (
            <div className="flex justify-between text-caramel">
              <span>Giảm giá ({order.promotionCode}):</span>
              <span className="font-bold">-{formatVND(order.discountAmount)}</span>
            </div>
          )}
          {order.orderType === "OFFICE_DELIVERY" && (
            <div className="flex justify-between items-center">
              <span>Phí giao hàng:</span>
              {order.deliveryFee > 0 ? (
                <span className="font-semibold text-coffee-800">{formatVND(order.deliveryFee)}</span>
              ) : settings?.shippingFeeMode === "MANUAL_ZERO" ? (
                <span className="font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  0đ (Quán sẽ báo phí ship sau)
                </span>
              ) : (
                <span className="font-bold text-emerald-700">Miễn phí (0đ)</span>
              )}
            </div>
          )}
          <div className="flex justify-between text-base font-extrabold text-coffee-900 pt-2 border-t border-coffee-200">
            <span>Tổng thanh toán:</span>
            <span className="text-caramel">{formatVND(order.totalAmount)}</span>
          </div>
        </div>

        {/* Recipient & Location Info */}
        <div className="pt-3 border-t border-coffee-100 text-xs text-coffee-700 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-bold text-coffee-900">Người nhận:</span>
            <span>{order.recipientName} ({order.recipientPhone})</span>
          </div>
          {order.buildingName && (
            <div className="flex items-center gap-2">
              <Building className="w-3.5 h-3.5 text-coffee-400" />
              <span>
                {order.buildingName} - {order.floorRoom} {order.companyName && `(${order.companyName})`}
              </span>
            </div>
          )}
          {order.shipperName && (
            <div className="flex items-center gap-2 text-emerald-800 bg-emerald-50 p-2 rounded-xl border border-emerald-200">
              <Truck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>
                Tài xế giao: <strong>{order.shipperName}</strong>
                {order.shipperPhone && ` • ${order.shipperPhone}`}
                {order.estimatedDeliveryTime && ` (Dự kiến: ${order.estimatedDeliveryTime})`}
              </span>
            </div>
          )}
          {order.deliveryNotes && (
            <div className="text-[11px] text-coffee-500 italic">
              Ghi chú: &ldquo;{order.deliveryNotes}&rdquo;
            </div>
          )}
        </div>
      </div>

      {/* Cancellation Confirmation Modal */}
      {showCancelModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isCancelling) {
              setShowCancelModal(false);
            }
          }}
        >
          <div className="relative bg-gradient-to-b from-[#FFF7F7] via-white to-white rounded-3xl p-6 pt-12 max-w-md w-full shadow-2xl border-2 border-red-100 space-y-4 animate-xoi-pop">
            {/* Swaying Mèo Xòi Mascot */}
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="relative w-24 h-24 animate-xoi-sway drop-shadow-[0_10px_18px_rgba(185,28,28,0.22)]">
                <Image
                  src="/images/meo-xoi-real.png"
                  alt="Mèo Xòi hỏi lý do hủy đơn"
                  fill
                  sizes="96px"
                  className="object-contain"
                />
              </div>
            </div>
            <div className="text-center space-y-1.5 pt-1">
              <h3 className="font-bold text-coffee-950 text-base">Xác nhận hủy đơn hàng?</h3>
              <p className="text-xs text-coffee-600 leading-relaxed">
                Bạn có chắc chắn muốn hủy đơn hàng <strong>#{order.orderCode}</strong> không? Quầy Barista Cà Xòi sẽ không thực hiện chuẩn bị đơn này.
              </p>
            </div>

            {/* Quick-select cancel reasons */}
            <div className="space-y-2">
              <p className="text-[11px] font-bold text-coffee-700 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-red-500" />
                Chọn nhanh hoặc nhập lý do hủy đơn <span className="text-red-500">*</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {CANCEL_REASON_SUGGESTIONS.map((suggestion) => {
                  const isSelected = cancelReason.trim() === suggestion;
                  return (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={isCancelling}
                      onClick={() => {
                        setCancelReason(suggestion);
                        setCancelError("");
                      }}
                      className={`text-[11px] px-2.5 py-1.5 rounded-xl border font-semibold transition-all active:scale-95 ${
                        isSelected
                          ? "bg-red-50 border-red-400 text-red-700 shadow-sm"
                          : "bg-stone-50 border-coffee-200 text-coffee-700 hover:bg-coffee-50"
                      }`}
                    >
                      {suggestion}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Reason input textarea */}
            <div className="space-y-1">
              <textarea
                rows={3}
                maxLength={200}
                disabled={isCancelling}
                value={cancelReason}
                onChange={(e) => {
                  setCancelReason(e.target.value);
                  if (cancelError) setCancelError("");
                }}
                placeholder="Nhập lý do bạn muốn hủy đơn hàng (VD: Đặt nhầm món, muốn đổi khung giờ giao...)"
                className="w-full rounded-2xl border border-coffee-200 bg-stone-50/70 px-3.5 py-2.5 text-xs text-coffee-900 placeholder:text-coffee-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400 focus:bg-white resize-none transition-all"
              />
              <div className="flex items-center justify-between text-[10px] text-coffee-400 px-1">
                <span>Ý kiến của bạn giúp Cà Xòi cải thiện dịch vụ tốt hơn</span>
                <span className="font-mono">{cancelReason.length}/200</span>
              </div>
            </div>

            {cancelError && (
              <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-xl text-center font-semibold border border-red-200">
                {cancelError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                disabled={isCancelling}
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2.5 rounded-xl border border-coffee-200 text-xs font-bold text-coffee-700 hover:bg-stone-50 active:scale-95 transition-all"
              >
                Giữ lại đơn
              </button>
              <button
                type="button"
                disabled={isCancelling}
                onClick={handleCancelOrder}
                className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-md active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isCancelling ? "Đang hủy..." : "Xác nhận hủy"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Success Celebration Modal: "Xòi xin cảm ơn!" */}
      <PaymentThankYouModal
        isOpen={showThankYouModal}
        orderCode={order.orderCode}
        totalAmount={order.totalAmount}
        onClose={() => setShowThankYouModal(false)}
      />

      {/* Order Cancelled Animated Notification Modal with Mèo Xòi */}
      <OrderCancelledModal
        isOpen={showCancelledModal}
        orderCode={order.orderCode}
        reason={cancelSuccessNotice || order.trackingNotes || ""}
        onClose={() => setShowCancelledModal(false)}
      />
    </div>
  );
}
