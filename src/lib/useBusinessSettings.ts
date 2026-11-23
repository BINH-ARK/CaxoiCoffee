"use client";

import { BusinessSettings } from "@/types";
import { useBusinessSettingsContext } from "@/context/BusinessSettingsContext";

/**
 * Shared client hook đọc từ BusinessSettingsProvider dùng chung
 * (tránh lặp nhiều request /api/settings đồng thời từ Header, Footer, Floating Button, Cart...).
 */
export function useBusinessSettings(): BusinessSettings {
  return useBusinessSettingsContext().settings;
}

