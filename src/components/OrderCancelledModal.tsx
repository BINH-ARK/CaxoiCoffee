"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { X, XCircle, ArrowLeft, MessageSquare } from "lucide-react";

interface OrderCancelledModalProps {
  isOpen: boolean;
  orderCode: string;
  reason: string;
  onClose: () => void;
}

const FLOATING_ACCENTS = [
  { left: "8%", icon: "🐾", dur: "4.6s", delay: "0s", drift: "16px", size: "text-base" },
  { left: "18%", icon: "💧", dur: "5.2s", delay: "0.4s", drift: "-14px", size: "text-sm" },
  { left: "30%", icon: "☁️", dur: "5.6s", delay: "0.15s", drift: "20px", size: "text-base" },
  { left: "44%", icon: "🐾", dur: "4.9s", delay: "0.7s", drift: "-18px", size: "text-sm" },
  { left: "58%", icon: "💧", dur: "5.1s", delay: "0.25s", drift: "15px", size: "text-sm" },
  { left: "72%", icon: "🐾", dur: "4.7s", delay: "0.55s", drift: "-20px", size: "text-base" },
  { left: "84%", icon: "☁️", dur: "5.4s", delay: "0.1s", drift: "12px", size: "text-sm" },
  { left: "92%", icon: "💧", dur: "4.8s", delay: "0.65s", drift: "-12px", size: "text-sm" },
];

function playSoftCancelChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 392.0]; // Gentle descending C5 -> G4
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + idx * 0.14;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    });
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 850);
  } catch {
    // Browser autoplay policy may block sound
  }
}

export default function OrderCancelledModal({
  isOpen,
  orderCode,
  reason,
  onClose,
}: OrderCancelledModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    playSoftCancelChime();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-coffee-950/65 backdrop-blur-sm overflow-hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Đã hủy đơn hàng"
    >
      {/* Gentle Floating Accents Layer */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        {FLOATING_ACCENTS.map((item, idx) => (
          <span
            key={idx}
            className={`absolute top-0 animate-xoi-drop select-none ${item.size}`}
            style={
              {
                left: item.left,
                "--drop-dur": item.dur,
                "--drop-delay": item.delay,
                "--drop-drift": item.drift,
              } as React.CSSProperties
            }
          >
            {item.icon}
          </span>
        ))}
      </div>

      {/* Main Cancellation Card */}
      <div
        className="relative w-full max-w-sm bg-gradient-to-b from-[#FFF5F5] via-white to-[#FFF9F4] rounded-3xl p-6 pt-14 shadow-[0_30px_80px_-15px_rgba(185,28,28,0.32)] border-2 border-red-200 text-center space-y-4 animate-xoi-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close X */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng thông báo"
          className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-white/90 hover:bg-red-50 text-coffee-500 hover:text-coffee-900 flex items-center justify-center border border-red-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Swaying Mèo Xòi Mascot + Speech Bubble */}
        <div className="absolute -top-14 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="relative w-28 h-28 animate-xoi-sway drop-shadow-[0_12px_20px_rgba(153,27,27,0.22)]">
            <Image
              src="/images/meo-xoi-real.png"
              alt="Mèo Xòi tạm biệt đơn hàng"
              fill
              sizes="112px"
              className="object-contain"
              priority
            />
            <span className="absolute -right-7 top-2 bg-white border border-red-200 text-[10px] font-extrabold text-red-600 px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap">
              Tiếc quá đi... 🥺
            </span>
          </div>
        </div>

        {/* Status Badge */}
        <div className="inline-flex items-center gap-1.5 bg-red-100 text-red-700 border border-red-200 px-3 py-1 rounded-full text-[11px] font-extrabold tracking-wide shadow-xs mt-1">
          <XCircle className="w-3.5 h-3.5 text-red-600" />
          <span>ĐÃ HỦY ĐƠN HÀNG</span>
        </div>

        {/* Headline */}
        <div className="space-y-1.5">
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-coffee-950">
            Xòi tiếc quá... Hẹn gặp lại bạn nhé! 🐾
          </h2>
          <p className="text-xs text-coffee-600 leading-relaxed px-1">
            Đơn hàng <strong className="font-mono text-coffee-900">#{orderCode}</strong> đã được hủy
            thành công. Cảm ơn bạn đã góp ý để Cà Xòi phục vụ tốt hơn lần sau!
          </p>
        </div>

        {/* Recorded Reason Box */}
        {reason && (
          <div className="bg-red-50/80 rounded-2xl border border-red-200/80 px-4 py-3 text-left space-y-1">
            <div className="text-[11px] font-bold text-red-700 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              <span>Lý do hủy đã ghi nhận</span>
            </div>
            <p className="text-xs text-coffee-800 italic leading-relaxed">
              &ldquo;{reason}&rdquo;
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2 pt-1">
          <Link
            href="/"
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-coffee-800 to-coffee-900 hover:from-coffee-900 hover:to-coffee-950 text-white font-bold text-xs shadow-md active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Về thực đơn đặt món khác</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl border border-coffee-200 bg-white hover:bg-stone-50 text-coffee-700 font-bold text-xs active:scale-95 transition-all"
          >
            Đóng thông báo
          </button>
        </div>
      </div>
    </div>
  );
}
