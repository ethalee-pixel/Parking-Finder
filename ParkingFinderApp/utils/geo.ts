// geo.ts
// Geo utilities: distance calculations, coordinate validation,
// map bounds conversion, and OpenStreetMap road/parking validation.

import type { Region } from 'react-native-maps';

export type LatLon = { lat: number; lon: number };
export type LatLng = { latitude: number; longitude: number };
export type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

// Converts degrees to radians (used in the Haversine formula)
export function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// Returns distance in meters between two GPS coordinates using the Haversine formula.
export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000; // Earth radius in meters

  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);

  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(s));
}

// Checks whether a given coordinate is within `radiusM` meters of the user's position.
// Returns { ok, dist } so callers can still show distance even when the check fails.
export function isNearMe(
  userPos: LatLon | null,
  lat: number,
  lon: number,
  radiusM: number,
): { ok: boolean; dist: number } {
  if (!userPos) return { ok: false, dist: Number.POSITIVE_INFINITY };

  const dist = distanceMeters(userPos.lat, userPos.lon, lat, lon);
  return { ok: dist <= radiusM, dist };
}

// Validates and normalizes a lat/lon pair. Returns null if invalid.
export function safeCoord(lat: unknown, lon: unknown): LatLng | null {
  const latitude = typeof lat === 'string' ? Number(lat) : lat;
  const longitude = typeof lon === 'string' ? Number(lon) : lon;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const latNum = latitude as number;
  const lonNum = longitude as number;

  if (latNum < -90 || latNum > 90) return null;
  if (lonNum < -180 || lonNum > 180) return null;

  return { latitude: latNum, longitude: lonNum };
}

// Converts a MapView Region into a bounding box (used for Firestore geo queries).
export function regionToBounds(r: Region): Bounds {
  const minLat = r.latitude - r.latitudeDelta / 2;
  const maxLat = r.latitude + r.latitudeDelta / 2;
  const minLng = r.longitude - r.longitudeDelta / 2;
  const maxLng = r.longitude + r.longitudeDelta / 2;

  return { minLat, maxLat, minLng, maxLng };
}

/* ────────────────────────────────────────── */
/* OpenStreetMap validation (Overpass API) */
/* ────────────────────────────────────────── */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Radius (meters) to search around the tapped point.
const OVERPASS_RADIUS_M = 25;

// Cache results briefly to reduce duplicate network calls.
const OVERPASS_CACHE_MS = 60_000;
const overpassCache = new Map<string, { ok: boolean; t: number }>();

/**
 * Queries OpenStreetMap via Overpass to check if a coordinate is near a road or parking area.
 * Used to prevent placing spots in invalid locations (fields/buildings/etc).
 *
 * Returns true if a road/parking element exists nearby.
 * Returns false if validation cannot be completed (network/rate-limit/etc).
 */
export async function isNearRoadOrParkingOSM(
  latitude: number,
  longitude: number,
): Promise<boolean> {
  const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;

  const cached = overpassCache.get(key);
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
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);

    const json: unknown = await res.json();
    const elements = (json as any)?.elements;

    const ok = Array.isArray(elements) && elements.length > 0;
    overpassCache.set(key, { ok, t: Date.now() });

    return ok;
  } catch (err) {
    console.warn('Overpass validation failed:', err);
    overpassCache.set(key, { ok: false, t: Date.now() });
    return false;
  }
}
