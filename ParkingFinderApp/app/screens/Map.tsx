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

/* ---------- Component ---------- */

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);

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
          // Continue anyway - don't block the app
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
        // Animate map to the user's location immediately
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

  // Save spots to local storage whenever the list changes
  useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
      } catch (err) {
        console.error("Failed to save spots:", err);
        // Optionally show a toast notification to user
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
        {spots.map((spot) => (
          <Marker
            key={spot.id}
            coordinate={{
              latitude: spot.latitude,
              longitude: spot.longitude,
            }}
            pinColor={spot.type === "free" ? "green" : "red"}
            title={spot.type === "free" ? "Free Parking" : `Paid: ${spot.rate}`}
            description="Tap bubble to remove spot"
            onCalloutPress={() => confirmRemoveSpot(spot.id)}
          />
        ))}
      </MapView>

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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
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
