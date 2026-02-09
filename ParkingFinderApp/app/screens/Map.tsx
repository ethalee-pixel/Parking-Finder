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
import MapView, { Region, Marker, MapPressEvent } from "react-native-maps";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createParkingReport } from "../../parkingReports";

type ParkingSpot = {
  id: string;
  latitude: number;
  longitude: number;
  type: "free" | "paid";
  rate?: string;
  createdAt: number;
  version: number; // ADD THIS: Force new Marker each update
};

const STORAGE_KEY = "@parking_spots";

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [tick, setTick] = useState(0); // Simple counter to force updates
  
  // New-spot flow
  const [pendingCoord, setPendingCoord] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [spotType, setSpotType] = useState<"free" | "paid">("free");
  const [rate, setRate] = useState("");
  const [showModal, setShowModal] = useState(false);

  /* ---------- SIMPLE TIMER THAT ALWAYS WORKS ---------- */
  useEffect(() => {
    console.log("Starting emulator-compatible timer");
    
    const interval = setInterval(() => {
      setTick(prev => {
        const newTick = prev + 1;
        console.log(`[TICK ${newTick}] Forcing update at ${new Date().toLocaleTimeString()}`);
        return newTick;
      });
    }, 5000); // Every 5 seconds
    
    return () => clearInterval(interval);
  }, []);

  /* ---------- Initialization ---------- */
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setError("Location permission denied.");
          return;
        }

        // Load saved spots
        try {
          const savedSpots = await AsyncStorage.getItem(STORAGE_KEY);
          if (savedSpots) {
            const parsed = JSON.parse(savedSpots);
            if (Array.isArray(parsed)) {
              // Add version to each spot
              const withVersions = parsed.map(spot => ({
                ...spot,
                version: 0
              }));
              setSpots(withVersions);
            }
          }
        } catch (e) {
          console.log("No saved spots or error loading");
        }

        // Get location
        const loc = await Location.getCurrentPositionAsync({});
        const initialRegion = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        };
        
        setRegion(initialRegion);
        setTimeout(() => {
          mapRef.current?.animateToRegion(initialRegion, 1000);
        }, 100);
      } catch (err) {
        setError("Failed to initialize");
      }
    })();
  }, []);

  // Save spots
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
  }, [spots]);

  /* ---------- UPDATED: Get color based on age AND tick ---------- */
  const getPinColor = (spot: ParkingSpot): string => {
    const now = Date.now();
    const ageInSeconds = Math.floor((now - spot.createdAt) / 1000);
    
    // Emulator-friendly color calculation (depends on age AND tick)
    if (ageInSeconds < 10) {
      return spot.type === "free" ? "#00FF00" : "#0000FF"; // Bright colors
    } else if (ageInSeconds < 20) {
      return spot.type === "free" ? "#FFFF00" : "#FF00FF"; // Yellow/Magenta
    } else if (ageInSeconds < 30) {
      return spot.type === "free" ? "#FFA500" : "#FF1493"; // Orange/Hot Pink
    } else {
      return spot.type === "free" ? "#FF0000" : "#8B0000"; // Red/Dark Red
    }
  };

  const handleMapLongPress = (event: MapPressEvent) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setPendingCoord({ latitude, longitude });
    setSpotType("free");
    setRate("");
    setShowModal(true);
  };

  const saveSpot = async () => {
    if (!pendingCoord) return;

    if (spotType === "paid" && rate.trim() === "") {
      Alert.alert("Missing rate", "Please enter a rate for paid parking.");
      return;
    }

    const newSpot: ParkingSpot = {
      id: `spot-${Date.now()}-${Math.random()}`,
      latitude: pendingCoord.latitude,
      longitude: pendingCoord.longitude,
      type: spotType,
      rate: spotType === "paid" ? rate.trim() : undefined,
      createdAt: Date.now(),
      version: 0,
    };

    console.log(`Created new spot at ${new Date().toLocaleTimeString()}`);
    setSpots((prev) => [...prev, newSpot]);
    closeModal();

    // Added Firestore save for parking reports
    try {
    const docId = await createParkingReport({
      latitude: newSpot.latitude,
      longitude: newSpot.longitude,
      type: newSpot.type,
      rate: newSpot.rate,
    });
     console.log("Saved to Firestore docId:", docId);
    } catch (e: any) {
    console.log("Firestore write failed:", e?.message ?? e);
    Alert.alert("Saved locally, but cloud save failed", e?.message ?? "Check Firestore rules/auth.");
    }
  };

  const closeModal = () => {
    Keyboard.dismiss();
    setShowModal(false);
    setPendingCoord(null);
  };

  const confirmRemoveSpot = (id: string) => {
    Alert.alert(
      "Remove parking spot?",
      "This spot will be permanently removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            setSpots((prev) => prev.filter((spot) => spot.id !== id)),
        },
      ]
    );
  };

  /* ---------- FORCE COLOR UPDATE FOR EMULATOR ---------- */
  const forceColorUpdate = () => {
    console.log("Manually forcing color update");
    
    // Increment version for ALL spots - this creates new Markers
    setSpots(prev => {
      if (prev.length === 0) return prev;
      
      return prev.map(spot => ({
        ...spot,
        version: spot.version + 1
      }));
    });
    
    // Also increment tick to force re-render
    setTick(prev => prev + 1);
  };

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!region) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={{ marginTop: 8 }}>Getting location…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        region={region}
        showsUserLocation
        onLongPress={handleMapLongPress}
      >
        {/* KEY: Use version in key to force new Marker */}
        {spots.map((spot) => {
          const pinColor = getPinColor(spot);
          const ageInSeconds = Math.floor((Date.now() - spot.createdAt) / 1000);
          
          return (
            <Marker
              key={`${spot.id}-v${spot.version}-t${tick}`} // TRIPLE KEY FOR EMULATOR
              coordinate={{
                latitude: spot.latitude,
                longitude: spot.longitude,
              }}
              pinColor={pinColor}
              title={spot.type === "free" ? "Free Parking" : `Paid: ${spot.rate}`}
              description={`Age: ${ageInSeconds}s • Tap to remove`}
              onCalloutPress={() => confirmRemoveSpot(spot.id)}
            />
          );
        })}
      </MapView>

      {/* CONTROL PANEL */}
      <View style={styles.controlPanel}>
        <TouchableOpacity 
          style={styles.testButton}
          onPress={forceColorUpdate}
        >
          <Text style={styles.testButtonText}>Parking Finder</Text>
        </TouchableOpacity>
        
        <View style={styles.infoPanel}>
          <Text style={styles.infoText}>Pins: {spots.length}</Text>
          <Text style={styles.infoText}>Tick: {tick}</Text>
          <Text style={styles.infoText}>Time: {new Date().toLocaleTimeString()}</Text>
        </View>
      </View>

      {/* COLOR PROGRESSION GUIDE */}
      <View style={styles.colorGuide}>
        <Text style={styles.guideTitle}>Color Progression (Every 10s):</Text>
        <View style={styles.colorRow}>
          <View style={[styles.colorDot, { backgroundColor: '#00FF00' }]} />
          <Text style={styles.guideText}>0-10s</Text>
          <View style={[styles.colorDot, { backgroundColor: '#FFFF00' }]} />
          <Text style={styles.guideText}>10-20s</Text>
          <View style={[styles.colorDot, { backgroundColor: '#FFA500' }]} />
          <Text style={styles.guideText}>20-30s</Text>
          <View style={[styles.colorDot, { backgroundColor: '#FF0000' }]} />
          <Text style={styles.guideText}>30s+</Text>
        </View>
      </View>

      {/* MODAL */}
      <Modal 
        visible={showModal} 
        transparent 
        animationType="fade"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Add Parking Spot</Text>
            <Text style={styles.modalSubtitle}>Emulator Test Mode</Text>

            <View style={styles.typeRow}>
              <TouchableOpacity
                style={[
                  styles.typeButton,
                  spotType === "free" && styles.freeSelected,
                ]}
                onPress={() => setSpotType("free")}
              >
                <Text style={styles.typeText}>Free</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.typeButton,
                  spotType === "paid" && styles.paidSelected,
                ]}
                onPress={() => setSpotType("paid")}
              >
                <Text style={styles.typeText}>Paid</Text>
              </TouchableOpacity>
            </View>

            {spotType === "paid" && (
              <TextInput
                placeholder="Rate (e.g. $2/hr)"
                value={rate}
                onChangeText={setRate}
                style={styles.input}
                autoFocus
              />
            )}

            <TouchableOpacity style={styles.saveButton} onPress={saveSpot}>
              <Text style={styles.saveText}>Save Spot</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={closeModal}>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { 
    color: "#f44336", 
    fontSize: 16, 
    textAlign: "center",
    paddingHorizontal: 20,
  },
  
  // Control Panel
  controlPanel: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    alignItems: "center",
  },
  testButton: {
    backgroundColor: "#FF5722",
    padding: 10,
    borderRadius: 8,
    marginBottom: 5,
    width: "80%",
    alignItems: "center",
  },
  testButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 14,
  },
  infoPanel: {
    backgroundColor: "rgba(255,255,255,0.9)",
    padding: 8,
    borderRadius: 6,
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
  },
  infoText: {
    fontSize: 12,
    color: "#333",
    fontWeight: "600",
  },
  
  // Color Guide
  colorGuide: {
    position: "absolute",
    bottom: 10,
    left: 10,
    right: 10,
    backgroundColor: "rgba(255,255,255,0.95)",
    padding: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#4CAF50",
  },
  guideTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
    textAlign: "center",
    marginBottom: 5,
  },
  colorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  colorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginHorizontal: 2,
  },
  guideText: {
    fontSize: 10,
    color: "#666",
  },
  
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    width: "80%",
    backgroundColor: "white",
    padding: 20,
    borderRadius: 12,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 5,
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 12,
    color: "#666",
    marginBottom: 20,
    textAlign: "center",
  },
  typeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  typeButton: {
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    width: "48%",
    alignItems: "center",
  },
  typeText: { fontWeight: "600" },
  freeSelected: {
    backgroundColor: "#e8f5e9",
    borderColor: "#4caf50",
  },
  paidSelected: {
    backgroundColor: "#ffebee",
    borderColor: "#f44336",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    marginBottom: 20,
    borderRadius: 8,
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: "#007AFF",
    padding: 14,
    borderRadius: 8,
    marginBottom: 10,
  },
  saveText: {
    color: "white",
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 16,
  },
  cancelButton: {
    padding: 10,
  },
  cancelText: {
    color: "#666",
    textAlign: "center",
    fontSize: 14,
  },
});