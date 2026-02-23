import {
  addDoc,
  collection,
  serverTimestamp,
  onSnapshot,
  orderBy,
  query,
  where,
  deleteDoc,
  doc,
  updateDoc,
  startAt,
  endAt,
} from "firebase/firestore";
import { FIRESTORE_DB, FIREBASE_AUTH } from "./FirebaseConfig";
import { geohashForLocation, geohashQueryBounds } from "geofire-common";

type Bounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export function subscribeToParkingReportsInBounds(
  bounds: Bounds,
  onData: (reports: ParkingReport[]) => void,
  onError?: (err: any) => void,
) {
  // Center + radius big enough to cover the rectangle
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;

  // Rough radius in meters to cover the box (diagonal/2)
  const latMeters = (bounds.maxLat - bounds.minLat) * 111_320;
  const lngMeters =
    (bounds.maxLng - bounds.minLng) *
    111_320 *
    Math.cos((centerLat * Math.PI) / 180);

  const radius = Math.sqrt(latMeters * latMeters + lngMeters * lngMeters) / 2;

  const geobounds = geohashQueryBounds([centerLat, centerLng], radius);

  const unsubs: Array<() => void> = [];
  const docMap = new Map<string, ParkingReport>();

  const emit = () => onData(Array.from(docMap.values()));

  for (const [start, end] of geobounds) {
    const q = query(
      collection(FIRESTORE_DB, "parkingReports"),
      where("status", "==", "open"),
      orderBy("geohash"),
      startAt(start),
      endAt(end),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        for (const d of snap.docs) {
          const data = d.data() as any;

          // Final strict bounding-box check (geohash ranges are approximate)
          const lat = data.latitude;
          const lng = data.longitude;
          if (
            typeof lat !== "number" ||
            typeof lng !== "number" ||
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
            latitude: lat,
            longitude: lng,
            type: data.type,
            rate: data.rate ?? null,
            status: data.status ?? "open",
            createdAt: data.createdAt,
            durationSeconds: data.durationSeconds ?? 30,
          } as any);
        }

        emit();
      },
      (err) => onError?.(err),
    );

    unsubs.push(unsub);
  }

  return () => unsubs.forEach((u) => u());
}

function sanitizeCoord(lat: any, lon: any) {
  const latitude = typeof lat === "string" ? Number(lat) : lat;
  const longitude = typeof lon === "string" ? Number(lon) : lon;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  return { latitude, longitude };
}

export type ParkingReportCreate = {
  latitude: number;
  longitude: number;
  type: "free" | "paid";
  rate?: string;
  durationSeconds?: number; // ADD: Custom duration for parking spot
};

export type ParkingReport = {
  id: string;
  userId: string;
  latitude: number;
  longitude: number;
  geohash: string;
  type: "free" | "paid";
  rate: string | null;
  status: "open" | "resolved";
  createdAt?: any;
  durationSeconds?: number; // ADD: Custom duration for parking spot
  resolvedAt?: any;
  resolvedBy?: string;
};

export async function createParkingReport(data: ParkingReportCreate) {
  const user = FIREBASE_AUTH.currentUser;
  if (!user) {
    throw new Error("Not logged in (FIREBASE_AUTH.currentUser is null)");
  }

  const coord = sanitizeCoord(data.latitude, data.longitude);
  if (!coord) {
    throw new Error(`Invalid coordinates: ${data.latitude}, ${data.longitude}`);
  }
  const geohash = geohashForLocation([coord.latitude, coord.longitude]);
  const docRef = await addDoc(collection(FIRESTORE_DB, "parkingReports"), {
    userId: user.uid,
    latitude: coord.latitude,
    longitude: coord.longitude,
    geohash,
    type: data.type,
    rate: data.type === "paid" ? (data.rate ?? "") : null,
    status: "open",
    createdAt: serverTimestamp(),
    durationSeconds: data.durationSeconds ?? 30, // ADD: Store duration (default 30s)
  });

  return docRef.id;
}

// Delete a parking report from Firestore
export async function deleteParkingReport(reportId: string) {
  const user = FIREBASE_AUTH.currentUser;
  if (!user) {
    throw new Error("Not logged in (FIREBASE_AUTH.currentUser is null)");
  }

  const docRef = doc(FIRESTORE_DB, "parkingReports", reportId);
  await deleteDoc(docRef);

  console.log("Deleted parking report from Firestore:", reportId);
}

export async function markReportTaken(reportId: string, uid: string) {
  const docRef = doc(FIRESTORE_DB, "parkingReports", reportId);

  await updateDoc(docRef, {
    status: "resolved",
    resolvedBy: uid,
    resolvedAt: serverTimestamp(),
  });

  console.log("Marked parking report as resolved (taken):", reportId);
}

// Whenever someone adds/updates report -> you get latest list
export function subscribeToParkingReports(
  bounds: Bounds,
  onData: (reports: ParkingReport[]) => void,
  onError?: (err: any) => void,
) {
  const q = query(
    collection(FIRESTORE_DB, "parkingReports"),
    orderBy("createdAt", "desc"),
  );

  return onSnapshot(
    q,
    (snap) => {
      const reports: ParkingReport[] = [];

      for (const d of snap.docs) {
        const data = d.data() as any;

        const coord = sanitizeCoord(data.latitude, data.longitude);
        if (!coord) {
          console.warn("Dropping bad parkingReport doc:", d.id, data);
          continue;
        }

        reports.push({
          id: d.id,
          userId: data.userId,
          latitude: coord.latitude,
          longitude: coord.longitude,
          geohash: data.geohash,
          type: data.type,
          rate: data.rate ?? null,
          status: data.status ?? "open",
          createdAt: data.createdAt,
          durationSeconds: data.durationSeconds ?? 30, // ADD: Include duration
        });
      }

      onData(reports);
    },
    (err) => onError?.(err),
  );
}

export function subscribeToMyParkingReports(
  onData: (reports: ParkingReport[]) => void,
  onError?: (err: any) => void,
) {
  const user = FIREBASE_AUTH.currentUser;
  if (!user) {
    onData([]);
    return () => {};
  }

  const q = query(
    collection(FIRESTORE_DB, "parkingReports"),
    where("userId", "==", user.uid),
    orderBy("createdAt", "desc"),
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
          latitude: coord.latitude,
          longitude: coord.longitude,
          geohash: data.geohash,
          type: data.type,
          rate: data.rate ?? null,
          status: data.status ?? "open",
          createdAt: data.createdAt,
          durationSeconds: data.durationSeconds ?? 30, // ADD: Include duration
          resolvedAt: data.resolvedAt,
          resolvedBy: data.resolvedBy,
        });
      }
      onData(reports);
    },
    (err) => onError?.(err),
  );
}
