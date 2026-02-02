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

/* ---------- Types ---------- */

type ParkingSpot = {
  id: string;
  latitude: number;
  longitude: number;
  type: "free" | "paid";
  rate?: string;
  createdAt: number;
};

const STORAGE_KEY = "@parking_spots";

/* ---------- Helper Functions ---------- */

const validateParkingSpots = (data: any): ParkingSpot[] => {
  if (!Array.isArray(data)) return [];
  
  return data.filter((spot) => {
    return (
      spot &&
      typeof spot.id === "string" &&
      typeof spot.latitude === "number" &&
      typeof spot.longitude === "number" &&
      (spot.type === "free" || spot.type === "paid") &&
      typeof spot.createdAt === "number"
    );
  });
};

/* ---------- FAST Color Logic Based on Age (FOR TESTING) ---------- */

// Get pin color based on how old the spot is - CHANGED FOR TESTING
const getPinColorByAge = (createdAt: number, type: "free" | "paid"): string => {
  const now = Date.now();
  const ageInSeconds = (now - createdAt) / 1000; // Convert to SECONDS (not hours)
  const ageInMinutes = ageInSeconds / 60;
  
  console.log(`Spot age: ${ageInMinutes.toFixed(1)} minutes`); // Debug log
  
  // For free spots: Rapid color changes every 30 seconds for testing
  if (type === "free") {
    if (ageInSeconds < 30) return "#00FF00";      // Bright green (0-30 seconds)
    if (ageInSeconds < 60) return "#7CFC00";      // Lawn green (30-60 seconds)
    if (ageInSeconds < 90) return "#FFFF00";      // Yellow (1-1.5 minutes)
    if (ageInSeconds < 120) return "#FFA500";     // Orange (1.5-2 minutes)
    return "#FF0000";                             // Red (older than 2 minutes)
  }
  
  // For paid spots: Rapid color changes every 30 seconds for testing
  if (type === "paid") {
    if (ageInSeconds < 30) return "#4169E1";      // Royal blue (0-30 seconds)
    if (ageInSeconds < 60) return "#8A2BE2";      // Blue violet (30-60 seconds)
    if (ageInSeconds < 90) return "#DA70D6";      // Orchid (1-1.5 minutes)
    if (ageInSeconds < 120) return "#FF1493";     // Deep pink (1.5-2 minutes)
    return "#8B0000";                             // Dark red (older than 2 minutes)
  }
  
  return type === "free" ? "#00FF00" : "#4169E1"; // Fallback
};

// Get age description for the pin title
const getAgeDescription = (createdAt: number): string => {
  const now = Date.now();
  const ageInMs = now - createdAt;
  
  const seconds = Math.floor(ageInMs / 1000);
  const minutes = Math.floor(ageInMs / (1000 * 60));
  const hours = Math.floor(ageInMs / (1000 * 60 * 60));
  
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  return `${hours}h ago`;
};

/* ---------- Component ---------- */

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [currentTime, setCurrentTime] = useState<number>(Date.now()); // For refreshing colors
  const [refreshCount, setRefreshCount] = useState(0); // Track refreshes

  // New-spot flow
  const [pendingCoord, setPendingCoord] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [spotType, setSpotType] = useState<"free" | "paid">("free");
  const [rate, setRate] = useState("");
  const [showModal, setShowModal] = useState(false);

  /* ---------- Initialization ---------- */

  useEffect(() => {
    (async () => {
      try {
        // 1. Request Permissions
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setError("Location permission denied.");
          return;
        }

        // 2. Load Saved Data
        try {
          const savedSpots = await AsyncStorage.getItem(STORAGE_KEY);
          if (savedSpots) {
            const parsed = JSON.parse(savedSpots);
            const validated = validateParkingSpots(parsed);
            setSpots(validated);
          }
        } catch (storageError) {
          console.error("Failed to load saved spots:", storageError);
        }

        // 3. Get Initial Location
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
        setError(
          `Failed to initialize: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    })();
  }, []);

  // Update time EVERY 10 SECONDS to refresh pin colors - CHANGED FROM 1 MINUTE
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
      setRefreshCount(prev => prev + 1); // Increment refresh counter
      console.log(`Color refresh #${refreshCount + 1} at ${new Date().toLocaleTimeString()}`);
    }, 10000); // Update every 10 seconds (was 60000)
    
    return () => clearInterval(interval);
  }, [refreshCount]);

  // Save spots to local storage whenever the list changes
  useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
      } catch (err) {
        console.error("Failed to save spots:", err);
      }
    })();
  }, [spots]);

  /* ---------- Handlers ---------- */

  const handleMapLongPress = (event: MapPressEvent) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setPendingCoord({ latitude, longitude });
    setSpotType("free");
    setRate("");
    setShowModal(true);
  };

  const saveSpot = () => {
    if (!pendingCoord) return;

    if (spotType === "paid" && rate.trim() === "") {
      Alert.alert("Missing rate", "Please enter a rate for paid parking.");
      return;
    }

    const newSpot: ParkingSpot = {
      id: Math.random().toString(36).substring(7),
      latitude: pendingCoord.latitude,
      longitude: pendingCoord.longitude,
      type: spotType,
      rate: spotType === "paid" ? rate.trim() : undefined,
      createdAt: Date.now(),
    };

    setSpots((prev) => [...prev, newSpot]);
    closeModal();
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

  /* ---------- Render ---------- */

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
        {spots.map((spot) => {
          const pinColor = getPinColorByAge(spot.createdAt, spot.type);
          const ageDescription = getAgeDescription(spot.createdAt);
          const ageInSeconds = (Date.now() - spot.createdAt) / 1000;
          
          return (
            <Marker
              key={spot.id}
              coordinate={{
                latitude: spot.latitude,
                longitude: spot.longitude,
              }}
              pinColor={pinColor}
              title={spot.type === "free" ? "Free Parking" : `Paid: ${spot.rate}`}
              description={`Added ${ageDescription} • ${Math.floor(ageInSeconds)}s old • Tap to remove`}
              onCalloutPress={() => confirmRemoveSpot(spot.id)}
            />
          );
        })}
      </MapView>

      {/* Color Legend - UPDATED FOR TESTING */}
      <View style={styles.legendContainer}>
        <View style={styles.legendHeader}>
          <Text style={styles.legendTitle}>PIN AGE LEGEND</Text>
          <Text style={styles.refreshText}>Refresh #{refreshCount}</Text>
        </View>
        <Text style={styles.legendSubtitle}>Colors change every 30 seconds</Text>
        
        <View style={styles.legendRow}>
          <View style={[styles.legendItem, { backgroundColor: "#00FF00" }]}>
            <Text style={styles.legendText}>0-30s</Text>
          </View>
          <View style={[styles.legendItem, { backgroundColor: "#7CFC00" }]}>
            <Text style={styles.legendText}>30-60s</Text>
          </View>
          <View style={[styles.legendItem, { backgroundColor: "#FFFF00" }]}>
            <Text style={styles.legendText}>1-1.5m</Text>
          </View>
          <View style={[styles.legendItem, { backgroundColor: "#FFA500" }]}>
            <Text style={styles.legendText}>1.5-2m</Text>
          </View>
          <View style={[styles.legendItem, { backgroundColor: "#FF0000" }]}>
            <Text style={styles.legendText}>2m+</Text>
          </View>
        </View>
        
        <View style={styles.timeInfo}>
          <Text style={styles.timeText}>Updates every: 10 seconds</Text>
          <Text style={styles.timeText}>Last update: {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</Text>
        </View>
      </View>

      {/* ---------- Add Spot Modal ---------- */}
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
            <Text style={styles.modalSubtitle}>Colors change every 30s currently</Text>
            <Text style={styles.modalNote}>Watch pins change color every 30 seconds</Text>

            <View style={styles.typeRow}>
              <TouchableOpacity
                style={[
                  styles.typeButton,
                  spotType === "free" && styles.freeSelected,
                ]}
                onPress={() => setSpotType("free")}
              >
                <Text style={styles.typeText}>Free</Text>
                <Text style={styles.typeSubtext}>Green → Red</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.typeButton,
                  spotType === "paid" && styles.paidSelected,
                ]}
                onPress={() => setSpotType("paid")}
              >
                <Text style={styles.typeText}>Paid</Text>
                <Text style={styles.typeSubtext}>Blue → Dark Red</Text>
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

/* ---------- Styles ---------- */

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

  // Legend styles
  legendContainer: {
    position: "absolute",
    bottom: 20,
    left: 10,
    right: 10,
    backgroundColor: "rgba(255, 255, 255, 0.97)",
    borderRadius: 12,
    padding: 15,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    borderWidth: 2,
    borderColor: "#007AFF",
  },
  legendHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 5,
  },
  legendTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#007AFF",
    textAlign: "center",
  },
  refreshText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#FF5722",
    backgroundColor: "#FFECB3",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  legendSubtitle: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
    marginBottom: 10,
    fontStyle: "italic",
  },
  legendRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  legendItem: {
    width: 48,
    height: 24,
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333",
  },
  legendText: {
    color: "white",
    fontSize: 9,
    fontWeight: "bold",
    textShadowColor: "black",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1,
  },
  timeInfo: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
  },
  timeText: {
    fontSize: 10,
    color: "#333",
    textAlign: "center",
    fontWeight: "600",
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    width: "85%",
    backgroundColor: "white",
    padding: 25,
    borderRadius: 15,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 5,
    textAlign: "center",
    color: "#333",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#FF5722",
    marginBottom: 5,
    textAlign: "center",
    fontWeight: "bold",
  },
  modalNote: {
    fontSize: 12,
    color: "#666",
    marginBottom: 20,
    textAlign: "center",
    fontStyle: "italic",
  },
  typeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 25,
  },
  typeButton: {
    paddingVertical: 15,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#ddd",
    width: "48%",
    alignItems: "center",
    justifyContent: "center",
  },
  typeText: { 
    fontWeight: "bold", 
    fontSize: 16,
    marginBottom: 3,
  },
  typeSubtext: {
    fontSize: 10,
    color: "#666",
    textAlign: "center",
  },
  freeSelected: {
    backgroundColor: "#e8f5e9",
    borderColor: "#4caf50",
    borderWidth: 3,
  },
  paidSelected: {
    backgroundColor: "#ffebee",
    borderColor: "#f44336",
    borderWidth: 3,
  },
  input: {
    borderWidth: 2,
    borderColor: "#ddd",
    padding: 14,
    marginBottom: 25,
    borderRadius: 10,
    fontSize: 16,
    backgroundColor: "#f9f9f9",
  },
  saveButton: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 10,
    marginBottom: 12,
    elevation: 3,
  },
  saveText: {
    color: "white",
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 18,
  },
  cancelButton: {
    padding: 12,
  },
  cancelText: {
    color: "#666",
    textAlign: "center",
    fontSize: 16,
  },
});