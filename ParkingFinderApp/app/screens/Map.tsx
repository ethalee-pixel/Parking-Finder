import React, { useEffect, useState, useRef } from "react";
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
} from "react-native";
import MapView, {
  Region,
  Marker,
  MapPressEvent,
  Callout,
} from "react-native-maps";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createParkingReport,
  subscribeToParkingReports,
  subscribeToMyParkingReports,
  ParkingReport,
} from "../../parkingReports";
import { FIREBASE_AUTH } from "../../FirebaseConfig";
import { onAuthStateChanged } from "firebase/auth";

type ParkingSpot = {
  id: string;
  latitude: number;
  longitude: number;
  type: "free" | "paid";
  rate?: string;
  createdAt: any; // Firestore Timestamp OR number
  version: number;
};

const STORAGE_KEY = "@parking_spots";

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [tick, setTick] = useState(0);
  const [cloudReports, setCloudReports] = useState<ParkingReport[]>([]);

  const [pendingCoord, setPendingCoord] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [spotType, setSpotType] = useState<"free" | "paid">("free");
  const [rate, setRate] = useState("");
  const [showModal, setShowModal] = useState(false);

  // My reports history
  const [myReports, setMyReports] = useState<ParkingReport[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [uid, setUid] = useState<string | null>(
    FIREBASE_AUTH.currentUser?.uid ?? null,
  );

  // ---- Coordinate firewall (prevents AIRMapMarker crashes) ----
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

  /* ---------- HELPER: Parse Time for Firestore & JS ---------- */
  const getTimeInMillis = (timeData: any) => {
    if (!timeData) return Date.now();
    // Handle Firestore Timestamp {seconds, nanoseconds}
    if (timeData.seconds) return timeData.seconds * 1000;
    // Handle standard JS Date/Number
    return typeof timeData === "number"
      ? timeData
      : new Date(timeData).getTime();
  };

  const getPinColor = (createdAt: any): string => {
    const timeInMillis = getTimeInMillis(createdAt);
    const ageInSeconds = Math.floor((Date.now() - timeInMillis) / 1000);

    if (ageInSeconds < 10) return "#00FF00"; // Fresh (Green)
    if (ageInSeconds < 20) return "#FFFF00"; // Stale (Yellow)
    if (ageInSeconds < 30) return "#FFA500"; // Old (Orange)
    return "#FF0000"; // Unreliable (Red)
  };

  /* ---------- TIMERS & SUBSCRIPTIONS ---------- */
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setError("Location permission denied.");
          return;
        }

        const savedSpots = await AsyncStorage.getItem(STORAGE_KEY);
        if (savedSpots) {
          const parsed = JSON.parse(savedSpots);
          if (Array.isArray(parsed)) {
            // Sanitize spots loaded from storage so one bad record never crashes the map
            const cleaned: ParkingSpot[] = parsed
              .map((spot: any) => {
                const coord = safeCoord(spot.latitude, spot.longitude);
                if (!coord) {
                  console.warn("Dropping bad LOCAL spot from storage:", spot);
                  return null;
                }
                return {
                  ...spot,
                  latitude: coord.latitude,
                  longitude: coord.longitude,
                  version: 0,
                } as ParkingSpot;
              })
              .filter((s): s is ParkingSpot => s !== null);

            setSpots(cleaned);

            // Optional but recommended: rewrite cleaned storage to prevent future crashes
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
          }
        }

        const loc = await Location.getCurrentPositionAsync({});
        const initialRegion = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        };
        setRegion(initialRegion);
      } catch (err) {
        setError("Failed to initialize");
      }
    })();
  }, []);

  useEffect(() => {
    const unsub = subscribeToParkingReports(
      (reports) => setCloudReports(reports),
      (err) => console.log("Firestore error:", err),
    );
    return unsub;
  }, []);

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

  /* ---------- HANDLERS ---------- */
  const handleMapLongPress = (event: any) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setPendingCoord({ latitude, longitude });
    setSpotType("free");
    setRate("");
    setShowModal(true);
  };

  const saveSpot = async () => {
    if (!pendingCoord) return;
    const timestamp = Date.now();

    const newSpot: ParkingSpot = {
      id: `spot-${timestamp}-${Math.random()}`,
      latitude: pendingCoord.latitude,
      longitude: pendingCoord.longitude,
      type: spotType,
      rate: spotType === "paid" ? rate.trim() : undefined,
      createdAt: timestamp,
      version: 0,
    };

    setSpots((prev) => [...prev, newSpot]);
    closeModal();

    try {
      // IMPORTANT: do NOT send createdAt here; parkingReports.ts uses serverTimestamp()
      await createParkingReport({
        latitude: newSpot.latitude,
        longitude: newSpot.longitude,
        type: newSpot.type,
        rate: newSpot.rate,
      });
    } catch (e) {
      console.log("Cloud save failed", e);
    }
  };

  const closeModal = () => {
    Keyboard.dismiss();
    setShowModal(false);
    setPendingCoord(null);
  };

  const confirmRemoveSpot = (id: string) => {
    Alert.alert("Remove Spot?", "Permanently remove this marker?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => setSpots((prev) => prev.filter((s) => s.id !== id)),
      },
    ]);
  };

  if (error)
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );

  if (!region)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text>Locating...</Text>
      </View>
    );

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        showsUserLocation
        onLongPress={handleMapLongPress}
      >
        {/* LOCAL SPOTS */}
        {spots.map((spot) => {
          const coord = safeCoord(spot.latitude, spot.longitude);
          if (!coord) return null;

          const color = getPinColor(spot.createdAt);
          const age = Math.floor(
            (Date.now() - getTimeInMillis(spot.createdAt)) / 1000,
          );

          return (
            <Marker
              key={`${spot.id}-v${spot.version}-t${tick}`}
              coordinate={coord}
              onCalloutPress={() => confirmRemoveSpot(spot.id)}
            >
              <View style={[styles.customPin, { backgroundColor: color }]}>
                <Text style={styles.pinText}>
                  {spot.type === "free" ? "F" : "$"}
                </Text>
              </View>
              <Callout>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle}>
                    {spot.type === "free" ? "Free Spot" : `Paid: ${spot.rate}`}
                  </Text>
                  <Text>Age: {age}s (Local)</Text>
                  <Text style={styles.removeHint}>Tap to Remove</Text>
                </View>
              </Callout>
            </Marker>
          );
        })}

        {/* CLOUD REPORTS */}
        {cloudReports
          //.filter((r) => r.userId !== FIREBASE_AUTH.currentUser?.uid) // Only others
          // When relaunching the app, it doesn't show my own local reports, so commented out the above line to show all reports including mine.
          // likely want to differentiate own spots visually or allow toggling them on/off rather than hiding all of them
          // figure out later
          .map((r) => {
            const coord = safeCoord(r.latitude, r.longitude);
            if (!coord) {
              console.warn("Dropping bad CLOUD report:", r);
              return null;
            }

            const color = getPinColor(r.createdAt);
            const age = Math.floor(
              (Date.now() - getTimeInMillis(r.createdAt)) / 1000,
            );

            return (
              <Marker key={`cloud-${r.id}-t${tick}`} coordinate={coord}>
                <View
                  style={[
                    styles.customPin,
                    { backgroundColor: color, opacity: 0.8 },
                  ]}
                >
                  <Text style={styles.pinText}>
                    {r.type === "free" ? "F" : "$"}
                  </Text>
                </View>
                <Callout>
                  <View style={styles.callout}>
                    <Text style={styles.calloutTitle}>
                      Other Driver&apos;s Report
                    </Text>
                    <Text>
                      {r.type === "free" ? "Free Parking" : `Paid: ${r.rate}`}
                    </Text>
                    <Text>Age: {age}s</Text>
                  </View>
                </Callout>
              </Marker>
            );
          })}
      </MapView>

      <View style={styles.colorGuide}>
        <Text style={styles.guideTitle}>Freshness (0s → 30s+)</Text>
        <View style={styles.colorRow}>
          <View style={[styles.colorDot, { backgroundColor: "#00FF00" }]} />
          <View style={[styles.colorDot, { backgroundColor: "#FFFF00" }]} />
          <View style={[styles.colorDot, { backgroundColor: "#FFA500" }]} />
          <View style={[styles.colorDot, { backgroundColor: "#FF0000" }]} />
        </View>
      </View>

      <TouchableOpacity
        style={styles.historyBtn}
        onPress={() => setShowHistory(true)}
      >
        <Text style={styles.historyBtnText}>My History</Text>
      </TouchableOpacity>

      <Modal visible={showHistory} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { maxHeight: "80%" }]}>
            <Text style={styles.modalTitle}>My Report History</Text>

            <FlatList
              data={myReports}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={{ textAlign: "center" }}>No reports yet.</Text>
              }
              renderItem={({ item }) => {
                const created = item.createdAt?.seconds
                  ? new Date(item.createdAt.seconds * 1000)
                  : item.createdAt
                    ? new Date(item.createdAt)
                    : null;

                const label =
                  item.type === "free"
                    ? "Free Spot"
                    : `Paid Spot${item.rate ? `: ${item.rate}` : ""}`;

                return (
                  <TouchableOpacity
                    style={styles.historyRow}
                    onPress={() => {
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
                    }}
                  >
                    <Text style={styles.historyTitle}>{label}</Text>
                    <Text style={styles.historySub}>
                      {created ? created.toLocaleString() : "Unknown time"} •{" "}
                      {item.status}
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
              >
                <Text>Free</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.typeButton,
                  spotType === "paid" && styles.paidSelected,
                ]}
                onPress={() => setSpotType("paid")}
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
              />
            )}

            <TouchableOpacity style={styles.saveButton} onPress={saveSpot}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={closeModal}>
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
  callout: { padding: 10, alignItems: "center", minWidth: 120 },
  calloutTitle: { fontWeight: "bold", marginBottom: 5 },
  removeHint: { color: "red", fontSize: 10, marginTop: 5 },
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
  colorRow: { flexDirection: "row", gap: 8 },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    width: "80%",
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
  historyRow: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  historyTitle: { fontWeight: "bold" },
  historySub: { color: "#666", marginTop: 4, fontSize: 12 },
});
