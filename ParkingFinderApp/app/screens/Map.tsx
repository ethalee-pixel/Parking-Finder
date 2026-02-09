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
  Platform,
  Keyboard,
} from "react-native";
import MapView, { Region, Marker, MapPressEvent, Callout } from "react-native-maps";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createParkingReport, subscribeToParkingReports, ParkingReport } from "../../parkingReports";
import { FIREBASE_AUTH } from "../../FirebaseConfig";

type ParkingSpot = {
  id: string;
  latitude: number;
  longitude: number;
  type: "free" | "paid";
  rate?: string;
  createdAt: any; // Using any to handle both Number and Firestore Timestamp
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
  
  const [pendingCoord, setPendingCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [spotType, setSpotType] = useState<"free" | "paid">("free");
  const [rate, setRate] = useState("");
  const [showModal, setShowModal] = useState(false);

  /* ---------- HELPER: Parse Time for Firestore & JS ---------- */
  const getTimeInMillis = (timeData: any) => {
    if (!timeData) return Date.now();
    // Handle Firestore Timestamp {seconds, nanoseconds}
    if (timeData.seconds) return timeData.seconds * 1000;
    // Handle standard JS Date/Number
    return typeof timeData === 'number' ? timeData : new Date(timeData).getTime();
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
      setTick(prev => prev + 1);
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
            setSpots(parsed.map(spot => ({ ...spot, version: 0 })));
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
      (err) => console.log("Firestore error:", err)
    );
    return unsub;
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
  }, [spots]);

  /* ---------- HANDLERS ---------- */
  const handleMapLongPress = (event: MapPressEvent) => {
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
      await createParkingReport({
        latitude: newSpot.latitude,
        longitude: newSpot.longitude,
        type: newSpot.type,
        rate: newSpot.rate,
        createdAt: timestamp, // Ensure we send the timestamp to Firestore
      });
    } catch (e) {
      console.log("Cloud save failed");
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
      { text: "Remove", style: "destructive", onPress: () => setSpots(prev => prev.filter(s => s.id !== id)) },
    ]);
  };

  if (error) return <View style={styles.center}><Text style={styles.errorText}>{error}</Text></View>;
  if (!region) return <View style={styles.center}><ActivityIndicator size="large" color="#007AFF" /><Text>Locating...</Text></View>;

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
          const color = getPinColor(spot.createdAt);
          const age = Math.floor((Date.now() - getTimeInMillis(spot.createdAt)) / 1000);
          return (
            <Marker
              key={`${spot.id}-v${spot.version}-t${tick}`}
              coordinate={{ latitude: spot.latitude, longitude: spot.longitude }}
              onCalloutPress={() => confirmRemoveSpot(spot.id)}
            >
              <View style={[styles.customPin, { backgroundColor: color }]}>
                <Text style={styles.pinText}>{spot.type === "free" ? "F" : "$"}</Text>
              </View>
              <Callout>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle}>{spot.type === "free" ? "Free Spot" : `Paid: ${spot.rate}`}</Text>
                  <Text>Age: {age}s (Local)</Text>
                  <Text style={styles.removeHint}>Tap to Remove</Text>
                </View>
              </Callout>
            </Marker>
          );
        })}

        {/* CLOUD REPORTS */}
        {cloudReports
          .filter((r) => r.userId !== FIREBASE_AUTH.currentUser?.uid) // Only others
          .map((r) => {
            const color = getPinColor(r.createdAt);
            const age = Math.floor((Date.now() - getTimeInMillis(r.createdAt)) / 1000);
            return (
              <Marker
                key={`cloud-${r.id}-t${tick}`}
                coordinate={{ latitude: r.latitude, longitude: r.longitude }}
              >
                <View style={[styles.customPin, { backgroundColor: color, opacity: 0.8 }]}>
                  <Text style={styles.pinText}>{r.type === "free" ? "F" : "$"}</Text>
                </View>
                <Callout>
                  <View style={styles.callout}>
                    <Text style={styles.calloutTitle}>Other Driver's Report</Text>
                    <Text>{r.type === "free" ? "Free Parking" : `Paid: ${r.rate}`}</Text>
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
          <View style={[styles.colorDot, { backgroundColor: '#00FF00' }]} />
          <View style={[styles.colorDot, { backgroundColor: '#FFFF00' }]} />
          <View style={[styles.colorDot, { backgroundColor: '#FFA500' }]} />
          <View style={[styles.colorDot, { backgroundColor: '#FF0000' }]} />
        </View>
      </View>

      <Modal visible={showModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>New Parking Spot</Text>
            <View style={styles.typeRow}>
              <TouchableOpacity style={[styles.typeButton, spotType === "free" && styles.freeSelected]} onPress={() => setSpotType("free")}>
                <Text>Free</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.typeButton, spotType === "paid" && styles.paidSelected]} onPress={() => setSpotType("paid")}>
                <Text>Paid</Text>
              </TouchableOpacity>
            </View>
            {spotType === "paid" && <TextInput placeholder="Rate" value={rate} onChangeText={setRate} style={styles.input} />}
            <TouchableOpacity style={styles.saveButton} onPress={saveSpot}><Text style={styles.saveText}>Save</Text></TouchableOpacity>
            <TouchableOpacity onPress={closeModal}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
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
    width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: 'white',
    justifyContent: 'center', alignItems: 'center', elevation: 5,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3,
  },
  pinText: { color: 'white', fontWeight: 'bold' },
  callout: { padding: 10, alignItems: 'center', minWidth: 120 },
  calloutTitle: { fontWeight: 'bold', marginBottom: 5 },
  removeHint: { color: 'red', fontSize: 10, marginTop: 5 },
  colorGuide: { position: "absolute", bottom: 20, left: 20, backgroundColor: "white", padding: 10, borderRadius: 20, elevation: 5 },
  guideTitle: { fontSize: 10, fontWeight: "bold", marginBottom: 5 },
  colorRow: { flexDirection: "row", gap: 8 },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  modal: { width: "80%", backgroundColor: "white", padding: 20, borderRadius: 15 },
  modalTitle: { fontSize: 18, fontWeight: "bold", textAlign: "center", marginBottom: 15 },
  typeRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 15 },
  typeButton: { padding: 10, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, width: "45%", alignItems: "center" },
  freeSelected: { backgroundColor: "#c8e6c9" },
  paidSelected: { backgroundColor: "#ffcdd2" },
  input: { borderWidth: 1, borderColor: "#ccc", padding: 10, borderRadius: 8, marginBottom: 15 },
  saveButton: { backgroundColor: "#007AFF", padding: 12, borderRadius: 8 },
  saveText: { color: "white", textAlign: "center", fontWeight: "bold" },
  cancelText: { textAlign: "center", marginTop: 15, color: "#666" }
});