// useLocalSpotSync.ts
// Retries unsynced local spots and uploads them to Firestore when possible.
// Uses deterministic clientSpotId writes to avoid duplicate cloud reports.

import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { createParkingReport } from '../services/parkingReports';
import type { ParkingSpot } from '../types/parking';
import { getPinStatus } from '../utils/time';

const SYNC_INTERVAL_MS = 12_000;

type Params = {
  uid: string | null;
  spots: ParkingSpot[];
  setSpots: (fn: (prev: ParkingSpot[]) => ParkingSpot[]) => void;
  onSpotSynced?: (spot: ParkingSpot, firestoreId: string) => void;
};

export function useLocalSpotSync({ uid, spots, setSpots, onSpotSynced }: Params) {
  const spotsRef = useRef<ParkingSpot[]>(spots);
  const syncingIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    spotsRef.current = spots;
  }, [spots]);

  const removeSpot = useCallback(
    (spotId: string) => {
      setSpots((prev) => prev.filter((spot) => spot.id !== spotId));
    },
    [setSpots],
  );

  const syncSpot = useCallback(
    async (spot: ParkingSpot) => {
      if (!uid || spot.firestoreId) return;
      if (syncingIdsRef.current.has(spot.id)) return;

      const durationSeconds = spot.durationSeconds ?? 30;
      const { expired } = getPinStatus(spot.createdAt, durationSeconds);
      if (expired) {
        removeSpot(spot.id);
        return;
      }

      syncingIdsRef.current.add(spot.id);

      try {
        const firestoreId = await createParkingReport({
          latitude: spot.latitude,
          longitude: spot.longitude,
          type: spot.type,
          rate: spot.rate,
          durationSeconds,
          clientSpotId: spot.id,
        });

        removeSpot(spot.id);
        onSpotSynced?.(spot, firestoreId);
      } catch (err: unknown) {
        console.warn('Failed to sync local spot:', spot.id, err);
      } finally {
        syncingIdsRef.current.delete(spot.id);
      }
    },
    [uid, removeSpot, onSpotSynced],
  );

  const syncPendingSpots = useCallback(async () => {
    if (!uid) return;

    const pendingSpots = spotsRef.current.filter((spot) => !spot.firestoreId);
    for (const spot of pendingSpots) {
      await syncSpot(spot);
    }
  }, [uid, syncSpot]);

  useEffect(() => {
    if (!uid) {
      syncingIdsRef.current.clear();
      return;
    }

    void syncPendingSpots();

    const interval = setInterval(() => {
      void syncPendingSpots();
    }, SYNC_INTERVAL_MS);

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncPendingSpots();
      }
    });

    return () => {
      clearInterval(interval);
      appStateSub.remove();
    };
  }, [uid, syncPendingSpots]);
}
