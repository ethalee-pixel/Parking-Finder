import { addDoc, collection, serverTimestamp, onSnapshot, orderBy, query, } from "firebase/firestore";
import { FIRESTORE_DB, FIREBASE_AUTH } from "./FirebaseConfig";

export type ParkingReportCreate = {
  latitude: number;
  longitude: number;
  type: "free" | "paid";
  rate?: string;
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
};

export async function createParkingReport(data: ParkingReportCreate) {
  const user = FIREBASE_AUTH.currentUser;
  if (!user) {
    throw new Error("Not logged in (FIREBASE_AUTH.currentUser is null)");
  }

  const docRef = await addDoc(collection(FIRESTORE_DB, "parkingReports"), {
    userId: user.uid,
    latitude: data.latitude,
    longitude: data.longitude,
    type: data.type,
    rate: data.type === "paid" ? data.rate ?? "" : null,
    status: "open",
    createdAt: serverTimestamp(),
  });

  return docRef.id;
}

// Whenever someone adds/updates report -> you get latest list
export function subscribeToParkingReports(
  onData: (reports: ParkingReport[]) => void,
  onError?: (err: any) => void
) {
  const q = query(
    collection(FIRESTORE_DB, "parkingReports"),
    orderBy("createdAt", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const reports: ParkingReport[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          userId: data.userId,
          latitude: data.latitude,
          longitude: data.longitude,
          type: data.type,
          rate: data.rate ?? null,
          status: data.status ?? "open",
          createdAt: data.createdAt,
        };
      });

      onData(reports);
    },
    (err) => onError?.(err)
  );
}