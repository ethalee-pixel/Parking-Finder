// parkingReports.ts
// Firestore repo for the `parkingReports` collection.
// Responsible for creating, deleting, resolving, and subscribing to reports.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  endAt,
  getDoc,
  setDoc,
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
  clientSpotId?: string;
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
  clientSpotId?: string;
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

function toParkingReport(id: string, data: any): ParkingReport | null {
  const coord = sanitizeCoord(data.latitude, data.longitude);
  if (!coord) return null;

  return {
    id,
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
    clientSpotId: data.clientSpotId,
    resolvedAt: data.resolvedAt,
    resolvedBy: data.resolvedBy,
  };
}

// Subscribes to reports that intersect a bounding box using geohash range queries.
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

  // Track which reports are currently present in each geohash query range.
  const rangeToIds = new Map<number, Set<string>>();
  const reportToRanges = new Map<string, Set<number>>();

  const emit = () => onData(Array.from(docMap.values()));

  for (let rangeIndex = 0; rangeIndex < geobounds.length; rangeIndex += 1) {
    const [start, end] = geobounds[rangeIndex];

    // user story 2.3
    // user story 3.3
    const q = query(
      collection(FIRESTORE_DB, 'parkingReports'),
      orderBy('geohash'),
      startAt(start),
      endAt(end),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const prevIds = rangeToIds.get(rangeIndex) ?? new Set<string>();
        const nextIds = new Set<string>();

        for (const d of snap.docs) {
          const data = d.data() as any;

          const report = toParkingReport(d.id, data);
          if (!report) {
            console.warn('Dropping bad parkingReport doc:', d.id, data);
            continue;
          }

          const inBounds =
            report.latitude >= bounds.minLat &&
            report.latitude <= bounds.maxLat &&
            report.longitude >= bounds.minLng &&
            report.longitude <= bounds.maxLng;

          if (!inBounds) continue;

          docMap.set(d.id, report);
          nextIds.add(d.id);

          const ranges = reportToRanges.get(d.id) ?? new Set<number>();
          ranges.add(rangeIndex);
          reportToRanges.set(d.id, ranges);
        }

        // Remove any docs that this specific query no longer returns.
        for (const oldId of prevIds) {
          if (nextIds.has(oldId)) continue;

          const ranges = reportToRanges.get(oldId);
          if (!ranges) continue;

          ranges.delete(rangeIndex);
          if (ranges.size === 0) {
            reportToRanges.delete(oldId);
            docMap.delete(oldId);
          }
        }

        rangeToIds.set(rangeIndex, nextIds);
        emit();
      },
      (err) => onError?.(err),
    );

    unsubs.push(unsub);
  }

  return () => {
    for (const unsub of unsubs) unsub();
    rangeToIds.clear();
    reportToRanges.clear();
    docMap.clear();
  };
}

export async function createParkingReport(data: ParkingReportCreate): Promise<string> {
  const user = FIREBASE_AUTH.currentUser;
  if (!user) throw new Error('Not logged in (FIREBASE_AUTH.currentUser is null)');
  const coord = sanitizeCoord(data.latitude, data.longitude);
  if (!coord) {
    throw new Error(`Invalid coordinates: ${data.latitude}, ${data.longitude}`);
  }
  const geohash = geohashForLocation([coord.latitude, coord.longitude]);
  // user story 1.1
  // user story 2.1
  // user story 4.1
  const payload = {
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
    clientSpotId: data.clientSpotId ?? null,
  };
  // Deterministic document IDs make offline retry idempotent.
  // user story 3.2
  if (data.clientSpotId) {
    const safeClientSpotId = encodeURIComponent(data.clientSpotId);
    const idempotentDocId = `client-${user.uid}-${safeClientSpotId}`;
    const reportRef = doc(FIRESTORE_DB, 'parkingReports', idempotentDocId);
    const existing = await getDoc(reportRef);
    if (!existing.exists()) {
      await setDoc(reportRef, payload);
    }
    return reportRef.id;
  }
  const docRef = await addDoc(collection(FIRESTORE_DB, 'parkingReports'), payload);
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

export async function markReportTaken(reportId: string): Promise<void> {
  const user = FIREBASE_AUTH.currentUser;
  if (!user) throw new Error('Not logged in');

  // user story 3.4
  // user story 4.1
  // user story 4.2
  // user story 4.3
  await updateDoc(doc(FIRESTORE_DB, 'parkingReports', reportId), {
    status: 'resolved',
    resolvedBy: user.uid,
    resolvedAt: serverTimestamp(),
  });

  console.log('Marked parking report as resolved (taken):', reportId);
}

export async function reopenParkingReport(reportId: string): Promise<void> {
  const user = FIREBASE_AUTH.currentUser;
  if (!user) throw new Error('Not logged in');

  // user story 3.5
  await updateDoc(doc(FIRESTORE_DB, 'parkingReports', reportId), {
    status: 'open',
    resolvedAt: null,
    resolvedBy: null,
  });
}

export async function getParkingReportById(reportId: string): Promise<ParkingReport | null> {
  const snap = await getDoc(doc(FIRESTORE_DB, 'parkingReports', reportId));
  if (!snap.exists()) return null;

  const report = toParkingReport(snap.id, snap.data());
  if (!report) {
    console.warn('Dropping bad parkingReport doc:', snap.id, snap.data());
    return null;
  }

  return report;
}

// Legacy subscription used by older flows. Kept for compatibility.
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
        const report = toParkingReport(d.id, data);

        if (!report) {
          console.warn('Dropping bad parkingReport doc:', d.id, data);
          continue;
        }

        reports.push(report);
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

  // user story 3.1
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
        const report = toParkingReport(d.id, data);
        if (!report) continue;

        reports.push(report);
      }

      onData(reports);
    },
    (err) => onError?.(err),
  );
}
