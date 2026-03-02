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

const NEARBY_TAKEN_RADIUS_M = 75;

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const didCenterOnUserRef = useRef(false);
  const userPosRef = useRef<{ lat: number; lon: number } | null>(null);

  const [recentlyTakenIds, setRecentlyTakenIds] = useState<Set<string>>(new Set());
  const [hasManuallyTakenASpot, setHasManuallyTakenASpot] = useState(false);
  const [takenByMeIds, setTakenByMeIds] = useState<Set<string>>(new Set());
  const [manualTakenReportId, setManualTakenReportId] = useState<string | null>(null);

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
  const [tick, setTick] = useState(0);
  const [hiddenCloudIds, setHiddenCloudIds] = useState<Set<string>>(new Set());
  const alertedIds = useRef<Set<string>>(new Set());
  const [pendingCoord, setPendingCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isCreatingSpot, setIsCreatingSpot] = useState(false);
  const [isAutoTaking, setIsAutoTaking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [uid, setUid] = useState<string | null>(FIREBASE_AUTH.currentUser?.uid ?? null);
  const [myTakenReportId, setMyTakenReportId] = useState<string | null>(null);
  const [selectedMarker, setSelectedMarker] = useState<{ data: any; isCloud: boolean } | null>(null);
  const [lastReported, setLastReported] = useState<LastReported | null>(null);
  const [autoTakenBanner, setAutoTakenBanner] = useState<string | null>(null);

  const { undoState, showUndoBanner, undoAutoTaken } = useUndoState(
    myTakenReportId,
    setMyTakenReportId,
    manualTakenReportId,
    setHasManuallyTakenASpot,
    setManualTakenReportId,
  );

  const { cloudReports, myReports } = useParkingReports(visibleRegion, uid);

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
            `Your ${spotLabel} parking spot will expire in ${formatDuration(timeRemaining)}!`,
            [{ text: "OK" }],
          );

          alertedIds.current.add(spot.id);
        }
      }
    }

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
      if (myTakenReportId === reportId) setMyTakenReportId(null);
      setTakenByMeIds((prev) => {
        const next = new Set(prev);
        next.delete(reportId);
        return next;
      });

      if (manualTakenReportId === reportId) {
        setHasManuallyTakenASpot(false);
        setManualTakenReportId(null);
      }

      Alert.alert("Reopened", "This spot is open again.");
    } catch (e: any) {
      Alert.alert("Failed", e?.message ?? "Could not reopen this report.");
    }
  };

  const manualMarkTaken = async (
    reportId: string,
    reportLat: number,
    reportLon: number,
  ) => {
    if (!uid) {
      Alert.alert("Not signed in", "Please sign in to mark a spot as taken.");
      return;
    }

    if (hasManuallyTakenASpot) {
      Alert.alert("Limit reached", "You already marked one spot as taken.");
      return;
    }

    const { ok, dist } = isNearMe(userPosRef.current, reportLat, reportLon, NEARBY_TAKEN_RADIUS_M);
    if (!ok) {
      Alert.alert(
        "Too far away",
        `You must be within ${NEARBY_TAKEN_RADIUS_M}m to mark this taken.\n\nDistance: ${Math.round(dist)}m`,
      );
      return;
    }

    if (isAutoTaking) return;

    setIsAutoTaking(true);
    try {
      await markReportTaken(reportId, uid);
      setMyTakenReportId(reportId);
      setTakenByMeIds((prev) => new Set(prev).add(reportId));

      setHasManuallyTakenASpot(true);
      setManualTakenReportId(reportId);

      showUndoBanner(reportId);

      Alert.alert("Marked taken", "This spot was marked as taken.");
    } catch (e: any) {
      Alert.alert("Failed", e?.message ?? "Could not mark as taken.");
    } finally {
      setIsAutoTaking(false);
    }
  };

  const confirmRemoveSpot = (id: string) => {
    const spot = spots.find((s) => s.id === id);

    Alert.alert("Remove Spot?", "Permanently remove this marker?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setSpots((prev) => prev.filter((s) => s.id !== id));

          const cloudId = spot?.firestoreId;
          if (cloudId) {
            setHiddenCloudIds((prev) => {
              const next = new Set(prev);
              next.add(cloudId);
              return next;
            });

            try {
              await deleteParkingReport(cloudId);
            } catch (e: any) {
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

  const renderMarker = (data: any, isCloud: boolean) => {
    const coord = safeCoord(data.latitude, data.longitude);
    if (!coord) return null;

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

    if (!isCloud && expired) return null;
    if (isCloud && expired) return null;

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

  // Effects
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

  useEffect(() => {
    if (!autoTakenBanner) return;
    const t = setTimeout(() => setAutoTakenBanner(null), 4000);
    return () => clearTimeout(t);
  }, [autoTakenBanner]);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(MY_TAKEN_KEY);
      if (saved) setMyTakenReportId(saved);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await requestNotificationPermissions();

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

  useEffect(() => {
    if (!uid || !myTakenReportId) return;
    const r = cloudReports.find((x) => x.id === myTakenReportId);
    if (!r) return;
    const stillMine = r.status === "resolved" && (r as any).resolvedBy === uid;
    if (!stillMine) setMyTakenReportId(null);
  }, [cloudReports, uid, myTakenReportId]);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
  }, [spots]);

  useEffect(() => {
    if (myTakenReportId) AsyncStorage.setItem(MY_TAKEN_KEY, myTakenReportId);
    else AsyncStorage.removeItem(MY_TAKEN_KEY);
  }, [myTakenReportId]);

  useEffect(() => {
    const unsub = onAuthStateChanged(FIREBASE_AUTH, (user) => {
      setUid(user?.uid ?? null);
    });
    return unsub;
  }, []);

  const handleMapLongPress = async (event: any) => {
    if (isCreatingSpot) return;

    const { latitude, longitude } = event.nativeEvent.coordinate;

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
      Alert.alert(
        "Could not verify location",
        "OSM check failed (network/rate-limit). Spot was allowed anyway.",
      );
    }

    setPendingCoord({ latitude, longitude });
    setShowModal(true);
  };

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
        showsUserLocation
        showsMyLocationButton={true}
        followsUserLocation={false}
        onLongPress={handleMapLongPress}
        onRegionChangeComplete={handleRegionChangeComplete}
        onMapReady={() => {
          centerOnUser();
        }}
      >
        {spots.map((spot) => renderMarker(spot, false))}

        {cloudReports
          .filter((r) => !hiddenCloudIds.has(r.id))
          .filter((r) => !spots.some((s) => s.firestoreId === r.id))
          .map((r) => renderMarker(r, true))}
      </MapView>

      <MapOverlays
        isCreatingSpot={isCreatingSpot}
        isAutoTaking={isAutoTaking}
        undoState={undoState}
        autoTakenBanner={autoTakenBanner}
        onUndo={undoAutoTaken}
        onShowHistory={() => setShowHistory(true)}
        onSignOut={handleSignOut}
      />

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

      <HistoryModal
        showHistory={showHistory}
        myReports={myReports}
        mapRef={mapRef}
        setShowHistory={setShowHistory}
      />

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