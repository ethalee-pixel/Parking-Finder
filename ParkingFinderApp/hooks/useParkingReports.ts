// useParkingReports - subscribes to two Firestore real-time streams:
// 1) cloudReports: reports within the visible map bounds
// 2) myReports: reports created by the current user (for history)

import { useEffect, useState } from 'react';
import type { Region } from 'react-native-maps';

import {
  subscribeToMyParkingReports,
  subscribeToParkingReportsInBounds,
  type ParkingReport,
} from '../services/parkingReports';
import { regionToBounds } from '../utils/geo';

type UseParkingReportsResult = {
  cloudReports: ParkingReport[];
  myReports: ParkingReport[];
};

export function useParkingReports(
  visibleRegion: Region,
  uid: string | null,
): UseParkingReportsResult {
  // Reports from other users visible in the current map area
  const [cloudReports, setCloudReports] = useState<ParkingReport[]>([]);
  // Reports created by the current user (used in the history modal)
  const [myReports, setMyReports] = useState<ParkingReport[]>([]);

  // Re-subscribe to cloud reports whenever the visible region changes.
  // Converts the region to lat/lng bounds and uses that to scope the Firestore query.
  useEffect(() => {
    const bounds = regionToBounds(visibleRegion);

    const unsubscribe = subscribeToParkingReportsInBounds(
      bounds,
      (reports) => setCloudReports(reports),
      (err) => console.log('Firestore error:', err),
    );

    // Unsubscribe when region changes or this hook unmounts
    return unsubscribe;
  }, [visibleRegion]);

  // Subscribe to the current user's own reports.
  // Clears myReports and unsubscribes when the user signs out (uid becomes null).
  useEffect(() => {
    if (!uid) {
      setMyReports([]);
      return;
    }

    const unsubscribe = subscribeToMyParkingReports(
      (reports) => setMyReports(reports),
      (err) => console.log('My reports error:', err),
    );

    return unsubscribe;
  }, [uid]);

  return { cloudReports, myReports };
}
