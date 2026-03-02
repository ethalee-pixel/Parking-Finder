// useParkingReports - subscribes to two Firestore real-time streams:
// 1. cloudReports: all open parking reports within the visible map bounds
// 2. myReports: all reports ever created by the current user (for history)

import { useState, useEffect } from "react";
import {
  subscribeToParkingReports,
  subscribeToMyParkingReports,
  ParkingReport,
} from "../parkingReports";
import { regionToBounds } from "../utils/geo";
import { Region } from "react-native-maps";

export const useParkingReports = (
  // The currently visible map region - used to calculate query bounds
  visibleRegion: Region,
  // Current user's UID - used to subscribe to their own reports
  uid: string | null,
) => {
  // Reports from other users visible in the current map area
  const [cloudReports, setCloudReports] = useState<ParkingReport[]>([]);
  // All reports created by the current user (used in the history modal)
  const [myReports, setMyReports] = useState<ParkingReport[]>([]);

  // Re-subscribe to cloud reports whenever the visible map region changes.
  // Converts the region to lat/lng bounds and passes them to the Firestore query.
  useEffect(() => {
    const bounds = regionToBounds(visibleRegion);

    const unsub = subscribeToParkingReports(
      bounds,
      (reports) => setCloudReports(reports),
      (err) => console.log("Firestore error:", err),
    );

    // Unsubscribe from the previous listener when region changes or component unmounts
    return unsub;
  }, [visibleRegion]);

  // Subscribe to the current user's own reports.
  // Clears myReports and unsubscribes if the user signs out (uid becomes null).
  useEffect(() => {
    if (!uid) {
      setMyReports([]);
      return;
    }
    const unsub = subscribeToMyParkingReports(
      (reports) => setMyReports(reports),
      (err) => console.log("My reports error:", err),
    );
    return unsub;
  }, [uid]);

  return { cloudReports, myReports };
};