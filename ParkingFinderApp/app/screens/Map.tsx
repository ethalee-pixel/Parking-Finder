// Main map screen - the core of the app. Renders the map, all markers,
// and wires together all hooks and modals.

import React, { useRef, useState, useEffect } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import MapView, { Region, Marker } from "react-native-maps";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { deleteParkingReport, markReportTaken, ParkingReport } from "../../parkingReports";
import { FIREBASE_AUTH, FIRESTORE_DB } from "../../FirebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { ParkingSpot, LastReported, STORAGE_KEY, LAST_REPORTED_KEY, MY_TAKEN_KEY } from "../../types/parking";
import { safeCoord, isNearMe, isNearRoadOrParkingOSM } from "../../utils/geo";
import { getPinStatus, getAgeInSeconds, formatDuration } from "../../utils/time";
import { requestNotificationPermissions } from "../../utils/notifications";
import { useLocationTracking } from "../../hooks/useLocationTracking";
import { useParkingReports } from "../../hooks/useParkingReports";
import { useUndoState } from "../../hooks/useUndoState";
import { MarkerInfoModal } from "../../components/MarkerInfoModal";
import { HistoryModal } from "../../components/HistoryModal";
import { NewSpotModal } from "../../components/NewSpotModal";
import { MapOverlays } from "../../components/MapOverlays";

// How close (in meters) the user must be to manually mark a spot as taken
const NEARBY_TAKEN_RADIUS_M = 75;

export default function MapScreen() {
  // Ref to the MapView so we can call animateToRegion programmatically
  const mapRef = useRef<MapView>(null);
  // Prevents re-centering on the user's location after the first time
  const didCenterOnUserRef = useRef(false);
  // Stores the latest known user GPS position for proximity checks
  const userPosRef = useRef<{ lat: number; lon: number } | null>(null);

  // IDs of spots that were just marked taken - briefly shows a big red T
  const [recentlyTakenIds, setRecentlyTakenIds] = useState<Set<string>>(new Set());
  // Prevents a user from manually marking more than one spot as taken per session
  const [hasManuallyTakenASpot, setHasManuallyTakenASpot] = useState(false);
  // All spot IDs the current user has marked as taken (for rendering the T marker)
  const [takenByMeIds, setTakenByMeIds] = useState<Set<string>>(new Set());
  // Tracks which specific report was manually taken, so undo can unlock it
  const [manualTakenReportId, setManualTakenReportId] = useState<string | null>(null);

  // Default map region centered on Santa Cruz, CA
  const [region, setRegion] = useState<Region>({
    latitude: 36.9741,
    longitude: -122.0308,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  // Tracks the currently visible map region for querying nearby reports
  const [visibleRegion, setVisibleRegion] = useState<Region>({
    latitude: 36.9741,
    longitude: -122.0308,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  // Used to debounce region change events so we don't query Firestore on every frame
  const regionDebounceRef = useRef<NodeJS.Timeout | null>(null);
  // Local parking spots saved to device storage
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  // Increments every second to drive the "game loop" for expiration checks
  const [tick, setTick] = useState(0);
  // Cloud report IDs to hide immediately after deletion (prevents flickering)
  const [hiddenCloudIds, setHiddenCloudIds] = useState<Set<string>>(new Set());
  // Tracks which spot IDs have already triggered an expiry alert so we don't spam
  const alertedIds = useRef<Set<string>>(new Set());
  // The map coordinate where the user long-pressed to place a new spot
  const [pendingCoord, setPendingCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  // Controls visibility of the new spot creation modal
  const [showModal, setShowModal] = useState(false);
  // Prevents double-tapping save while a spot is being created
  const [isCreatingSpot, setIsCreatingSpot] = useState(false);
  // Prevents concurrent auto-taken or manual-taken operations
  const [isAutoTaking, setIsAutoTaking] = useState(false);
  // Controls visibility of the report history modal
  const [showHistory, setShowHistory] = useState(false);
  // Current signed-in user's Firebase UID (null if not signed in)
  const [uid, setUid] = useState<string | null>(FIREBASE_AUTH.currentUser?.uid ?? null);
  // The Firestore report ID that this user currently has marked as taken
  const [myTakenReportId, setMyTakenReportId] = useState<string | null>(null);
  // The marker the user tapped on - drives the marker info modal
  const [selectedMarker, setSelectedMarker] = useState<{ data: any; isCloud: boolean } | null>(null);
  // The last spot this user reported - used for auto-taken proximity detection
  const [lastReported, setLastReported] = useState<LastReported | null>(null);
  // A temporary banner message shown after auto-taking a spot
  const [autoTakenBanner, setAutoTakenBanner] = useState<string | null>(null);

  // Hook that manages the undo banner state and timer for mark-taken actions
  const { undoState, showUndoBanner, undoAutoTaken } = useUndoState(
    myTakenReportId,
    setMyTakenReportId,
    manualTakenReportId,
    setHasManuallyTakenASpot,
    setManualTakenReportId,
  );

  // Hook that subscribes to Firestore parking reports in the visible map area
  const { cloudReports, myReports } = useParkingReports(visibleRegion, uid);

  // Hook that watches GPS position and auto-marks a spot as taken when the user arrives
  useLocationTracking(
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
  );

  // Briefly adds a spot ID to recentlyTakenIds to flash the big red T marker,
  // then removes it after 1.5 seconds
  const flashTakenT = (firestoreDocId: string) => {
    setRecentlyTakenIds((prev) => {
      const next = new Set(prev);
      next.add(firestoreDocId);
      return next;
    });
    setTimeout(() => {
      setRecentlyTakenIds((prev) => {
        const next = new Set(prev);
        next.delete(firestoreDocId);
        return next;
      });
    }, 1500);
  };

  // Called every tick (1s). Sends expiry warning alerts and removes expired local spots.
  const checkAlertsAndExpiration = () => {
    const allMySpots = [...spots, ...myReports];

    for (const spot of allMySpots) {
      const age = getAgeInSeconds(spot.createdAt);
      const duration = spot.durationSeconds || 30;
      // Warn at 90% of the spot's lifetime
      const warningThreshold = Math.floor(duration * 0.9);

      if (age >= warningThreshold && age < duration) {
        // Only alert once per spot per session
        if (!alertedIds.current.has(spot.id)) {
          const timeRemaining = duration - age;
          const spotLabel = spot.type === "free" ? "Free" : "Paid";

          Alert.alert(
            "⚠️ Parking Spot Expiring Soon",
            `Your ${spotLabel} parking spot will expire in ${formatDuration(timeRemaining)}!`,
            [{ text: "OK" }],
          );

          alertedIds.current.add(spot.id);
        }
      }
    }

    // Filter out any local spots that have fully expired
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

  // Resets a resolved Firestore report back to "open" so others can see it again
  const reopenReport = async (reportId: string) => {
    if (!uid) {
      Alert.alert("Not signed in", "Please sign in to reopen a spot.");
      return;
    }

    try {
      await updateDoc(doc(FIRESTORE_DB, "parkingReports", reportId), {
        status: "open",
        resolvedAt: null,
        resolvedBy: null,
      });
      // Clear the taken tracking state if this was our taken report
      if (myTakenReportId === reportId) setMyTakenReportId(null);
      setTakenByMeIds((prev) => {
        const next = new Set(prev);
        next.delete(reportId);
        return next;
      });

      // Unlock the one-taken-spot limit if this was the manually taken report
      if (manualTakenReportId === reportId) {
        setHasManuallyTakenASpot(false);
        setManualTakenReportId(null);
      }

      Alert.alert("Reopened", "This spot is open again.");
    } catch (e: any) {
      Alert.alert("Failed", e?.message ?? "Could not reopen this report.");
    }
  };

  // Allows the user to manually mark a cloud report as taken.
  // Enforces: must be signed in, haven't already taken one, and must be nearby.
  const manualMarkTaken = async (
    reportId: string,
    reportLat: number,
    reportLon: number,
  ) => {
    if (!uid) {
      Alert.alert("Not signed in", "Please sign in to mark a spot as taken.");
      return;
    }

    // One manual mark-taken per session limit
    if (hasManuallyTakenASpot) {
      Alert.alert("Limit reached", "You already marked one spot as taken.");
      return;
    }

    // Must be within NEARBY_TAKEN_RADIUS_M meters of the spot
    const { ok, dist } = isNearMe(userPosRef.current, reportLat, reportLon, NEARBY_TAKEN_RADIUS_M);
    if (!ok) {
      Alert.alert(
        "Too far away",
        `You must be within ${NEARBY_TAKEN_RADIUS_M}m to mark this taken.\n\nDistance: ${Math.round(dist)}m`,
      );
      return;
    }

    // Prevent concurrent taking operations
    if (isAutoTaking) return;

    setIsAutoTaking(true);
    try {
      await markReportTaken(reportId, uid);
      setMyTakenReportId(reportId);
      setTakenByMeIds((prev) => new Set(prev).add(reportId));

      // Lock manual taking and record which report was taken
      setHasManuallyTakenASpot(true);
      setManualTakenReportId(reportId);

      // Show the undo banner so the user can reverse within 45 seconds
      showUndoBanner(reportId);

      Alert.alert("Marked taken", "This spot was marked as taken.");
    } catch (e: any) {
      Alert.alert("Failed", e?.message ?? "Could not mark as taken.");
    } finally {
      setIsAutoTaking(false);
    }
  };

  // Shows a confirmation dialog before removing a local or cloud spot
  const confirmRemoveSpot = (id: string) => {
    const spot = spots.find((s) => s.id === id);

    Alert.alert("Remove Spot?", "Permanently remove this marker?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          // Remove from local state immediately for instant UI feedback
          setSpots((prev) => prev.filter((s) => s.id !== id));

          const cloudId = spot?.firestoreId;
          if (cloudId) {
            // Hide the cloud marker immediately to prevent it "coming back"
            setHiddenCloudIds((prev) => {
              const next = new Set(prev);
              next.add(cloudId);
              return next;
            });

            try {
              await deleteParkingReport(cloudId);
            } catch (e: any) {
              // If deletion fails, unhide the marker and inform the user
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

  // Signs the current user out of Firebase Auth
  const handleSignOut = async () => {
    try {
      await signOut(FIREBASE_AUTH);
      Alert.alert("Signed Out", "You have been signed out successfully.");
    } catch (error: any) {
      Alert.alert("Error", error.message);
    }
  };

  // Gets the user's current GPS location and animates the map to center on them
  const centerOnUser = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      const userRegion: Region = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      };

      setRegion(userRegion);
      mapRef.current?.animateToRegion(userRegion, 700);
    } catch (e) {
      console.log("centerOnUser failed:", e);
    }
  };

  // Renders a large red circle marker with a "T" to indicate a taken spot
  const renderTakenTMarker = (
    keyId: string,
    latitude: any,
    longitude: any,
    onPress?: () => void,
  ) => {
    const coord = safeCoord(latitude, longitude);
    if (!coord) return null;

    return (
      <Marker key={`taken-${keyId}`} coordinate={coord} onPress={onPress}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: "red",
            borderWidth: 3,
            borderColor: "white",
            justifyContent: "center",
            alignItems: "center",
            elevation: 8,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.3,
            shadowRadius: 4,
          }}
        >
          <Text style={{ color: "white", fontWeight: "900", fontSize: 30 }}>
            T
          </Text>
        </View>
      </Marker>
    );
  };

  // Renders a single map marker for either a local spot or a cloud report.
  // Resolved spots show a T marker (only if taken by the current user).
  // Active spots are colored green (fresh) or red (expiring soon).
  const renderMarker = (data: any, isCloud: boolean) => {
    const coord = safeCoord(data.latitude, data.longitude);
    if (!coord) return null;

    // Resolved cloud reports: only show the T marker if this user took it
    if (isCloud && data.status === "resolved") {
      const takenByMe = data.resolvedBy === uid || takenByMeIds.has(data.id);

      if (!takenByMe) return null;

      return renderTakenTMarker(
        data.id,
        coord.latitude,
        coord.longitude,
        () => setSelectedMarker({ data, isCloud: true }),
      );
    }

    const duration = data.durationSeconds || 30;
    const { color, expired } = getPinStatus(data.createdAt, duration);

    // Don't render expired markers
    if (!isCloud && expired) return null;
    if (isCloud && expired) return null;

    // Render a colored circle pin with F (free) or $ (paid)
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

  // ── EFFECTS ──────────────────────────────────────────────────────────────

  // Game loop: increments tick every second to drive expiration checks
  useEffect(() => {
    const interval = setInterval(() => setTick((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup: clears the region debounce timer on unmount
  useEffect(() => {
    return () => {
      if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
    };
  }, []);

  // Run expiration/alert checks every second
  useEffect(() => {
    checkAlertsAndExpiration();
  }, [tick]);

  // Auto-hide the auto-taken banner after 4 seconds
  useEffect(() => {
    if (!autoTakenBanner) return;
    const t = setTimeout(() => setAutoTakenBanner(null), 4000);
    return () => clearTimeout(t);
  }, [autoTakenBanner]);

  // On mount: restore the previously taken report ID from device storage
  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(MY_TAKEN_KEY);
      if (saved) setMyTakenReportId(saved);
    })();
  }, []);

  // On mount: request notification permissions, set up Android channel,
  // request location permission, restore saved spots and last reported spot,
  // and center the map on the user's location
  useEffect(() => {
    (async () => {
      try {
        await requestNotificationPermissions();

        // Android requires a notification channel to be created before scheduling
        if (typeof Notifications.setNotificationChannelAsync === "function") {
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

        // Restore any locally saved parking spots from AsyncStorage
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

        // Restore the last reported spot for auto-taken proximity tracking
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

            // Only center on the user once (on first load)
            if (!didCenterOnUserRef.current) {
              didCenterOnUserRef.current = true;
              setTimeout(() => {
                mapRef.current?.animateToRegion(userRegion, 700);
              }, 80);
            }
          } catch {
            // Fall back to default Santa Cruz region if location fails
            setRegion({ latitude: 36.9741, longitude: -122.0308, latitudeDelta: 0.01, longitudeDelta: 0.01 });
          }
        } else {
          setRegion({ latitude: 36.9741, longitude: -122.0308, latitudeDelta: 0.01, longitudeDelta: 0.01 });
        }
      } catch {
        setRegion({ latitude: 36.9741, longitude: -122.0308, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      }
    })();
  }, []);

  // Watches the cloud reports to verify our taken report is still ours.
  // Clears myTakenReportId if the report was un-resolved by someone else.
  useEffect(() => {
    if (!uid || !myTakenReportId) return;
    const r = cloudReports.find((x) => x.id === myTakenReportId);
    if (!r) return;
    const stillMine = r.status === "resolved" && (r as any).resolvedBy === uid;
    if (!stillMine) setMyTakenReportId(null);
  }, [cloudReports, uid, myTakenReportId]);

  // Persist local spots to AsyncStorage whenever the spots array changes
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
  }, [spots]);

  // Persist the taken report ID to AsyncStorage so it survives app restarts
  useEffect(() => {
    if (myTakenReportId) AsyncStorage.setItem(MY_TAKEN_KEY, myTakenReportId);
    else AsyncStorage.removeItem(MY_TAKEN_KEY);
  }, [myTakenReportId]);

  // Listen for Firebase auth state changes to keep uid in sync
  useEffect(() => {
    const unsub = onAuthStateChanged(FIREBASE_AUTH, (user) => {
      setUid(user?.uid ?? null);
    });
    return unsub;
  }, []);

  // Handles long-press on the map: validates the location is near a road/parking
  // via OpenStreetMap, then opens the new spot modal
  const handleMapLongPress = async (event: any) => {
    // Block if already saving a spot
    if (isCreatingSpot) return;

    const { latitude, longitude } = event.nativeEvent.coordinate;

    try {
      // Check against OpenStreetMap that this is a valid road/parking location
      const ok = await isNearRoadOrParkingOSM(latitude, longitude);
      if (!ok) {
        Alert.alert(
          "Not on a road/parking area",
          "Try placing the spot closer to a road or a parking lot/structure.",
        );
        return;
      }
    } catch {
      // If OSM check fails (network issue), allow the spot but warn the user
      Alert.alert(
        "Could not verify location",
        "OSM check failed (network/rate-limit). Spot was allowed anyway.",
      );
    }

    setPendingCoord({ latitude, longitude });
    setShowModal(true);
  };

  // Debounces the visible region update to avoid excessive Firestore queries
  const handleRegionChangeComplete = (r: Region) => {
    if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
    regionDebounceRef.current = setTimeout(() => setVisibleRegion(r), 400);
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        showsUserLocation           // Shows the blue dot for the user's location
        showsMyLocationButton={true}
        followsUserLocation={false}
        onLongPress={handleMapLongPress}
        onRegionChangeComplete={handleRegionChangeComplete}
        onMapReady={() => {
          centerOnUser(); // Center on user as soon as the map finishes loading
        }}
      >
        {/* Render local (device-saved) parking spots */}
        {spots.map((spot) => renderMarker(spot, false))}

        {/* Render cloud (Firestore) reports, excluding hidden and duplicate IDs */}
        {cloudReports
          .filter((r) => !hiddenCloudIds.has(r.id))
          .filter((r) => !spots.some((s) => s.firestoreId === r.id))
          .map((r) => renderMarker(r, true))}
      </MapView>

      {/* Overlays: busy spinner, undo banner, color legend, history/sign-out buttons */}
      <MapOverlays
        isCreatingSpot={isCreatingSpot}
        isAutoTaking={isAutoTaking}
        undoState={undoState}
        autoTakenBanner={autoTakenBanner}
        onUndo={undoAutoTaken}
        onShowHistory={() => setShowHistory(true)}
        onSignOut={handleSignOut}
      />

      {/* Modal shown when a marker is tapped - shows spot info and actions */}
      <MarkerInfoModal
        selectedMarker={selectedMarker}
        uid={uid}
        isAutoTaking={isAutoTaking}
        hasManuallyTakenASpot={hasManuallyTakenASpot}
        userPos={userPosRef.current}
        NEARBY_TAKEN_RADIUS_M={NEARBY_TAKEN_RADIUS_M}
        myTakenReportId={myTakenReportId}
        manualTakenReportId={manualTakenReportId}
        takenByMeIds={takenByMeIds}
        setSelectedMarker={setSelectedMarker}
        setHiddenCloudIds={setHiddenCloudIds}
        setTakenByMeIds={setTakenByMeIds}
        setHasManuallyTakenASpot={setHasManuallyTakenASpot}
        setManualTakenReportId={setManualTakenReportId}
        setMyTakenReportId={setMyTakenReportId}
        onConfirmRemoveSpot={confirmRemoveSpot}
        onManualMarkTaken={manualMarkTaken}
        onReopenReport={reopenReport}
      />

      {/* Modal showing the user's own report history with filters */}
      <HistoryModal
        showHistory={showHistory}
        myReports={myReports}
        mapRef={mapRef}
        setShowHistory={setShowHistory}
      />

      {/* Modal for creating a new parking spot after a long-press */}
      <NewSpotModal
        showModal={showModal}
        pendingCoord={pendingCoord}
        uid={uid}
        isCreatingSpot={isCreatingSpot}
        setIsCreatingSpot={setIsCreatingSpot}
        setShowModal={setShowModal}
        setPendingCoord={setPendingCoord}
        setSpots={setSpots}
        setMyTakenReportId={setMyTakenReportId}
        setTakenByMeIds={setTakenByMeIds}
        setHasManuallyTakenASpot={setHasManuallyTakenASpot}
        setManualTakenReportId={setManualTakenReportId}
        setLastReported={setLastReported}
        setAutoTakenBanner={setAutoTakenBanner}
        showUndoBanner={showUndoBanner}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  // Circular pin marker shown on the map for active spots
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
});