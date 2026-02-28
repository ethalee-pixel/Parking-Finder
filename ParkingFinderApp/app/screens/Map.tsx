import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Keyboard,
  FlatList,
  ScrollView,
  Platform,
} from "react-native";
import MapView, { Region, Marker } from "react-native-maps";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import {
  createParkingReport,
  subscribeToParkingReports,
  subscribeToMyParkingReports,
  deleteParkingReport,
  ParkingReport,
  markReportTaken,
} from "../../parkingReports";
import { FIREBASE_AUTH, FIRESTORE_DB } from "../../FirebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";

// Configure how notifications should be handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification:
    async (): Promise<Notifications.NotificationBehavior> => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,

      // Required by newer expo-notifications types (mainly iOS)
      shouldShowBanner: true,
      shouldShowList: true,
    }),
});

type ParkingSpot = {
  id: string;
  latitude: number;
  longitude: number;
  type: "free" | "paid";
  rate?: string;
  createdAt: any;
  version: number;
  durationSeconds: number; // Total duration for this spot
  firestoreId?: string; // Firebase document ID for deletion
};

const STORAGE_KEY = "@parking_spots";
const LAST_REPORTED_KEY = "@last_reported_spot";

type LastReported = {
  firestoreId: string;
  latitude: number;
  longitude: number;
  createdAt: number;
};

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const didCenterOnUserRef = useRef(false);

  // Start with default region immediately (Santa Cruz, CA)
  const [region, setRegion] = useState<Region>({
    latitude: 36.9741,
    longitude: -122.0308,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  const [visibleRegion, setVisibleRegion] = useState<Region>({
    latitude: 36.9741,
    longitude: -122.0308,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  const regionDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [tick, setTick] = useState(0); // Updates every second
  const [cloudReports, setCloudReports] = useState<ParkingReport[]>([]);

  // NEW: hide cloud markers immediately after deleting (prevents "comes back" bug)
  const [hiddenCloudIds, setHiddenCloudIds] = useState<Set<string>>(new Set());

  // Track which IDs we have already alerted for so we don't spam
  const alertedIds = useRef<Set<string>>(new Set());

  const [pendingCoord, setPendingCoord] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const [spotType, setSpotType] = useState<"free" | "paid">("free");
  const [rate, setRate] = useState("");
  const [showModal, setShowModal] = useState(false);

  // NEW: prevent double submission + show progress
  const [isCreatingSpot, setIsCreatingSpot] = useState(false);
  const [isAutoTaking, setIsAutoTaking] = useState(false);

  // Duration picker state
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(30);

  // My reports history
  const [myReports, setMyReports] = useState<ParkingReport[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyType, setHistoryType] = useState<"all" | "free" | "paid">(
    "all",
  );
  const [historyStatus, setHistoryStatus] = useState<
    "all" | "open" | "resolved"
  >("all");
  const [historyRange, setHistoryRange] = useState<
    "all" | "24h" | "7d" | "30d"
  >("all");
  const [historySort, setHistorySort] = useState<
    "newest" | "oldest" | "paidFirst" | "freeFirst"
  >("newest");

  const [uid, setUid] = useState<string | null>(
    FIREBASE_AUTH.currentUser?.uid ?? null,
  );

  // Filtered history based on user selections
  const filteredMyReports = useMemo(() => {
    const now = Date.now();

    const withinRange = (createdAt: any) => {
      if (historyRange === "all") return true;
      const t = getTimeInMillis(createdAt);
      const ageMs = now - t;

      if (historyRange === "24h") return ageMs <= 24 * 60 * 60 * 1000;
      if (historyRange === "7d") return ageMs <= 7 * 24 * 60 * 60 * 1000;
      if (historyRange === "30d") return ageMs <= 30 * 24 * 60 * 60 * 1000;
      return true;
    };

    let arr = myReports.filter((r) => {
      if (historyType !== "all" && r.type !== historyType) return false;
      if (historyStatus !== "all" && r.status !== historyStatus) return false;
      if (!withinRange(r.createdAt)) return false;
      return true;
    });

    arr.sort((a, b) => {
      const at = getTimeInMillis(a.createdAt);
      const bt = getTimeInMillis(b.createdAt);

      if (historySort === "newest") return bt - at;
      if (historySort === "oldest") return at - bt;

      if (historySort === "paidFirst") {
        if (a.type !== b.type) return a.type === "paid" ? -1 : 1;
        return bt - at;
      }

      if (historySort === "freeFirst") {
        if (a.type !== b.type) return a.type === "free" ? -1 : 1;
        return bt - at;
      }

      return bt - at;
    });

    return arr;
  }, [myReports, historyType, historyStatus, historyRange, historySort]);

  // Selected marker modal
  const [selectedMarker, setSelectedMarker] = useState<{
    data: any;
    isCloud: boolean;
  } | null>(null);

  const [lastReported, setLastReported] = useState<LastReported | null>(null);
  const [autoTakenBanner, setAutoTakenBanner] = useState<string | null>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);

  type PosSample = { lat: number; lon: number; t: number };
  const samplesRef = useRef<PosSample[]>([]);
  const dwellStartRef = useRef<number | null>(null);
  const alreadyAutoTakenRef = useRef<Set<string>>(new Set());

  const ARRIVE_RADIUS_M = 1000000;
  const DWELL_MS = 1000;
  const SAMPLE_WINDOW = 8;
  const MOVEMENT_VARIANCE_M = 9999;

  // Undo window (30–60s recommended)
  const UNDO_WINDOW_MS = 45_000; // 45 seconds
  // Tracks an active undo opportunity for ONE auto-taken report at a time
  const [undoState, setUndoState] = useState<{
    reportId: string;
    expiresAt: number;
    isProcessing: boolean;
  } | null>(null);

  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUndoBanner = (reportId: string) => {
    // Clear any previous undo timeout
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    const expiresAt = Date.now() + UNDO_WINDOW_MS;
    setUndoState({ reportId, expiresAt, isProcessing: false });

    // Auto-hide after window expires
    undoTimerRef.current = setTimeout(() => {
      setUndoState(null);
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  };

  const undoAutoTaken = async () => {
    if (!undoState) return;

    // Prevent undo after time window expires
    if (Date.now() > undoState.expiresAt) {
      setUndoState(null);
      return;
    }

    // Prevent double taps
    if (undoState.isProcessing) return;

    setUndoState({ ...undoState, isProcessing: true });

    try {
      await updateDoc(doc(FIRESTORE_DB, "parkingReports", undoState.reportId), {
        status: "open",
        resolvedAt: null,
        resolvedBy: null,
      });

      // Allow auto-taken to happen again later if needed
      alreadyAutoTakenRef.current.delete(undoState.reportId);

      // Remove banner
      setUndoState(null);
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
    } catch (e: any) {
      setUndoState({ ...undoState, isProcessing: false });
      Alert.alert(
        "Undo failed",
        e?.message ?? "Could not undo the auto-taken update.",
      );
    }
  };

  // Cleanup: undo timer (prevents setState after unmount)
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
    };
  }, []);

  // ---- Coordinate firewall ----
  const safeCoord = (
    lat: any,
    lon: any,
  ): { latitude: number; longitude: number } | null => {
    const latitude = typeof lat === "string" ? Number(lat) : lat;
    const longitude = typeof lon === "string" ? Number(lon) : lon;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90) return null;
    if (longitude < -180 || longitude > 180) return null;

    return { latitude, longitude };
  };

  /* ---------- HELPER: Time Calculations ---------- */
  function getTimeInMillis(timeData: any) {
    if (!timeData) return Date.now();
    if (timeData.seconds) return timeData.seconds * 1000;
    return typeof timeData === "number"
      ? timeData
      : new Date(timeData).getTime();
  }

  const getAgeInSeconds = (createdAt: any) => {
    const timeInMillis = getTimeInMillis(createdAt);
    return Math.floor((Date.now() - timeInMillis) / 1000);
  };

  // Helper to format text like "1m 30s"
  const formatDuration = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  // Request notification permissions
  const requestNotificationPermissions = async () => {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      Alert.alert(
        "Permission Required",
        "Please enable notifications to get alerts when your parking spots are expiring.",
      );
      return false;
    }
    return true;
  };

  // Calculate bounds of the current map region
  function regionToBounds(r: Region) {
    const minLat = r.latitude - r.latitudeDelta / 2;
    const maxLat = r.latitude + r.latitudeDelta / 2;
    const minLng = r.longitude - r.longitudeDelta / 2;
    const maxLng = r.longitude + r.longitudeDelta / 2;

    return { minLat, maxLat, minLng, maxLng };
  }

  // Schedule notification for a parking spot
  const scheduleSpotNotification = async (
    spotId: string,
    durationSeconds: number,
    spotType_: string,
  ) => {
    // For iOS in Expo Go, rely on in-app Alert dialogs (your current behavior)
    if (Platform.OS === "ios") return null;

    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return null;

    // Schedule notification at 90% of duration (warning time)
    const warningTime = Math.floor(durationSeconds * 0.9);
    const timeRemaining = durationSeconds - warningTime;

    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: "⚠️ Parking Spot Expiring Soon",
          body: `Your ${
            spotType_ === "free" ? "Free" : "Paid"
          } parking spot will expire in ${formatDuration(timeRemaining)}!`,
          sound: true,
          vibrate: [0, 250, 250, 250],
          priority: Notifications.AndroidNotificationPriority.HIGH,
          ...(Platform.OS === "android" && { channelId: "parking-alerts" }),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: warningTime,
          repeats: false,
        },
      });
      return notificationId;
    } catch {
      return null;
    }
  };

  /* ---------- HELPER: Get Status for Rendering ---------- */
  const getPinStatus = (createdAt: any, durationSeconds: number) => {
    const age = getAgeInSeconds(createdAt);
    const warningThreshold = Math.floor(durationSeconds * 0.9);

    if (age >= durationSeconds) {
      return { color: "#999999", expired: true, warning: false, age };
    }
    if (age >= warningThreshold) {
      return { color: "#FF0000", expired: false, warning: true, age };
    }
    return { color: "#00FF00", expired: false, warning: false, age };
  };

  /* ---------- CHECK FOR WARNINGS & EXPIRATIONS ---------- */
  const checkAlertsAndExpiration = () => {
    const allMySpots = [...spots, ...myReports];

    for (const spot of allMySpots) {
      const age = getAgeInSeconds(spot.createdAt);
      const duration = spot.durationSeconds || 30;
      const warningThreshold = Math.floor(duration * 0.9);

      if (age >= warningThreshold && age < duration) {
        if (!alertedIds.current.has(spot.id)) {
          const timeRemaining = duration - age;
          const spotLabel = spot.type === "free" ? "Free" : "Paid";

          Alert.alert(
            "⚠️ Parking Spot Expiring Soon",
            `Your ${spotLabel} parking spot will expire in ${formatDuration(
              timeRemaining,
            )}!`,
            [{ text: "OK" }],
          );

          alertedIds.current.add(spot.id);
        }
      }
    }

    // Remove expired LOCAL spots
    setSpots((prev) => {
      const stillValid = prev.filter((spot) => {
        const age = getAgeInSeconds(spot.createdAt);
        const duration = spot.durationSeconds || 30;
        return age < duration;
      });

      const removedCount = prev.length - stillValid.length;
      if (removedCount > 0) {
        Alert.alert(
          "Parking Spots Expired",
          `${removedCount} parking spot(s) have expired and been removed.`,
          [{ text: "OK" }],
        );
      }

      return stillValid;
    });
  };

  const toRad = (x: number) => (x * Math.PI) / 180;

  const distanceMeters = (
    aLat: number,
    aLon: number,
    bLat: number,
    bLon: number,
  ) => {
    const R = 6371000;
    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLon - aLon);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);

    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(s));
  };

  const autoMarkTaken = async (firestoreId: string) => {
    if (!uid) return;
    if (isAutoTaking) return;

    setIsAutoTaking(true);
    alreadyAutoTakenRef.current.add(firestoreId);

    try {
      await markReportTaken(firestoreId, uid);
      showUndoBanner(firestoreId);
      setAutoTakenBanner("Marked as TAKEN (you arrived and parked).");
      setLastReported(null);
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

  // ---------------- OSM / Overpass check ----------------
  const overpassCacheRef = useRef<Map<string, { ok: boolean; t: number }>>(
    new Map(),
  );

  const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  const OVERPASS_RADIUS_M = 25; // tweak: 20–50 is typical
  const OVERPASS_CACHE_MS = 60_000;

  const isNearRoadOrParkingOSM = async (
    latitude: number,
    longitude: number,
  ) => {
    const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const cached = overpassCacheRef.current.get(key);
    if (cached && Date.now() - cached.t < OVERPASS_CACHE_MS) return cached.ok;

    const query = `
[out:json][timeout:8];
(
  way(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["highway"];
  way(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["amenity"="parking"];
  way(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["building"="parking"];
  way(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["parking"];
  relation(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["amenity"="parking"];
  relation(around:${OVERPASS_RADIUS_M},${latitude},${longitude})["building"="parking"];
);
out body;
`;

    try {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);

      const json: any = await res.json();
      const ok = Array.isArray(json?.elements) && json.elements.length > 0;

      overpassCacheRef.current.set(key, { ok, t: Date.now() });
      return ok;
    } catch (e) {
      // Don't block user if Overpass is flaky; allow but cache as ok=true for a minute
      overpassCacheRef.current.set(key, { ok: true, t: Date.now() });
      throw e;
    }
  };

  /* ---------- EFFECTS ---------- */

  // The "Game Loop" - Ticks every 1 second
  useEffect(() => {
    const interval = setInterval(() => setTick((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    checkAlertsAndExpiration();
  }, [tick]);

  // auto-hide banner
  useEffect(() => {
    if (!autoTakenBanner) return;
    const t = setTimeout(() => setAutoTakenBanner(null), 4000);
    return () => clearTimeout(t);
  }, [autoTakenBanner]);

  // Standard Setup (Location, Auth, etc)
  useEffect(() => {
    (async () => {
      try {
        await requestNotificationPermissions();

        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("parking-alerts", {
            name: "Parking Alerts",
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            sound: "default",
            enableVibrate: true,
            enableLights: true,
            lightColor: "#FF0000",
          });
        }

        const { status } = await Location.requestForegroundPermissionsAsync();

        const savedSpots = await AsyncStorage.getItem(STORAGE_KEY);
        if (savedSpots) {
          const parsed = JSON.parse(savedSpots);
          if (Array.isArray(parsed)) {
            const cleaned: ParkingSpot[] = parsed
              .map((spot: any) => {
                const coord = safeCoord(spot.latitude, spot.longitude);
                if (!coord) return null;
                return {
                  ...spot,
                  latitude: coord.latitude,
                  longitude: coord.longitude,
                  version: 0,
                  durationSeconds: spot.durationSeconds || 30,
                } as ParkingSpot;
              })
              .filter((s): s is ParkingSpot => s !== null);
            setSpots(cleaned);
          }
        }

        const savedLast = await AsyncStorage.getItem(LAST_REPORTED_KEY);
        if (savedLast) {
          try {
            setLastReported(JSON.parse(savedLast));
          } catch {}
        }

        if (status === "granted") {
          try {
            const loc = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Highest,
            });

            const userRegion: Region = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            };

            setRegion(userRegion);
            setVisibleRegion(userRegion);

            if (!didCenterOnUserRef.current) {
              didCenterOnUserRef.current = true;
              setTimeout(() => {
                mapRef.current?.animateToRegion(userRegion, 700);
              }, 80);
            }
          } catch {
            setRegion({
              latitude: 36.9741,
              longitude: -122.0308,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            });
          }
        } else {
          setRegion({
            latitude: 36.9741,
            longitude: -122.0308,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          });
        }
      } catch {
        setRegion({
          latitude: 36.9741,
          longitude: -122.0308,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
    })();
  }, []);

  useEffect(() => {
    const bounds = regionToBounds(visibleRegion);

    const unsub = subscribeToParkingReports(
      bounds,
      (reports) => setCloudReports(reports),
      (err) => console.log("Firestore error:", err),
    );

    return unsub;
  }, [visibleRegion]);

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

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
  }, [spots]);

  useEffect(() => {
    const unsub = onAuthStateChanged(FIREBASE_AUTH, (user) => {
      setUid(user?.uid ?? null);
    });
    return unsub;
  }, []);

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

  /* ---------- HANDLERS ---------- */
  const handleMapLongPress = async (event: any) => {
    // avoid starting new add while we are saving one
    if (isCreatingSpot) return;

    const { latitude, longitude } = event.nativeEvent.coordinate;

    // validate against OSM roads/parking (Overpass)
    try {
      const ok = await isNearRoadOrParkingOSM(latitude, longitude);
      if (!ok) {
        Alert.alert(
          "Not on a road/parking area",
          "Try placing the spot closer to a road or a parking lot/structure.",
        );
        return;
      }
    } catch {
      // If Overpass fails, allow but warn (keeps app usable)
      Alert.alert(
        "Could not verify location",
        "OSM check failed (network/rate-limit). Spot was allowed anyway.",
      );
    }

    setPendingCoord({ latitude, longitude });
    setSpotType("free");
    setRate("");
    setShowModal(true);
  };

  const handleRegionChangeComplete = (r: Region) => {
    if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
    regionDebounceRef.current = setTimeout(() => setVisibleRegion(r), 400);
  };

  const saveSpot = async () => {
    if (!pendingCoord) return;

    // prevent double tap
    if (isCreatingSpot) return;

    const totalSeconds = hours * 3600 + minutes * 60 + seconds;

    if (totalSeconds === 0) {
      Alert.alert("Invalid Duration", "Please set a duration greater than 0");
      return;
    }

    setIsCreatingSpot(true);

    const timestamp = Date.now();
    const id = `spot-${timestamp}-${Math.random()}`;

    const newSpot: ParkingSpot = {
      id,
      latitude: pendingCoord.latitude,
      longitude: pendingCoord.longitude,
      type: spotType,
      rate: spotType === "paid" ? rate.trim() : undefined,
      createdAt: timestamp,
      version: 0,
      durationSeconds: totalSeconds,
    };

    // Close modal immediately so UI feels responsive
    closeModal();

    await scheduleSpotNotification(id, totalSeconds, spotType);

    try {
      const firestoreId = await createParkingReport({
        latitude: newSpot.latitude,
        longitude: newSpot.longitude,
        type: newSpot.type,
        rate: newSpot.rate,
        durationSeconds: totalSeconds,
      });

      newSpot.firestoreId = firestoreId;
      setSpots((prev) => [...prev, newSpot]);

      const last: LastReported = {
        firestoreId,
        latitude: newSpot.latitude,
        longitude: newSpot.longitude,
        createdAt: Date.now(),
      };
      setLastReported(last);
      await AsyncStorage.setItem(LAST_REPORTED_KEY, JSON.stringify(last));
    } catch (e: any) {
      Alert.alert(
        "Firestore save failed",
        e?.message ? String(e.message) : JSON.stringify(e),
      );
      // keep local spot even if cloud fails
      setSpots((prev) => [...prev, newSpot]);
    } finally {
      setIsCreatingSpot(false);
    }
  };

  const closeModal = () => {
    Keyboard.dismiss();
    setShowModal(false);
    setPendingCoord(null);
    setHours(0);
    setMinutes(0);
    setSeconds(30);
  };

  const confirmRemoveSpot = (id: string) => {
    const spot = spots.find((s) => s.id === id);

    Alert.alert("Remove Spot?", "Permanently remove this marker?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          // Remove from local state immediately
          setSpots((prev) => prev.filter((s) => s.id !== id));

          const cloudId = spot?.firestoreId;
          if (cloudId) {
            // Hide cloud marker immediately so it cannot "pop back in"
            setHiddenCloudIds((prev) => {
              const next = new Set(prev);
              next.add(cloudId);
              return next;
            });

            try {
              await deleteParkingReport(cloudId);
            } catch (e: any) {
              // If delete fails, unhide and tell user
              setHiddenCloudIds((prev) => {
                const next = new Set(prev);
                next.delete(cloudId);
                return next;
              });

              Alert.alert(
                "Delete failed",
                e?.message ?? "Could not delete this spot from the cloud.",
              );
            }
          }
        },
      },
    ]);
  };

  const handleSignOut = async () => {
    try {
      await signOut(FIREBASE_AUTH);
      Alert.alert("Signed Out", "You have been signed out successfully.");
    } catch (error: any) {
      Alert.alert("Error", error.message);
    }
  };

  /* ---------- RENDER HELPERS ---------- */
  const renderMarker = (data: any, isCloud: boolean) => {
    const coord = safeCoord(data.latitude, data.longitude);
    if (!coord) return null;

    if (isCloud && data.status === "resolved") return null;

    const duration = data.durationSeconds || 30;
    const { color, expired } = getPinStatus(data.createdAt, duration);

    if (expired) return null;

    return (
      <Marker
        key={`${isCloud ? "cloud" : "local"}-${data.id}`}
        coordinate={coord}
        onPress={() => setSelectedMarker({ data, isCloud })}
      >
        <View style={[styles.customPin, { backgroundColor: color }]}>
          <Text style={styles.pinText}>{data.type === "free" ? "F" : "$"}</Text>
        </View>
      </Marker>
    );
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={true}
        followsUserLocation={false}
        onLongPress={handleMapLongPress}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {spots.map((spot) => renderMarker(spot, false))}

        {cloudReports
          .filter((r) => !hiddenCloudIds.has(r.id))
          .filter((r) => !spots.some((s) => s.firestoreId === r.id))
          .map((r) => renderMarker(r, true))}
      </MapView>

      {/* NEW: tiny loading pill */}
      {(isCreatingSpot || isAutoTaking) && (
        <View style={styles.busyPill}>
          <ActivityIndicator size="small" color="#000" />
          <Text style={styles.busyPillText}>
            {isCreatingSpot ? "Saving spot..." : "Updating..."}
          </Text>
        </View>
      )}

      {undoState && (
        <View style={styles.undoBanner}>
          <Text style={styles.undoText}>
            Marked as taken. Undo? (
            {Math.max(0, Math.ceil((undoState.expiresAt - Date.now()) / 1000))}
            s)
          </Text>

          <TouchableOpacity
            style={[styles.undoBtn, undoState.isProcessing && { opacity: 0.6 }]}
            onPress={undoAutoTaken}
            disabled={undoState.isProcessing}
          >
            <Text style={styles.undoBtnText}>
              {undoState.isProcessing ? "Undoing..." : "UNDO"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.colorGuide}>
        <Text style={styles.guideTitle}>Status</Text>
        <View style={styles.colorRow}>
          <View style={[styles.colorDot, { backgroundColor: "#00FF00" }]} />
          <Text style={styles.guideText}>Active</Text>
        </View>
        <View style={styles.colorRow}>
          <View style={[styles.colorDot, { backgroundColor: "#FF0000" }]} />
          <Text style={styles.guideText}>Expiring Soon</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.historyBtn}
        onPress={() => setShowHistory(true)}
      >
        <Text style={styles.historyBtnText}>My History</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.historyBtn, { top: 100 }]}
        onPress={handleSignOut}
      >
        <Text style={styles.historyBtnText}>Sign Out</Text>
      </TouchableOpacity>

      {autoTakenBanner && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{autoTakenBanner}</Text>
        </View>
      )}

      {/* --- MARKER INFO MODAL --- */}
      <Modal
        visible={selectedMarker !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedMarker(null)}
      >
        <TouchableOpacity
          style={styles.markerModalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedMarker(null)}
        >
          <View style={styles.markerModalContent}>
            {selectedMarker &&
              (() => {
                const data = selectedMarker.data;
                const isCloud = selectedMarker.isCloud;
                const duration = data.durationSeconds || 30;
                const age = getAgeInSeconds(data.createdAt);
                const formattedTime = formatDuration(age);
                const timeRemaining = formatDuration(duration - age);
                const warningThreshold = Math.floor(duration * 0.9);
                const warning = age >= warningThreshold;

                return (
                  <>
                    <Text
                      style={[
                        styles.markerModalTitle,
                        warning && { color: "red" },
                      ]}
                    >
                      {warning
                        ? "⚠️ Expiring Soon!"
                        : data.type === "free"
                          ? "Free Spot"
                          : `Paid: ${data.rate}`}
                    </Text>
                    <Text style={styles.markerModalText}>
                      Age: {formattedTime}
                    </Text>
                    <Text style={styles.markerModalText}>
                      Time Left: {timeRemaining}
                    </Text>

                    {!isCloud && (
                      <TouchableOpacity
                        style={styles.removeButton}
                        onPress={() => {
                          setSelectedMarker(null);
                          confirmRemoveSpot(data.id);
                        }}
                      >
                        <Text style={styles.removeButtonText}>Remove Spot</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={styles.closeButton}
                      onPress={() => setSelectedMarker(null)}
                    >
                      <Text style={styles.closeButtonText}>Close</Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* --- HISTORY MODAL --- */}
      <Modal visible={showHistory} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { maxHeight: "80%" }]}>
            <Text style={styles.modalTitle}>My Report History</Text>

            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>Type</Text>
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historyType === "all" && styles.pillActive,
                  ]}
                  onPress={() => setHistoryType("all")}
                >
                  <Text style={styles.pillText}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historyType === "free" && styles.pillActive,
                  ]}
                  onPress={() => setHistoryType("free")}
                >
                  <Text style={styles.pillText}>Free</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historyType === "paid" && styles.pillActive,
                  ]}
                  onPress={() => setHistoryType("paid")}
                >
                  <Text style={styles.pillText}>Paid</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.filterLabel}>Status</Text>
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historyStatus === "all" && styles.pillActive,
                  ]}
                  onPress={() => setHistoryStatus("all")}
                >
                  <Text style={styles.pillText}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historyStatus === "open" && styles.pillActive,
                  ]}
                  onPress={() => setHistoryStatus("open")}
                >
                  <Text style={styles.pillText}>Open</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historyStatus === "resolved" && styles.pillActive,
                  ]}
                  onPress={() => setHistoryStatus("resolved")}
                >
                  <Text style={styles.pillText}>Resolved</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.filterLabel}>Range</Text>
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historyRange === "all" && styles.pillActive,
                  ]}
                  onPress={() => setHistoryRange("all")}
                >
                  <Text style={styles.pillText}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historyRange === "24h" && styles.pillActive,
                  ]}
                  onPress={() => setHistoryRange("24h")}
                >
                  <Text style={styles.pillText}>24h</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historyRange === "7d" && styles.pillActive,
                  ]}
                  onPress={() => setHistoryRange("7d")}
                >
                  <Text style={styles.pillText}>7d</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historyRange === "30d" && styles.pillActive,
                  ]}
                  onPress={() => setHistoryRange("30d")}
                >
                  <Text style={styles.pillText}>30d</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.filterLabel}>Sort</Text>
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historySort === "newest" && styles.pillActive,
                  ]}
                  onPress={() => setHistorySort("newest")}
                >
                  <Text style={styles.pillText}>Newest</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historySort === "oldest" && styles.pillActive,
                  ]}
                  onPress={() => setHistorySort("oldest")}
                >
                  <Text style={styles.pillText}>Oldest</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historySort === "paidFirst" && styles.pillActive,
                  ]}
                  onPress={() => setHistorySort("paidFirst")}
                >
                  <Text style={styles.pillText}>Paid first</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pill,
                    historySort === "freeFirst" && styles.pillActive,
                  ]}
                  onPress={() => setHistorySort("freeFirst")}
                >
                  <Text style={styles.pillText}>Free first</Text>
                </TouchableOpacity>
              </View>
            </View>

            <FlatList
              data={filteredMyReports}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={{ textAlign: "center" }}>No reports yet.</Text>
              }
              renderItem={({ item }) => {
                const ageSeconds = getAgeInSeconds(item.createdAt);
                const duration = item.durationSeconds || 30;
                const isExpired = ageSeconds >= duration;

                const durationText = isExpired
                  ? formatDuration(duration)
                  : formatDuration(ageSeconds);

                const statusLabel = isExpired ? "Expired" : "Active";
                const statusColor = isExpired ? "#999" : "green";

                const label =
                  item.type === "free"
                    ? "Free Spot"
                    : `Paid Spot${item.rate ? `: ${item.rate}` : ""}`;

                return (
                  <TouchableOpacity
                    style={[
                      styles.historyRow,
                      isExpired && styles.historyRowExpired,
                    ]}
                    disabled={isExpired}
                    onPress={() => {
                      if (!isExpired) {
                        mapRef.current?.animateToRegion(
                          {
                            latitude: item.latitude,
                            longitude: item.longitude,
                            latitudeDelta: 0.01,
                            longitudeDelta: 0.01,
                          },
                          350,
                        );
                        setShowHistory(false);
                      }
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                      }}
                    >
                      <Text
                        style={[
                          styles.historyTitle,
                          isExpired && { color: "#666" },
                        ]}
                      >
                        {label}
                      </Text>
                      <Text style={{ fontWeight: "bold", color: statusColor }}>
                        {statusLabel}
                      </Text>
                    </View>

                    <Text style={styles.historySub}>
                      Alive for: {durationText}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />

            <TouchableOpacity onPress={() => setShowHistory(false)}>
              <Text style={styles.cancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* --- NEW SPOT MODAL --- */}
      <Modal visible={showModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>New Parking Spot</Text>

            <View style={styles.typeRow}>
              <TouchableOpacity
                style={[
                  styles.typeButton,
                  spotType === "free" && styles.freeSelected,
                ]}
                onPress={() => setSpotType("free")}
                disabled={isCreatingSpot}
              >
                <Text>Free</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.typeButton,
                  spotType === "paid" && styles.paidSelected,
                ]}
                onPress={() => setSpotType("paid")}
                disabled={isCreatingSpot}
              >
                <Text>Paid</Text>
              </TouchableOpacity>
            </View>

            {spotType === "paid" && (
              <TextInput
                placeholder="Rate"
                value={rate}
                onChangeText={setRate}
                style={styles.input}
                editable={!isCreatingSpot}
              />
            )}

            <Text style={styles.durationLabel}>Duration:</Text>
            <View style={styles.pickerContainer}>
              <View style={styles.pickerColumn}>
                <Text style={styles.pickerColumnLabel}>Hours</Text>
                <ScrollView
                  style={styles.picker}
                  showsVerticalScrollIndicator={false}
                >
                  {Array.from({ length: 25 }, (_, i) => i).map((h) => (
                    <TouchableOpacity
                      key={`h-${h}`}
                      style={[
                        styles.pickerItem,
                        hours === h && styles.pickerItemSelected,
                      ]}
                      onPress={() => setHours(h)}
                      disabled={isCreatingSpot}
                    >
                      <Text
                        style={[
                          styles.pickerItemText,
                          hours === h && styles.pickerItemTextSelected,
                        ]}
                      >
                        {h}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.pickerColumn}>
                <Text style={styles.pickerColumnLabel}>Minutes</Text>
                <ScrollView
                  style={styles.picker}
                  showsVerticalScrollIndicator={false}
                >
                  {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                    <TouchableOpacity
                      key={`m-${m}`}
                      style={[
                        styles.pickerItem,
                        minutes === m && styles.pickerItemSelected,
                      ]}
                      onPress={() => setMinutes(m)}
                      disabled={isCreatingSpot}
                    >
                      <Text
                        style={[
                          styles.pickerItemText,
                          minutes === m && styles.pickerItemTextSelected,
                        ]}
                      >
                        {m}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.pickerColumn}>
                <Text style={styles.pickerColumnLabel}>Seconds</Text>
                <ScrollView
                  style={styles.picker}
                  showsVerticalScrollIndicator={false}
                >
                  {Array.from({ length: 60 }, (_, i) => i).map((s) => (
                    <TouchableOpacity
                      key={`s-${s}`}
                      style={[
                        styles.pickerItem,
                        seconds === s && styles.pickerItemSelected,
                      ]}
                      onPress={() => setSeconds(s)}
                      disabled={isCreatingSpot}
                    >
                      <Text
                        style={[
                          styles.pickerItemText,
                          seconds === s && styles.pickerItemTextSelected,
                        ]}
                      >
                        {s}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>

            <Text style={styles.durationPreview}>
              Total: {formatDuration(hours * 3600 + minutes * 60 + seconds)}
            </Text>

            <TouchableOpacity
              style={[styles.saveButton, isCreatingSpot && { opacity: 0.6 }]}
              onPress={saveSpot}
              disabled={isCreatingSpot}
            >
              <Text style={styles.saveText}>
                {isCreatingSpot ? "Saving..." : "Save"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={closeModal} disabled={isCreatingSpot}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  errorText: { color: "red" },
  customPin: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: "white",
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  pinText: { color: "white", fontWeight: "bold" },

  // NEW: small busy pill
  busyPill: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    elevation: 6,
  },
  busyPillText: {
    marginLeft: 8,
    fontWeight: "600",
  },

  colorGuide: {
    position: "absolute",
    bottom: 20,
    left: 20,
    backgroundColor: "white",
    padding: 10,
    borderRadius: 20,
    elevation: 5,
  },
  guideTitle: { fontSize: 10, fontWeight: "bold", marginBottom: 5 },
  colorRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  guideText: { fontSize: 10, marginLeft: 5 },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    width: "85%",
    maxHeight: "85%",
    backgroundColor: "white",
    padding: 20,
    borderRadius: 15,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 15,
  },
  typeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  typeButton: {
    padding: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    width: "45%",
    alignItems: "center",
  },
  freeSelected: { backgroundColor: "#c8e6c9" },
  paidSelected: { backgroundColor: "#ffcdd2" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 10,
    borderRadius: 8,
    marginBottom: 15,
  },
  durationLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
    marginTop: 5,
  },
  pickerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
    height: 150,
  },
  pickerColumn: {
    flex: 1,
    marginHorizontal: 5,
  },
  pickerColumnLabel: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 5,
    color: "#666",
  },
  picker: {
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "#f9f9f9",
  },
  pickerItem: {
    padding: 8,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  pickerItemSelected: {
    backgroundColor: "#007AFF",
  },
  pickerItemText: {
    fontSize: 16,
    color: "#333",
  },
  pickerItemTextSelected: {
    color: "white",
    fontWeight: "bold",
  },
  durationPreview: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
    color: "#007AFF",
    marginBottom: 15,
  },
  saveButton: { backgroundColor: "#007AFF", padding: 12, borderRadius: 8 },
  saveText: { color: "white", textAlign: "center", fontWeight: "bold" },
  cancelText: { textAlign: "center", marginTop: 15, color: "#666" },
  historyBtn: {
    position: "absolute",
    top: 50,
    right: 20,
    backgroundColor: "white",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    elevation: 5,
  },
  historyBtnText: { fontWeight: "bold" },
  markerModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  markerModalContent: {
    backgroundColor: "white",
    borderRadius: 15,
    padding: 20,
    width: "80%",
    maxWidth: 300,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  markerModalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 15,
    textAlign: "center",
    color: "#000",
  },
  markerModalText: {
    fontSize: 16,
    marginBottom: 8,
    color: "#333",
  },
  removeButton: {
    backgroundColor: "#FF3B30",
    padding: 12,
    borderRadius: 8,
    marginTop: 15,
  },
  removeButtonText: {
    color: "white",
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 16,
  },
  closeButton: {
    marginTop: 10,
    padding: 10,
  },
  closeButtonText: {
    color: "#007AFF",
    textAlign: "center",
    fontSize: 16,
  },
  historyRow: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  historyRowExpired: {
    backgroundColor: "#f5f5f5",
    borderColor: "#ddd",
  },
  historyTitle: { fontWeight: "bold" },
  historySub: { color: "#666", marginTop: 4, fontSize: 12 },
  banner: {
    position: "absolute",
    top: 140,
    left: 20,
    right: 20,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "white",
    elevation: 6,
  },
  bannerText: {
    textAlign: "center",
    fontWeight: "600",
  },
  filterBlock: { marginBottom: 12 },
  filterLabel: { fontWeight: "bold", marginTop: 8, marginBottom: 6 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    borderWidth: 1,
    borderColor: "#ddd",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  pillActive: { backgroundColor: "#e8f0ff", borderColor: "#9bbcff" },
  pillText: { fontSize: 12 },
  undoBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  undoText: { color: "white", flex: 1, marginRight: 12 },
  undoBtn: {
    backgroundColor: "white",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  undoBtnText: { fontWeight: "800" },
});
