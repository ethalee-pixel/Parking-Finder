// types/parking.ts
// Shared data models and AsyncStorage keys used across the app.
export type SpotType = 'free' | 'paid';

/**
 * ParkingSpot
 * A locally stored parking spot saved on the device.
 * This exists even if the Firestore write fails (offline fallback).
 */
export type ParkingSpot = {
  // Locally generated unique ID
  id: string;

  latitude: number;
  longitude: number;

  // user story 2.2
  type: SpotType;

  // Only present for paid spots (ex: "$2/hr")
  rate?: string;

  /**
   * Timestamp of when the spot was created.
   * Can be:
   *  - number (Date.now())
   *  - JS Date
   *  - Firestore Timestamp
   */
  createdAt: unknown;

  // Used for optimistic update tracking / future sync logic
  version: number;

  // Lifetime of the spot in seconds
  // user story 1.1
  durationSeconds: number;

  // Set once the spot is successfully saved to Firestore
  firestoreId?: string;
};

// Persist local spots across app restarts
// user story 3.2
export const STORAGE_KEY = '@parking_spots';

// Tracks which Firestore report the user currently has marked as taken
// user story 3.5
export const MY_TAKEN_KEY = '@my_taken_report_id';
