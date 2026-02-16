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
  updateDoc
} from "firebase/firestore";
import { FIRESTORE_DB, FIREBASE_AUTH } from "./FirebaseConfig";

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

  const docRef = await addDoc(collection(FIRESTORE_DB, "parkingReports"), {
    userId: user.uid,
    latitude: coord.latitude,
    longitude: coord.longitude,
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