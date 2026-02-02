import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { FIRESTORE_DB, FIREBASE_AUTH } from "./FirebaseConfig";

export type ParkingReportCreate = {
  latitude: number;
  longitude: number;
  type: "free" | "paid";
  rate?: string;
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