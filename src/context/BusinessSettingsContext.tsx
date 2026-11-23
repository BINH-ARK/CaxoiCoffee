"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { BusinessSettings } from "@/types";
import { INITIAL_SETTINGS } from "@/lib/store";

interface BusinessSettingsContextValue {
  settings: BusinessSettings;
  refreshSettings: (force?: boolean) => Promise<void>;
}

const BusinessSettingsContext = createContext<BusinessSettingsContextValue>({
  settings: INITIAL_SETTINGS,
  refreshSettings: async () => {},
});

// Chia sẻ promise & thời điểm fetch ở cấp module để StrictMode không bắn 2 request song song
let inFlightRequest: Promise<BusinessSettings | null> | null = null;
let lastFetchedAt = 0;
let cachedSettings: BusinessSettings = INITIAL_SETTINGS;

const FOCUS_THROTTLE_MS = 60_000; // Tối thiểu 60 giây giữa các lần tự làm mới khi focus cửa sổ

async function fetchSettingsDeduped(force = false): Promise<BusinessSettings | null> {
  const now = Date.now();
  if (!force && lastFetchedAt > 0 && now - lastFetchedAt < 5_000) {
    return cachedSettings;
  }
  if (inFlightRequest) {
    return inFlightRequest;
  }

  inFlightRequest = (async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) return null;
      const json = await res.json();
      if (json?.success && json?.data) {
        cachedSettings = { ...INITIAL_SETTINGS, ...json.data };
        lastFetchedAt = Date.now();
        return cachedSettings;
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlightRequest = null;
    }
  })();

  return inFlightRequest;
}

export function BusinessSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<BusinessSettings>(cachedSettings);
  const mountedRef = useRef(true);

  const refreshSettings = useCallback(async (force = false) => {
    const data = await fetchSettingsDeduped(force);
    if (mountedRef.current && data) {
      setSettings(data);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refreshSettings(false);

    const onStorage = (e: StorageEvent) => {
      if (e.key === "caxoi_menu_updated_at") {
        refreshSettings(true);
      }
    };

    const onFocus = () => {
      if (Date.now() - lastFetchedAt >= FOCUS_THROTTLE_MS) {
        refreshSettings(true);
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshSettings]);

  return (
    <BusinessSettingsContext.Provider value={{ settings, refreshSettings }}>
      {children}
    </BusinessSettingsContext.Provider>
  );
}

export function useBusinessSettingsContext(): BusinessSettingsContextValue {
  return useContext(BusinessSettingsContext);
}
