// parkingReports.ts
// Firestore repo for the `parkingReports` collection.
// Responsible for creating, deleting, resolving, and subscribing to reports.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  endAt,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAt,
  updateDoc,
  where,
} from 'firebase/firestore';
import { geohashForLocation, geohashQueryBounds } from 'geofire-common';

import { FIREBASE_AUTH, FIRESTORE_DB } from '../FirebaseConfig';

export type Bounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

type Coord = { latitude: number; longitude: number };

export type ParkingReportCreate = {
  latitude: number;
  longitude: number;
  type: 'free' | 'paid';
  rate?: string;
  durationSeconds?: number;
};

export type ParkingReport = {
  id: string;
  userId: string;
  createdBy?: string;

  latitude: number;
  longitude: number;
  geohash: string;

  type: 'free' | 'paid';
  rate: string | null;

  status: 'open' | 'resolved';

  createdAt?: unknown;
  durationSeconds?: number;

  resolvedAt?: unknown;
  resolvedBy?: string;
};

// Normalizes and validates latitude/longitude values from UI inputs and Firestore docs.
// Returns null if invalid to avoid crashing the app or rendering garbage markers.
function sanitizeCoord(lat: unknown, lon: unknown): Coord | null {
  const latitude = typeof lat === 'string' ? Number(lat) : lat;
  const longitude = typeof lon === 'string' ? Number(lon) : lon;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const latNum = latitude as number;
  const lonNum = longitude as number;

  if (latNum < -90 || latNum > 90) return null;
  if (lonNum < -180 || lonNum > 180) return null;

  return { latitude: latNum, longitude: lonNum };
}

// Subscribes to "open" reports that intersect a bounding box using geohash range queries.
// Does a final strict bounding-box check since geohash ranges are approximate.
export function subscribeToParkingReportsInBounds(
  bounds: Bounds,
  onData: (reports: ParkingReport[]) => void,
  onError?: (err: unknown) => void,
): () => void {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;

  // Rough radius in meters to cover the rectangle (diagonal / 2)
  const latMeters = (bounds.maxLat - bounds.minLat) * 111_320;
  const lngMeters =
    (bounds.maxLng - bounds.minLng) * 111_320 * Math.cos((centerLat * Math.PI) / 180);

  const radius = Math.sqrt(latMeters * latMeters + lngMeters * lngMeters) / 2;

  const geobounds = geohashQueryBounds([centerLat, centerLng], radius);

  const unsubs: Array<() => void> = [];
  const docMap = new Map<string, ParkingReport>();

  const emit = () => onData(Array.from(docMap.values()));

  for (const [start, end] of geobounds) {
    const q = query(
      collection(FIRESTORE_DB, 'parkingReports'),
      where('status', '==', 'open'),
      orderBy('geohash'),
      startAt(start),
      endAt(end),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        for (const d of snap.docs) {
          const data = d.data() as any;

          // Final strict bounding-box check
          const lat = data.latitude;
          const lng = data.longitude;

          if (
            typeof lat !== 'number' ||
            typeof lng !== 'number' ||
            lat < bounds.minLat ||
            lat > bounds.maxLat ||
            lng < bounds.minLng ||
            lng > bounds.maxLng
          ) {
            docMap.delete(d.id);
            continue;
          }

          docMap.set(d.id, {
            id: d.id,
            userId: data.userId,
            createdBy: data.createdBy,
            latitude: lat,
            longitude: lng,
            geohash: data.geohash,
            type: data.type,
            rate: data.rate ?? null,
            status: data.status ?? 'open',
            createdAt: data.createdAt,
            durationSeconds: data.durationSeconds ?? 30,
            resolvedAt: data.resolvedAt,
            resolvedBy: data.resolvedBy,
          });
        }

        emit();
      },
      (err) => onError?.(err),
    );

    unsubs.push(unsub);
  }

  return () => unsubs.forEach((u) => u());
}

export async function createParkingReport(data: ParkingReportCreate): Promise<string> {
  const user = FIREBASE_AUTH.currentUser;
  if (!user) throw new Error('Not logged in (FIREBASE_AUTH.currentUser is null)');

  const coord = sanitizeCoord(data.latitude, data.longitude);
  if (!coord) {
    throw new Error(`Invalid coordinates: ${data.latitude}, ${data.longitude}`);
  }

  const geohash = geohashForLocation([coord.latitude, coord.longitude]);

  const docRef = await addDoc(collection(FIRESTORE_DB, 'parkingReports'), {
    userId: user.uid,
    createdBy: user.uid,
    latitude: coord.latitude,
    longitude: coord.longitude,
    geohash,
    type: data.type,
    rate: data.type === 'paid' ? (data.rate ?? '') : null,
    status: 'open',
    createdAt: serverTimestamp(),
    durationSeconds: data.durationSeconds ?? 30,
  });

  return docRef.id;
}

// Deletes a parking report from Firestore.
// Note: Only checks that a user is signed in. Ownership rules should be enforced via Firestore Security Rules.
export async function deleteParkingReport(reportId: string): Promise<void> {
  const user = FIREBASE_AUTH.currentUser;
  if (!user) throw new Error('Not logged in (FIREBASE_AUTH.currentUser is null)');

  await deleteDoc(doc(FIRESTORE_DB, 'parkingReports', reportId));
  console.log('Deleted parking report from Firestore:', reportId);
}

export async function markReportTaken(reportId: string) {
  const user = FIREBASE_AUTH.currentUser;
  if (!user) throw new Error("Not logged in");

  await updateDoc(doc(FIRESTORE_DB, "parkingReports", reportId), {
    status: "resolved",
    resolvedBy: user.uid,
    resolvedAt: serverTimestamp(),
  });

  console.log("Marked parking report as resolved (taken):", reportId);
}

// Subscribes to parking reports (ordered by createdAt desc).
// NOTE: `bounds` is currently unused by this subscription.
// Keep it for future improvements or remove it if you want to simplify the API.
export function subscribeToParkingReports(
  bounds: Bounds,
  onData: (reports: ParkingReport[]) => void,
  onError?: (err: unknown) => void,
): () => void {
  void bounds;

  const q = query(collection(FIRESTORE_DB, 'parkingReports'), orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snap) => {
      const reports: ParkingReport[] = [];

      for (const d of snap.docs) {
        const data = d.data() as any;

        const coord = sanitizeCoord(data.latitude, data.longitude);
        if (!coord) {
          console.warn('Dropping bad parkingReport doc:', d.id, data);
          continue;
        }

        reports.push({
          id: d.id,
          userId: data.userId,
          createdBy: data.createdBy,
          latitude: coord.latitude,
          longitude: coord.longitude,
          geohash: data.geohash,
          type: data.type,
          rate: data.rate ?? null,
          status: data.status ?? 'open',
          createdAt: data.createdAt,
          durationSeconds: data.durationSeconds ?? 30,
          resolvedAt: data.resolvedAt,
          resolvedBy: data.resolvedBy,
        });
      }

      onData(reports);
    },
    (err) => onError?.(err),
  );
}

export function subscribeToMyParkingReports(
  onData: (reports: ParkingReport[]) => void,
  onError?: (err: unknown) => void,
): () => void {
  const user = FIREBASE_AUTH.currentUser;

  // If signed out, immediately emit empty and return a no-op unsubscribe.
  if (!user) {
    onData([]);
    return () => {};
  }

  const q = query(
    collection(FIRESTORE_DB, 'parkingReports'),
    where('userId', '==', user.uid),
    orderBy('createdAt', 'desc'),
  );

  return onSnapshot(
    q,
    (snap) => {
      const reports: ParkingReport[] = [];

      for (const d of snap.docs) {
        const data = d.data() as any;

        const coord = sanitizeCoord(data.latitude, data.longitude);
        if (!coord) continue;

        reports.push({
          id: d.id,
          userId: data.userId,
          createdBy: data.createdBy,
          latitude: coord.latitude,
          longitude: coord.longitude,
          geohash: data.geohash,
          type: data.type,
          rate: data.rate ?? null,
          status: data.status ?? 'open',
          createdAt: data.createdAt,
          durationSeconds: data.durationSeconds ?? 30,
          resolvedAt: data.resolvedAt,
          resolvedBy: data.resolvedBy,
        });
      }

      onData(reports);
    },
    (err) => onError?.(err),
  );
}
