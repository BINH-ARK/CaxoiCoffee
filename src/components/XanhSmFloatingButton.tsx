"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { ExternalLink, Sparkles } from "lucide-react";
import { XANH_SM_ONELINK, sanitizeExternalUrl } from "@/lib/utils";
import { useBusinessSettings } from "@/lib/useBusinessSettings";

export { XANH_SM_ONELINK };

export default function XanhSmFloatingButton() {
  const pathname = usePathname();
  const settings = useBusinessSettings();

  // Hide on admin or kds routes
  if (pathname?.startsWith("/admin") || pathname?.startsWith("/kds")) {
    return null;
  }

  return (
    <aside aria-label="Kênh đặt món Xanh SM Ngon" className="fixed bottom-20 sm:bottom-6 left-4 z-40 group">
      <a
        href={sanitizeExternalUrl(settings.xanhSmUrl, XANH_SM_ONELINK)}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-xoi-shimmer flex items-center gap-2 bg-[#09CCCD] hover:bg-[#07B2B3] text-white px-3.5 py-2.5 rounded-2xl shadow-xl shadow-[#09CCCD]/35 border-2 border-[#7CEEEE]/60 transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 active:scale-95 text-xs font-bold backdrop-blur-sm"
        title="Đặt đồ uống Cà Xòi trên ứng dụng Xanh SM Ngon"
      >
        {/* Electric Bike Icon / Badge */}
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/80 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
        </span>

        <span className="flex items-center gap-1">
          <span>Đặt qua</span>
          <strong className="text-white font-black tracking-tight">Xanh SM Ngon</strong>
        </span>

        <ExternalLink className="w-3.5 h-3.5 text-white/90 group-hover:translate-x-0.5 transition-transform" />
      </a>
    </aside>
  );
}
