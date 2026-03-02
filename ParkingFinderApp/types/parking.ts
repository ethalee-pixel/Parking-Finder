// Shared types and storage key constants used across the app.

// Represents a parking spot stored locally on the device
export type ParkingSpot = {
  id: string;               // Locally generated unique ID
  latitude: number;
  longitude: number;
  type: "free" | "paid";
  rate?: string;            // Only set for paid spots (e.g. "$2/hr")
  createdAt: any;           // Timestamp - can be a number, Firestore Timestamp, or Date
  version: number;          // Used for optimistic update tracking
  durationSeconds: number;  // How long this spot is valid for
  firestoreId?: string;     // Set after the spot is saved to Firestore
};

// AsyncStorage key for persisting local spots across app restarts
export const STORAGE_KEY = "@parking_spots";
// AsyncStorage key for the last spot this user reported (used for auto-taken tracking)
export const LAST_REPORTED_KEY = "@last_reported_spot";
// AsyncStorage key for the Firestore report ID the user currently has marked as taken
export const MY_TAKEN_KEY = "@my_taken_report_id";

// Stores just enough info about the last reported spot to detect when the user arrives
export type LastReported = {
  firestoreId: string;  // The Firestore document ID to mark as taken on arrival
  latitude: number;
  longitude: number;
  createdAt: number;    // Unix timestamp in milliseconds
};