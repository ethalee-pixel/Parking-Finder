// useLocationTracking - custom hook that watches the user's GPS position
// and automatically marks a reported spot as "taken" once the user
// arrives nearby and stays still long enough (dwell detection).

import { useRef, useState, useEffect } from "react";
import * as Location from "expo-location";
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { markReportTaken } from "../parkingReports";
import { LAST_REPORTED_KEY, LastReported } from "../types/parking";
import { distanceMeters } from "../utils/geo";

// Effectively unlimited arrival radius (auto-taken triggers on any location update)
const ARRIVE_RADIUS_M = 1000000;
// How long (ms) the user must stay still near the spot before auto-taking
const DWELL_MS = 1000;
// How many recent GPS samples to keep for movement variance calculation
const SAMPLE_WINDOW = 8;
// Maximum spread (meters) across recent samples to be considered "not moving"
const MOVEMENT_VARIANCE_M = 9999;

// A single GPS position sample with a timestamp
type PosSample = { lat: number; lon: number; t: number };

export const useLocationTracking = (
  lastReported: LastReported | null,
  uid: string | null,
  isAutoTaking: boolean,
  setIsAutoTaking: (v: boolean) => void,
  setMyTakenReportId: (id: string | null) => void,
  setTakenByMeIds: (fn: (prev: Set<string>) => Set<string>) => void,
  setLastReported: (v: LastReported | null) => void,
  setAutoTakenBanner: (v: string | null) => void,
  showUndoBanner: (id: string) => void,
  // Ref shared with MapScreen so other parts of the app can read user's position
  userPosRef: React.MutableRefObject<{ lat: number; lon: number } | null>,
) => {
  // Subscription to the expo-location watcher (cleaned up on unmount)
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  // Rolling window of recent GPS samples for movement detection
  const samplesRef = useRef<PosSample[]>([]);
  // Timestamp when the user first entered the dwell zone (null if outside)
  const dwellStartRef = useRef<number | null>(null);
  // Tracks which Firestore IDs have already been auto-taken to avoid duplicates
  const alreadyAutoTakenRef = useRef<Set<string>>(new Set());

  // Marks a Firestore report as taken and updates all relevant state
  const autoMarkTaken = async (firestoreId: string) => {
    if (!uid) return;
    if (isAutoTaking) return;

    setIsAutoTaking(true);
    // Optimistically add to the set so we don't trigger again before Firestore responds
    alreadyAutoTakenRef.current.add(firestoreId);

    try {
      await markReportTaken(firestoreId, uid);
      setMyTakenReportId(firestoreId);
      showUndoBanner(firestoreId);
      setAutoTakenBanner("Marked as TAKEN (you arrived and parked).");
      setLastReported(null);
      setTakenByMeIds((prev) => new Set(prev).add(firestoreId));
      // Clear the last-reported key so we don't try to auto-take again
      await AsyncStorage.removeItem(LAST_REPORTED_KEY);
    } catch (e: any) {
      Alert.alert("Auto-taken failed", e?.message ?? String(e));
      // Roll back the optimistic add so we can try again on next location update
      alreadyAutoTakenRef.current.delete(firestoreId);
    } finally {
      setIsAutoTaking(false);
    }
  };

  // Called on every GPS update. Checks if the user has arrived near lastReported
  // and stayed still long enough to trigger auto-taken.
  const onLocationUpdate = (lat: number, lon: number) => {
    // Nothing to do if there's no pending reported spot
    if (!lastReported?.firestoreId) return;
    // Don't re-trigger for a spot we already handled
    if (alreadyAutoTakenRef.current.has(lastReported.firestoreId)) return;

    const now = Date.now();

    // Add this sample to the rolling window, keeping only the last SAMPLE_WINDOW samples
    samplesRef.current = [...samplesRef.current, { lat, lon, t: now }].slice(-SAMPLE_WINDOW);

    // Check distance from the reported spot
    const d = distanceMeters(lat, lon, lastReported.latitude, lastReported.longitude);
    const inside = d <= ARRIVE_RADIUS_M;

    // Calculate how spread out the recent samples are (proxy for movement)
    const base = samplesRef.current[0];
    const maxDev = base
      ? Math.max(
          ...samplesRef.current.map((p) =>
            distanceMeters(p.lat, p.lon, base.lat, base.lon),
          ),
        )
      : 9999;

    const lowMovement = maxDev <= MOVEMENT_VARIANCE_M;

    if (inside && lowMovement) {
      // Start the dwell timer if this is the first frame in the zone
      if (dwellStartRef.current === null) dwellStartRef.current = now;

      const dwell = now - dwellStartRef.current;
      // Trigger auto-taken once dwell time is met
      if (dwell >= DWELL_MS) {
        autoMarkTaken(lastReported.firestoreId);
      }
    } else {
      // User left the zone or is moving - reset dwell timer
      dwellStartRef.current = null;
    }
  };

  // Start watching GPS position when lastReported or uid changes.
  // Cleans up the watcher on unmount or before re-running.
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      // Remove any previous watcher before starting a new one
      locationSub.current?.remove();
      locationSub.current = null;

      locationSub.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 3000,    // Check at most every 3 seconds
          distanceInterval: 3,   // Or every 3 meters moved
        },
        (loc) => {
          if (!mounted) return;

          // Update the shared position ref for proximity checks elsewhere in the app
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
      locationSub.current?.remove();
      locationSub.current = null;
    };
  }, [lastReported, uid]);

  return { alreadyAutoTakenRef };
};