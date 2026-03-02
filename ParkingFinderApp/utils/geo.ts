import { Region } from "react-native-maps";

export const toRad = (x: number) => (x * Math.PI) / 180;

export const distanceMeters = (
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
) => {
  const R = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(s));
};

export const isNearMe = (
  userPos: { lat: number; lon: number } | null,
  lat: number,
  lon: number,
  NEARBY_TAKEN_RADIUS_M: number,
) => {
  if (!userPos) return { ok: false, dist: Infinity };

  const dist = distanceMeters(userPos.lat, userPos.lon, lat, lon);
  return { ok: dist <= NEARBY_TAKEN_RADIUS_M, dist };
};

export const safeCoord = (
  lat: any,
  lon: any,
): { latitude: number; longitude: number } | null => {
  const latitude = typeof lat === "string" ? Number(lat) : lat;
  const longitude = typeof lon === "string" ? Number(lon) : lon;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  return { latitude, longitude };
};

export function regionToBounds(r: Region) {
  const minLat = r.latitude - r.latitudeDelta / 2;
  const maxLat = r.latitude + r.latitudeDelta / 2;
  const minLng = r.longitude - r.longitudeDelta / 2;
  const maxLng = r.longitude + r.longitudeDelta / 2;

  return { minLat, maxLat, minLng, maxLng };
}

const overpassCacheRef = new Map<string, { ok: boolean; t: number }>();

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_RADIUS_M = 25;
const OVERPASS_CACHE_MS = 60_000;

export const isNearRoadOrParkingOSM = async (
  latitude: number,
  longitude: number,
) => {
  const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const cached = overpassCacheRef.get(key);
  if (cached && Date.now() - cached.t < OVERPASS_CACHE_MS) return cached.ok;

  const query = `
[out:json][timeout:8];
(
  way(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["highway"];
  way(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["amenity"="parking"];
  way(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["building"="parking"];
  way(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["parking"];
  relation(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["amenity"="parking"];
  relation(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["building"="parking"];
);
out body;
`;

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);

    const json: any = await res.json();
    const ok = Array.isArray(json?.elements) && json.elements.length > 0;

    overpassCacheRef.set(key, { ok, t: Date.now() });
    return ok;
  } catch (e) {
    overpassCacheRef.set(key, { ok: true, t: Date.now() });
    throw e;
  }
};