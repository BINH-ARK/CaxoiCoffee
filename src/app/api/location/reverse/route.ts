import { NextResponse } from "next/server";
import { getTrustedClientIp } from "@/lib/serverAuth";
import { consumeRateLimit, createRateLimitResponse } from "@/lib/rateLimit";
import { calculateDistanceKm } from "@/lib/daNangLocations";

export const dynamic = "force-dynamic";

interface NearbyPlace {
  name: string;
  address: string;
  fullLabel: string;
  lat: number;
  lng: number;
  distanceKm: number;
  googleMapsUrl: string;
}

export async function GET(request: Request) {
  const ip = getTrustedClientIp(request);
  const rl = await consumeRateLimit(`location:reverse:${ip}`, 15, 60 * 1000);
  if (!rl.allowed) {
    return createRateLimitResponse(
      rl.retryAfterSeconds,
      `Bạn đã định vị quá nhiều lần. Vui lòng thử lại sau ${rl.retryAfterSeconds} giây.`
    );
  }

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return NextResponse.json(
      { success: false, message: "Tọa độ định vị không hợp lệ." },
      { status: 400 }
    );
  }

  let shortAddress: string | null = null;
  const nearbyPlaces: NearbyPlace[] = [];

  // 1. Ưu tiên Google Maps Geocoding & Places Nearby Search nếu đã cấu hình GOOGLE_MAPS_API_KEY
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (googleApiKey) {
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat.toFixed(6)},${lng.toFixed(6)}&language=vi&key=${encodeURIComponent(googleApiKey)}`;
    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat.toFixed(6)},${lng.toFixed(6)}&rankby=distance&language=vi&key=${encodeURIComponent(googleApiKey)}`;

    const [geoRes, nearRes] = await Promise.allSettled([
      fetch(geocodeUrl, { signal: AbortSignal.timeout(4500) }),
      fetch(nearbyUrl, { signal: AbortSignal.timeout(4500) }),
    ]);

    if (geoRes.status === "fulfilled" && geoRes.value.ok) {
      try {
        const gData = await geoRes.value.json();
        if (gData.status === "OK" && gData.results?.[0]?.formatted_address) {
          shortAddress = String(gData.results[0].formatted_address).trim();
        }
      } catch {}
    }

    if (nearRes.status === "fulfilled" && nearRes.value.ok) {
      try {
        const nData = await nearRes.value.json();
        if (nData.status === "OK" && Array.isArray(nData.results)) {
          const seen = new Set<string>();
          for (const item of nData.results.slice(0, 6)) {
            const pLat = Number(item?.geometry?.location?.lat);
            const pLng = Number(item?.geometry?.location?.lng);
            const name = String(item?.name || "").trim();
            if (!name || !Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);

            const address = String(item?.vicinity || "").trim();
            const fullLabel =
              address && !address.toLowerCase().startsWith(name.toLowerCase())
                ? `${name} (${address})`
                : address || name;

            nearbyPlaces.push({
              name,
              address,
              fullLabel,
              lat: pLat,
              lng: pLng,
              distanceKm: calculateDistanceKm(lat, lng, pLat, pLng),
              googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullLabel)}`,
            });
          }
        }
      } catch {}
    }

    if (shortAddress || nearbyPlaces.length > 0) {
      nearbyPlaces.sort((a, b) => a.distanceKm - b.distanceKm);
      return NextResponse.json({
        success: true,
        provider: "GOOGLE_MAPS",
        address: shortAddress,
        nearbyPlaces: nearbyPlaces.slice(0, 5),
      });
    }
  }

  // 2. Fallback: Nominatim + Photon
  const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
    lat.toFixed(6)
  )}&lon=${encodeURIComponent(lng.toFixed(6))}&accept-language=vi&zoom=18`;

  const photonUrl = `https://photon.komoot.io/reverse?lat=${encodeURIComponent(
    lat.toFixed(6)
  )}&lon=${encodeURIComponent(lng.toFixed(6))}&limit=6`;

  const [nominatimRes, photonRes] = await Promise.allSettled([
    fetch(nominatimUrl, {
      headers: {
        "User-Agent": "CaXoiCoffee/1.0 (https://caxoi.vn)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4500),
    }),
    fetch(photonUrl, {
      headers: {
        "User-Agent": "CaXoiCoffee/1.0 (https://caxoi.vn)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(4000),
    }),
  ]);

  if (nominatimRes.status === "fulfilled" && nominatimRes.value.ok) {
    try {
      const data = await nominatimRes.value.json();
      const addr = data?.address || {};
      const parts = [
        data?.name && data.name !== addr.road ? data.name : null,
        [addr.house_number, addr.road].filter(Boolean).join(" ").trim() || null,
        addr.suburb || addr.quarter || addr.neighbourhood || null,
        addr.city_district || addr.county || addr.district || null,
        addr.city || addr.state || null,
      ].filter((p): p is string => Boolean(p && String(p).trim()));

      const uniqueParts: string[] = [];
      for (const p of parts) {
        if (!uniqueParts.some((u) => u.toLowerCase() === p.toLowerCase())) {
          uniqueParts.push(p);
        }
      }

      shortAddress =
        uniqueParts.slice(0, 4).join(", ") ||
        (typeof data?.display_name === "string"
          ? data.display_name.split(",").slice(0, 4).join(",").trim()
          : null);
    } catch {
      shortAddress = null;
    }
  }

  if (photonRes.status === "fulfilled" && photonRes.value.ok) {
    try {
      const photonData = await photonRes.value.json();
      const features = Array.isArray(photonData?.features) ? photonData.features : [];
      const seen = new Set<string>();

      for (const feat of features) {
        const props = feat?.properties || {};
        const coordsArr = feat?.geometry?.coordinates;
        if (!Array.isArray(coordsArr) || coordsArr.length < 2) continue;

        const pLng = Number(coordsArr[0]);
        const pLat = Number(coordsArr[1]);
        if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;

        const name = String(props.name || props.street || "").trim();
        if (!name) continue;

        const addrParts = [
          [props.housenumber, props.street].filter(Boolean).join(" ").trim() || null,
          props.district || props.locality || null,
          props.city || props.county || props.state || null,
        ].filter((p): p is string => Boolean(p && String(p).trim()));

        const uniqueAddr: string[] = [];
        for (const p of addrParts) {
          if (!uniqueAddr.some((u) => u.toLowerCase() === p.toLowerCase())) {
            uniqueAddr.push(p);
          }
        }
        const address = uniqueAddr.join(", ");
        const fullLabel =
          address && !address.toLowerCase().startsWith(name.toLowerCase())
            ? `${name} (${address})`
            : address || name;

        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        nearbyPlaces.push({
          name,
          address,
          fullLabel,
          lat: pLat,
          lng: pLng,
          distanceKm: calculateDistanceKm(lat, lng, pLat, pLng),
          googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullLabel)}`,
        });
      }

      nearbyPlaces.sort((a, b) => a.distanceKm - b.distanceKm);
    } catch {
      // Ignore photon parse error
    }
  }

  return NextResponse.json({
    success: Boolean(shortAddress || nearbyPlaces.length > 0),
    provider: "OPENSTREETMAP",
    address: shortAddress,
    nearbyPlaces: nearbyPlaces.slice(0, 5),
  });
}
