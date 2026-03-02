export type ParkingSpot = {
  id: string;
  latitude: number;
  longitude: number;
  type: "free" | "paid";
  rate?: string;
  createdAt: any;
  version: number;
  durationSeconds: number;
  firestoreId?: string;
};

export const STORAGE_KEY = "@parking_spots";
export const LAST_REPORTED_KEY = "@last_reported_spot";
export const MY_TAKEN_KEY = "@my_taken_report_id";

export type LastReported = {
  firestoreId: string;
  latitude: number;
  longitude: number;
  createdAt: number;
};