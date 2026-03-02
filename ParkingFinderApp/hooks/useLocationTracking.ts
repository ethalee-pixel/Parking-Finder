// useLocationTracking.ts
// Custom hook that watches the user's GPS position and automatically marks the
// last reported spot as "taken" once the user arrives and stays still long enough
// (simple dwell detection).

import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { markReportTaken } from '../services/parkingReports';
import { LAST_REPORTED_KEY, type LastReported } from '../types/parking';
import { distanceMeters } from '../utils/geo';

// How close (meters) the user must be to trigger auto-taken.
// NOTE: Your current values effectively make auto-taken always eligible.
// Tune these if you want real dwell/arrival behavior.
const ARRIVE_RADIUS_M = 1_000_000;

// How long (ms) the user must remain still inside the arrive radius.
const DWELL_MS = 1_000;

// How many recent GPS samples to keep for movement variance.
const SAMPLE_WINDOW = 8;

// Maximum spread (meters) across samples to consider the user "not moving".
const MOVEMENT_VARIANCE_M = 9_999;

type PosSample = { lat: number; lon: number; t: number };

type UserPos = { lat: number; lon: number };

type Params = {
  lastReported: LastReported | null;
  uid: string | null;

  isAutoTaking: boolean;
  setIsAutoTaking: (v: boolean) => void;

  setMyTakenReportId: (id: string | null) => void;
  setTakenByMeIds: (fn: (prev: Set<string>) => Set<string>) => void;
  setLastReported: (v: LastReported | null) => void;

  setAutoTakenBanner: (v: string | null) => void;
  showUndoBanner: (id: string) => void;

  // Ref shared with MapScreen so other parts of the app can read the user's position.
  userPosRef: React.MutableRefObject<UserPos | null>;
};

export function useLocationTracking({
  lastReported,
  uid,
  isAutoTaking,
  setIsAutoTaking,
  setMyTakenReportId,
  setTakenByMeIds,
  setLastReported,
  setAutoTakenBanner,
  showUndoBanner,
  userPosRef,
}: Params) {
  // Subscription to expo-location watcher (cleaned up on unmount).
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  // Rolling window of recent GPS samples for movement detection.
  const samplesRef = useRef<PosSample[]>([]);

  // Timestamp when the user first entered the dwell zone.
  const dwellStartRef = useRef<number | null>(null);

  // Tracks which Firestore IDs have already been auto-taken.
  const alreadyAutoTakenRef = useRef<Set<string>>(new Set());

  const autoMarkTaken = async (firestoreId: string) => {
    if (!uid) return;
    if (isAutoTaking) return;

    setIsAutoTaking(true);

    // Optimistically add to avoid duplicates before Firestore responds.
    alreadyAutoTakenRef.current.add(firestoreId);

    try {
      await markReportTaken(firestoreId, uid);

      setMyTakenReportId(firestoreId);
      setTakenByMeIds((prev) => new Set(prev).add(firestoreId));

      showUndoBanner(firestoreId);
      setAutoTakenBanner('Marked as TAKEN (you arrived and parked).');

      // Clear lastReported state and storage so we don't attempt again.
      setLastReported(null);
      await AsyncStorage.removeItem(LAST_REPORTED_KEY);
    } catch (e: any) {
      Alert.alert('Auto-taken failed', e?.message ?? String(e));

      // Roll back optimistic add so we can retry later.
      alreadyAutoTakenRef.current.delete(firestoreId);
    } finally {
      setIsAutoTaking(false);
    }
  };

  // Called on each GPS update. Checks arrival + dwell, and triggers auto-taken if eligible.
  const onLocationUpdate = (lat: number, lon: number) => {
    if (!lastReported?.firestoreId) return;

    const firestoreId = lastReported.firestoreId;

    // Don’t re-trigger for a spot we've already handled.
    if (alreadyAutoTakenRef.current.has(firestoreId)) return;

    const now = Date.now();

    // Add sample to rolling window.
    samplesRef.current = [...samplesRef.current, { lat, lon, t: now }].slice(-SAMPLE_WINDOW);

    const distanceToSpotM = distanceMeters(lat, lon, lastReported.latitude, lastReported.longitude);

    const insideArriveRadius = distanceToSpotM <= ARRIVE_RADIUS_M;

    // Movement variance proxy: max deviation from the oldest sample in the window.
    const base = samplesRef.current[0];
    const maxDeviationM = base
      ? Math.max(...samplesRef.current.map((p) => distanceMeters(p.lat, p.lon, base.lat, base.lon)))
      : Number.POSITIVE_INFINITY;

    const lowMovement = maxDeviationM <= MOVEMENT_VARIANCE_M;

    if (insideArriveRadius && lowMovement) {
      if (dwellStartRef.current === null) {
        dwellStartRef.current = now;
      }

      const dwellMs = now - dwellStartRef.current;
      if (dwellMs >= DWELL_MS) {
        autoMarkTaken(firestoreId);
      }
      return;
    }

    // User left the zone or is moving: reset dwell timer.
    dwellStartRef.current = null;
  };

  // Start watching GPS position when lastReported or uid changes.
  // Cleans up watcher on unmount or before restarting.
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      // Ensure only one watcher exists.
      locationSubRef.current?.remove();
      locationSubRef.current = null;

      locationSubRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 3000, // at most every 3 seconds
          distanceInterval: 3, // or every 3 meters moved
        },
        (loc) => {
          if (!mounted) return;

          // Update shared ref for proximity checks elsewhere in the app.
          userPosRef.current = {
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
          };

          onLocationUpdate(loc.coords.latitude, loc.coords.longitude);
        },
      );
    })();

    return () => {
      mounted = false;
      locationSubRef.current?.remove();
      locationSubRef.current = null;
    };
  }, [lastReported, uid]);

  return { alreadyAutoTakenRef };
}
