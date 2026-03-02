import { useRef, useState, useEffect } from "react";
import * as Location from "expo-location";
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { markReportTaken } from "../parkingReports";
import { LAST_REPORTED_KEY, LastReported } from "../types/parking";
import { distanceMeters } from "../utils/geo";

const ARRIVE_RADIUS_M = 1000000;
const DWELL_MS = 1000;
const SAMPLE_WINDOW = 8;
const MOVEMENT_VARIANCE_M = 9999;

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
  userPosRef: React.MutableRefObject<{ lat: number; lon: number } | null>,
) => {
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const samplesRef = useRef<PosSample[]>([]);
  const dwellStartRef = useRef<number | null>(null);
  const alreadyAutoTakenRef = useRef<Set<string>>(new Set());

  const autoMarkTaken = async (firestoreId: string) => {
    if (!uid) return;
    if (isAutoTaking) return;

    setIsAutoTaking(true);
    alreadyAutoTakenRef.current.add(firestoreId);

    try {
      await markReportTaken(firestoreId, uid);
      setMyTakenReportId(firestoreId);
      showUndoBanner(firestoreId);
      setAutoTakenBanner("Marked as TAKEN (you arrived and parked).");
      setLastReported(null);
      setTakenByMeIds((prev) => new Set(prev).add(firestoreId));
      await AsyncStorage.removeItem(LAST_REPORTED_KEY);
    } catch (e: any) {
      Alert.alert("Auto-taken failed", e?.message ?? String(e));
      alreadyAutoTakenRef.current.delete(firestoreId);
    } finally {
      setIsAutoTaking(false);
    }
  };

  const onLocationUpdate = (lat: number, lon: number) => {
    if (!lastReported?.firestoreId) return;
    if (alreadyAutoTakenRef.current.has(lastReported.firestoreId)) return;

    const now = Date.now();

    samplesRef.current = [...samplesRef.current, { lat, lon, t: now }].slice(
      -SAMPLE_WINDOW,
    );

    const d = distanceMeters(
      lat,
      lon,
      lastReported.latitude,
      lastReported.longitude,
    );
    const inside = d <= ARRIVE_RADIUS_M;

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
      if (dwellStartRef.current === null) dwellStartRef.current = now;

      const dwell = now - dwellStartRef.current;
      if (dwell >= DWELL_MS) {
        autoMarkTaken(lastReported.firestoreId);
      }
    } else {
      dwellStartRef.current = null;
    }
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      locationSub.current?.remove();
      locationSub.current = null;

      locationSub.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 3000,
          distanceInterval: 3,
        },
        (loc) => {
          if (!mounted) return;

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