"use client";

import { useEffect } from "react";
import Image from "next/image";
import { CheckCircle2, Sparkles, X, Coffee } from "lucide-react";
import { formatVND } from "@/lib/utils";

interface PaymentThankYouModalProps {
  isOpen: boolean;
  orderCode: string;
  totalAmount: number;
  onClose: () => void;
}

const CONFETTI_PIECES = [
  { left: "6%", color: "#FF6B9D", size: 10, dur: "3.1s", delay: "0s", drift: "22px", rot: "520deg", shape: "rounded-full" },
  { left: "14%", color: "#FBBF24", size: 9, dur: "3.7s", delay: "0.25s", drift: "-18px", rot: "640deg", shape: "rounded-sm" },
  { left: "22%", color: "#34D399", size: 11, dur: "3.3s", delay: "0.1s", drift: "30px", rot: "480deg", shape: "rounded-full" },
  { left: "31%", color: "#F472B6", size: 8, dur: "2.9s", delay: "0.4s", drift: "-26px", rot: "720deg", shape: "rounded-sm" },
  { left: "40%", color: "#FB7185", size: 10, dur: "3.5s", delay: "0.15s", drift: "18px", rot: "560deg", shape: "rounded-full" },
  { left: "49%", color: "#F59E0B", size: 9, dur: "3.2s", delay: "0.5s", drift: "-14px", rot: "600deg", shape: "rounded-sm" },
  { left: "58%", color: "#10B981", size: 11, dur: "3.8s", delay: "0.05s", drift: "28px", rot: "500deg", shape: "rounded-full" },
  { left: "67%", color: "#F43F5E", size: 9, dur: "3.0s", delay: "0.35s", drift: "-22px", rot: "660deg", shape: "rounded-sm" },
  { left: "76%", color: "#FBBF24", size: 10, dur: "3.4s", delay: "0.2s", drift: "20px", rot: "540deg", shape: "rounded-full" },
  { left: "85%", color: "#EC4899", size: 8, dur: "3.6s", delay: "0.45s", drift: "-30px", rot: "700deg", shape: "rounded-sm" },
  { left: "93%", color: "#34D399", size: 10, dur: "3.1s", delay: "0.3s", drift: "-16px", rot: "580deg", shape: "rounded-full" },
];

function playThankYouChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99]; // C5 -> E5 -> G5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + idx * 0.11;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.11, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.35);
    });
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 900);
  } catch {
    // Browser autoplay policy may block sound until user interaction
  }
}

export default function PaymentThankYouModal({
  isOpen,
  orderCode,
  totalAmount,
  onClose,
}: PaymentThankYouModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    playThankYouChime();

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
      aria-label="Thanh toán thành công - Xòi xin cảm ơn"
    >
      {/* Floating Confetti Layer */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        {CONFETTI_PIECES.map((piece, idx) => (
          <span
            key={idx}
            className={`absolute top-0 animate-xoi-confetti ${piece.shape}`}
            style={
              {
                left: piece.left,
                width: `${piece.size}px`,
                height: `${piece.size * 1.35}px`,
                backgroundColor: piece.color,
                "--cf-dur": piece.dur,
                "--cf-delay": piece.delay,
                "--cf-drift": piece.drift,
                "--cf-rot": piece.rot,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* Main Celebration Card */}
      <div
        className="relative w-full max-w-sm bg-gradient-to-b from-[#FFF5F9] via-white to-[#FFF9F2] rounded-3xl p-6 pt-12 shadow-[0_30px_80px_-15px_rgba(190,24,93,0.45)] border-2 border-pink-200 text-center space-y-4 animate-xoi-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close X */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng thông báo"
          className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-white/90 hover:bg-pink-100 text-coffee-500 hover:text-coffee-900 flex items-center justify-center border border-pink-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Bouncing Mèo Xòi Mascot */}
        <div className="absolute -top-14 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="relative w-28 h-28 animate-xoi-cat drop-shadow-[0_12px_20px_rgba(157,23,77,0.28)]">
            <Image
              src="/images/meo-xoi-thankyou.png"
              alt="Mèo Xòi cảm ơn"
              fill
              sizes="112px"
              unoptimized
              className="object-contain"
              priority
            />
          </div>
        </div>

        {/* Success Badge */}
        <div className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1 rounded-full text-[11px] font-extrabold tracking-wide shadow-xs mt-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>THANH TOÁN THÀNH CÔNG</span>
        </div>

        {/* Big Headline */}
        <div className="space-y-1.5">
          <h2 className="text-2xl sm:text-[26px] font-black tracking-tight text-coffee-950 flex items-center justify-center gap-1.5">
            <span>Xòi xin cảm ơn!</span>
            <span aria-hidden="true">🐾💖</span>
          </h2>
          <p className="text-xs text-coffee-600 leading-relaxed px-1">
            Cà Xòi đã nhận đủ thanh toán cho đơn{" "}
            <strong className="font-mono text-coffee-900">#{orderCode}</strong>. Quầy bar đang
            chuẩn bị pha chế ngay để giao tới bạn thật sớm!
          </p>
        </div>

        {/* Paid Amount Box */}
        <div className="bg-white rounded-2xl border border-pink-200/80 px-4 py-3 flex items-center justify-between shadow-xs">
          <span className="text-xs font-semibold text-coffee-600 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-rose-500" />
            <span>Đã thanh toán</span>
          </span>
          <span className="text-base font-black text-emerald-600">{formatVND(totalAmount)}</span>
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-[#E11D48] via-[#EC4899] to-[#F43F5E] hover:brightness-105 text-white font-extrabold text-sm shadow-lg shadow-pink-500/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          <Coffee className="w-4 h-4" />
          <span>Theo dõi tiến độ pha chế</span>
        </button>
      </div>
    </div>
  );
}
