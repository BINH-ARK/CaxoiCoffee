import { NextResponse } from "next/server";
import { getTrustedClientIp } from "@/lib/serverAuth";
import { consumeRateLimit, createRateLimitResponse } from "@/lib/rateLimit";
import { calculateDistanceKm } from "@/lib/daNangLocations";

export const dynamic = "force-dynamic";

interface PlaceSuggestion {
  name: string;
  address: string;
  fullLabel: string;
  lat: number;
  lng: number;
  distanceKm: number | null;
  googleMapsUrl: string;
  provider: "GOOGLE_MAPS" | "OPENSTREETMAP";
}

function buildCompactAddress(addr: Record<string, string | undefined>, fallbackDisplayName?: string): string {
  const parts = [
    [addr.house_number, addr.road].filter(Boolean).join(" ").trim() || null,
    addr.suburb || addr.quarter || addr.neighbourhood || addr.village || null,
    addr.city_district || addr.county || addr.district || addr.town || null,
    addr.city || addr.state || null,
  ].filter((p): p is string => Boolean(p && p.trim()));

  const unique: string[] = [];
  for (const p of parts) {
    if (!unique.some((u) => u.toLowerCase() === p.toLowerCase())) {
      unique.push(p);
    }
  }

  if (unique.length > 0) return unique.slice(0, 4).join(", ");
  if (fallbackDisplayName) {
    return fallbackDisplayName
      .split(",")
      .slice(0, 4)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

export async function GET(request: Request) {
  const ip = getTrustedClientIp(request);
  const rl = await consumeRateLimit(`location:search:${ip}`, 30, 60 * 1000);
  if (!rl.allowed) {
    return createRateLimitResponse(
      rl.retryAfterSeconds,
      `Bạn đã tìm kiếm địa điểm quá nhanh. Vui lòng thử lại sau ${rl.retryAfterSeconds} giây.`
    );
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim().slice(0, 120);
  if (q.length < 2) {
    return NextResponse.json({ success: true, results: [] });
  }

  const rawLat = searchParams.get("lat");
  const rawLng = searchParams.get("lng");
  const lat = rawLat !== null ? Number(rawLat) : NaN;
  const lng = rawLng !== null ? Number(rawLng) : NaN;
  const hasCoords =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;

  // 1. Ưu tiên Google Maps Places Text Search API nếu server đã cấu hình GOOGLE_MAPS_API_KEY
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (googleApiKey) {
    try {
      const gParams = new URLSearchParams({
        query: q,
        language: "vi",
        key: googleApiKey,
      });
      if (hasCoords) {
        gParams.set("location", `${lat.toFixed(6)},${lng.toFixed(6)}`);
        gParams.set("radius", "15000");
      }

      const gRes = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?${gParams.toString()}`,
        { signal: AbortSignal.timeout(4500) }
      );
      if (gRes.ok) {
        const gData = await gRes.json();
        if (gData.status === "OK" && Array.isArray(gData.results) && gData.results.length > 0) {
          const results: PlaceSuggestion[] = [];
          const seen = new Set<string>();

          for (const item of gData.results.slice(0, 6)) {
            const itemLat = Number(item?.geometry?.location?.lat);
            const itemLng = Number(item?.geometry?.location?.lng);
            if (!Number.isFinite(itemLat) || !Number.isFinite(itemLng)) continue;

            const name = String(item?.name || "").trim();
            const address = String(item?.formatted_address || "").trim();
            const fullLabel =
              name && address && !address.toLowerCase().startsWith(name.toLowerCase())
                ? `${name} (${address})`
                : address || name;

            const key = fullLabel.toLowerCase();
            if (!fullLabel || seen.has(key)) continue;
            seen.add(key);

            const placeId = typeof item?.place_id === "string" ? item.place_id : "";
            const googleMapsUrl = placeId
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullLabel)}&query_place_id=${encodeURIComponent(placeId)}`
              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullLabel)}`;

            results.push({
              name: name || address,
              address,
              fullLabel,
              lat: itemLat,
              lng: itemLng,
              distanceKm: hasCoords ? calculateDistanceKm(lat, lng, itemLat, itemLng) : null,
              googleMapsUrl,
              provider: "GOOGLE_MAPS",
            });
          }

          if (hasCoords) {
            results.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
          }

          if (results.length > 0) {
            return NextResponse.json({ success: true, provider: "GOOGLE_MAPS", results });
          }
        }
      }
    } catch {
      // Fall back to OpenStreetMap Nominatim
    }
  }

  // 2. Fallback: OpenStreetMap Nominatim + liên kết & tọa độ chuẩn Google Maps
  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      q,
      "accept-language": "vi",
      addressdetails: "1",
      limit: "6",
    });

    if (hasCoords) {
      const delta = 0.18;
      params.set(
        "viewbox",
        `${(lng - delta).toFixed(5)},${(lat + delta).toFixed(5)},${(lng + delta).toFixed(5)},${(
          lat - delta
        ).toFixed(5)}`
      );
      params.set("bounded", "0");
    }

    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        "User-Agent": "CaXoiCoffee/1.0 (https://caxoi.vn)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4500),
    });

    if (!res.ok) {
      return NextResponse.json({ success: false, results: [] });
    }

    const rawList = await res.json();
    if (!Array.isArray(rawList)) {
      return NextResponse.json({ success: true, results: [] });
    }

    const results: PlaceSuggestion[] = [];
    const seen = new Set<string>();

    for (const item of rawList) {
      const itemLat = Number(item?.lat);
      const itemLng = Number(item?.lon);
      if (!Number.isFinite(itemLat) || !Number.isFinite(itemLng)) continue;

      const addr = (item?.address || {}) as Record<string, string | undefined>;
      const compactAddr = buildCompactAddress(addr, item?.display_name);
      const primaryName =
        (typeof item?.name === "string" && item.name.trim()) ||
        compactAddr.split(",")[0]?.trim() ||
        q;

      const fullLabel =
        compactAddr && !compactAddr.toLowerCase().startsWith(primaryName.toLowerCase())
          ? `${primaryName} (${compactAddr})`
          : compactAddr || primaryName;

      const dedupKey = fullLabel.toLowerCase();
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      results.push({
        name: primaryName,
        address: compactAddr,
        fullLabel,
        lat: itemLat,
        lng: itemLng,
        distanceKm: hasCoords ? calculateDistanceKm(lat, lng, itemLat, itemLng) : null,
        googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullLabel)}`,
        provider: "OPENSTREETMAP",
      });
    }

    if (hasCoords) {
      results.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
    }

    return NextResponse.json({ success: true, provider: "OPENSTREETMAP", results });
  } catch {
    return NextResponse.json({ success: false, results: [] });
  }
}
