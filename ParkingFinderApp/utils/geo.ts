// Geo utilities: distance calculations, coordinate validation,
// map bounds conversion, and OpenStreetMap road/parking validation.

import { Region } from "react-native-maps";

// Converts degrees to radians (used in the Haversine formula)
export const toRad = (x: number) => (x * Math.PI) / 180;

// Returns the distance in meters between two GPS coordinates
// using the Haversine formula (accounts for Earth's curvature)
export const distanceMeters = (
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
) => {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(s));
};

// Checks whether a given coordinate is within NEARBY_TAKEN_RADIUS_M meters
// of the user's current position. Returns { ok, dist } so callers can show
// the distance even when the check fails.
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

// Validates and normalizes a lat/lon pair. Returns null if the coordinates
// are out of range or not finite numbers (e.g. NaN from bad Firestore data).
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

// Converts a MapView Region into a bounding box object used for Firestore queries
export function regionToBounds(r: Region) {
  const minLat = r.latitude - r.latitudeDelta / 2;
  const maxLat = r.latitude + r.latitudeDelta / 2;
  const minLng = r.longitude - r.longitudeDelta / 2;
  const maxLng = r.longitude + r.longitudeDelta / 2;

  return { minLat, maxLat, minLng, maxLng };
}

// In-memory cache for Overpass API results to avoid redundant network calls
const overpassCacheRef = new Map<string, { ok: boolean; t: number }>();

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// Radius in meters to search around the tapped point for roads/parking
const OVERPASS_RADIUS_M = 25;
// How long to cache a result before re-querying (1 minute)
const OVERPASS_CACHE_MS = 60_000;

// Queries OpenStreetMap via the Overpass API to check if a coordinate
// is near a road or parking area. Used to prevent spots from being
// placed in the middle of fields, buildings, etc.
// Returns true if a road or parking element is found nearby.
// On network failure, returns true and re-throws so the caller can warn the user.
export const isNearRoadOrParkingOSM = async (
  latitude: number,
  longitude: number,
) => {
  // Use cached result if available and fresh
  const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const cached = overpassCacheRef.get(key);
  if (cached && Date.now() - cached.t < OVERPASS_CACHE_MS) return cached.ok;

  // Query for highways and parking amenities/buildings within the radius
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
    // Any elements returned means there's a road or parking area nearby
    const ok = Array.isArray(json?.elements) && json.elements.length > 0;

    overpassCacheRef.set(key, { ok, t: Date.now() });
    return ok;
  } catch (e) {
    // Cache as ok=true so the user isn't blocked by a flaky network
    overpassCacheRef.set(key, { ok: true, t: Date.now() });
    throw e; // Re-throw so caller can show a warning
  }
};