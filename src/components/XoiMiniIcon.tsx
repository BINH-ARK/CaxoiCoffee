"use client";

import Image from "next/image";

interface XoiMiniIconProps {
  size?: number;
  className?: string;
}

export default function XoiMiniIcon({ size = 22, className = "" }: XoiMiniIconProps) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-white/90 shadow-xs ring-1 ring-white/80 transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-12 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Image
        src="/images/meo-xoi-real.png"
        alt=""
        width={size}
        height={size}
        className="w-full h-full object-contain p-[1px]"
      />
    </span>
  );
}
