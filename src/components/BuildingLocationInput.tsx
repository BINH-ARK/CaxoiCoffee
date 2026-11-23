"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LocateFixed,
  Loader2,
  MapPin,
  Navigation,
  Search,
  ExternalLink,
  Map as MapIcon,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { formatDistanceLabel } from "@/lib/daNangLocations";

interface PlaceItem {
  name: string;
  address: string;
  fullLabel: string;
  lat?: number;
  lng?: number;
  distanceKm: number | null;
  googleMapsUrl?: string;
}

interface BuildingLocationInputProps {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  placeholder?: string;
  labelClassName?: string;
  maxSuggestions?: number;
}

export default function BuildingLocationInput({
  value,
  onChange,
  label = "Tòa nhà giao hàng",
  placeholder = "Nhập địa chỉ cụ thể, tên tòa nhà hoặc bấm Gợi ý gần tôi...",
  labelClassName = "text-xs font-bold text-coffee-700",
  maxSuggestions = 4,
}: BuildingLocationInputProps) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [detectedAddress, setDetectedAddress] = useState<string | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<PlaceItem[]>([]);
  const [searchResults, setSearchResults] = useState<PlaceItem[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceItem | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showMapPreview, setShowMapPreview] = useState(true);
  const [debouncedMapQuery, setDebouncedMapQuery] = useState("");
  const [geoError, setGeoError] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const skipNextSearchRef = useRef(false);

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const locateDevice = useCallback((silent = false) => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      if (!silent) {
        setGeoError("Trình duyệt không hỗ trợ định vị. Bạn có thể tự nhập địa chỉ bên trên.");
      }
      return;
    }

    setIsLocating(true);
    if (!silent) setGeoError("");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCoords({ lat, lng });

        try {
          const res = await fetch(
            `/api/location/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,
            { cache: "no-store" }
          );
          const data = await res.json();
          if (data.address) {
            setDetectedAddress(data.address);
          }
          if (Array.isArray(data.nearbyPlaces)) {
            setNearbyPlaces(data.nearbyPlaces.slice(0, maxSuggestions));
          }
        } catch {
          if (!silent) {
            setGeoError("Đã lấy được tọa độ thiết bị nhưng chưa tải được tên địa điểm gần bạn.");
          }
        } finally {
          setIsLocating(false);
        }
      },
      (err) => {
        setIsLocating(false);
        if (silent) return;
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError(
            "Bạn chưa cấp quyền vị trí cho trình duyệt. Hãy bật định vị hoặc tự nhập địa chỉ để tìm trên Google Maps."
          );
        } else {
          setGeoError("Chưa lấy được vị trí hiện tại. Bạn có thể tự nhập địa chỉ để tìm trên Google Maps.");
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 180000,
      }
    );
  }, [maxSuggestions]);

  // Tự động định vị ngầm nếu trình duyệt đã được cấp quyền định vị trước đó
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (!cancelled && status.state === "granted") {
          locateDevice(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locateDevice]);

  // Tìm kiếm địa chỉ cụ thể khi người dùng nhập (debounce 400ms, ưu tiên gần vị trí thiết bị nếu có)
  useEffect(() => {
    const q = value.trim();

    if (q.length < 3) {
      setDebouncedMapQuery("");
    }

    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      setDebouncedMapQuery(q);
      return;
    }

    if (q.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setDebouncedMapQuery(q);
      setIsSearching(true);
      try {
        const qs = new URLSearchParams({ q });
        if (coords) {
          qs.set("lat", String(coords.lat));
          qs.set("lng", String(coords.lng));
        }
        const res = await fetch(`/api/location/search?${qs.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.results)) {
          setSearchResults(data.results);
          setShowDropdown(true);
        }
      } catch {
        // Ignore abort / network errors
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, coords]);

  const handleSelectPlace = (place: PlaceItem) => {
    skipNextSearchRef.current = true;
    setSelectedPlace(place);
    onChange(place.fullLabel);
    setDebouncedMapQuery(place.fullLabel);
    setShowDropdown(false);
    setShowMapPreview(true);
  };

  const handleSelectCurrentAddress = () => {
    if (!detectedAddress) return;
    skipNextSearchRef.current = true;
    setSelectedPlace({
      name: detectedAddress,
      address: detectedAddress,
      fullLabel: detectedAddress,
      lat: coords?.lat,
      lng: coords?.lng,
      distanceKm: 0,
      googleMapsUrl: coords
        ? `https://www.google.com/maps/search/?api=1&query=${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(detectedAddress)}`,
    });
    onChange(detectedAddress);
    setDebouncedMapQuery(detectedAddress);
    setShowDropdown(false);
    setShowMapPreview(true);
  };

  // Tạo URL nhúng Google Maps hiển thị đúng địa chỉ cụ thể đang tìm / đã chọn
  const activeQuery = debouncedMapQuery.trim();
  const hasMapTarget = activeQuery.length >= 3;
  const googleEmbedQuery =
    selectedPlace && selectedPlace.fullLabel === activeQuery && selectedPlace.lat && selectedPlace.lng
      ? `${selectedPlace.lat.toFixed(6)},${selectedPlace.lng.toFixed(6)}`
      : activeQuery;
  const googleMapsEmbedSrc = hasMapTarget
    ? `https://maps.google.com/maps?q=${encodeURIComponent(googleEmbedQuery)}&hl=vi&z=16&ie=UTF8&iwloc=&output=embed`
    : "";
  const googleMapsExternalUrl = hasMapTarget
    ? selectedPlace?.googleMapsUrl ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activeQuery)}`
    : "";

  return (
    <div ref={containerRef} className="space-y-2 relative">
      <div className="flex items-center justify-between gap-2">
        <label className={`block ${labelClassName}`}>{label}</label>
        <button
          type="button"
          onClick={() => locateDevice(false)}
          disabled={isLocating}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700 bg-pink-50 hover:bg-pink-100 border border-pink-200 px-2.5 py-1 rounded-lg transition-all active:scale-95 disabled:opacity-60"
          title="Sử dụng định vị thiết bị để gợi ý địa điểm gần bạn"
        >
          {isLocating ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <LocateFixed className="w-3 h-3" />
          )}
          <span>{isLocating ? "Đang định vị..." : coords ? "Cập nhật vị trí" : "Gợi ý gần tôi"}</span>
        </button>
      </div>

      {/* Ô nhập tự do + dropdown kết quả tìm kiếm địa chỉ */}
      <div className="relative">
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onFocus={() => {
            if (searchResults.length > 0) setShowDropdown(true);
          }}
          onChange={(e) => {
            setSelectedPlace(null);
            onChange(e.target.value);
          }}
          className="w-full text-xs pl-3.5 pr-9 py-2.5 rounded-xl border border-pink-200 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 transition-all"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-coffee-400 pointer-events-none">
          {isSearching ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500" />
          ) : (
            <Search className="w-3.5 h-3.5" />
          )}
        </span>

        {showDropdown && searchResults.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-white rounded-2xl border border-pink-200 shadow-xl overflow-hidden divide-y divide-pink-100 max-h-60 overflow-y-auto">
            {searchResults.map((item, idx) => (
              <button
                key={`${item.fullLabel}-${idx}`}
                type="button"
                onClick={() => handleSelectPlace(item)}
                className="w-full text-left px-3.5 py-2.5 hover:bg-pink-50/80 transition-colors flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-coffee-950 truncate flex items-center gap-1.5">
                    <MapPin className="w-3 h-3 text-rose-500 shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </div>
                  {item.address && (
                    <p className="text-[10px] text-coffee-600 truncate pl-4 mt-0.5">
                      {item.address}
                    </p>
                  )}
                </div>
                {item.distanceKm !== null && (
                  <span className="shrink-0 text-[10px] font-bold text-rose-600 bg-pink-50 border border-pink-200 px-1.5 py-0.5 rounded-full">
                    {formatDistanceLabel(item.distanceKm)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Gợi ý dựa trên vị trí thiết bị của bạn */}
      {detectedAddress && (
        <button
          type="button"
          onClick={handleSelectCurrentAddress}
          className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50/90 hover:bg-emerald-100/80 border border-emerald-200 text-[11px] text-emerald-900 font-semibold transition-all active:scale-[0.99]"
        >
          <Navigation className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="truncate">
            Vị trí hiện tại của bạn: <strong>{detectedAddress}</strong>
          </span>
        </button>
      )}

      {nearbyPlaces.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-coffee-600 flex items-center gap-1">
            <MapPin className="w-3 h-3 text-rose-500" />
            <span>Gợi ý địa điểm gần vị trí của bạn:</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {nearbyPlaces.map((b, idx) => (
              <button
                key={`${b.name}-${idx}`}
                type="button"
                onClick={() => handleSelectPlace(b)}
                className="inline-flex items-center gap-1 text-[10px] bg-[#FFF5F8] hover:bg-pink-100 text-coffee-800 px-2.5 py-1 rounded-lg border border-pink-200/80 transition-colors active:scale-95"
                title={b.fullLabel}
              >
                <span>+ {b.name}</span>
                {b.distanceKm !== null && (
                  <span className="text-[9px] font-bold text-rose-600 bg-white px-1.5 py-0.2 rounded-full border border-pink-200/70">
                    {formatDistanceLabel(b.distanceKm)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bản đồ Google Maps hiển thị đúng địa chỉ cụ thể khách vừa tìm kiếm */}
      {hasMapTarget && (
        <div className="rounded-2xl border border-pink-200/90 bg-white overflow-hidden shadow-xs">
          <div className="px-3 py-2 bg-[#FFF7FA] border-b border-pink-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <MapIcon className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              <span className="text-[11px] font-bold text-coffee-900 truncate">
                Google Maps: {activeQuery}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <a
                href={googleMapsExternalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-700 bg-white border border-pink-200 px-2 py-0.5 rounded-md transition-colors"
              >
                <span>Mở Maps</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
              <button
                type="button"
                onClick={() => setShowMapPreview((prev) => !prev)}
                className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-coffee-600 hover:text-coffee-900 px-1.5 py-0.5 rounded-md hover:bg-pink-100/70 transition-colors"
                aria-label={showMapPreview ? "Ẩn bản đồ" : "Hiện bản đồ"}
              >
                {showMapPreview ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {showMapPreview && (
            <iframe
              title={`Bản đồ Google Maps cho ${activeQuery}`}
              src={googleMapsEmbedSrc}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="w-full h-44 border-0 block"
            />
          )}
        </div>
      )}

      {geoError && (
        <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          {geoError}
        </p>
      )}
    </div>
  );
}
