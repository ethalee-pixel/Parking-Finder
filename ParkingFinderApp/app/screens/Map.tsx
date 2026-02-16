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
  ScrollView,
  Platform,
} from "react-native";
import MapView, { Region, Marker, Callout, CalloutSubview } from "react-native-maps";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import {
  createParkingReport,
  subscribeToParkingReports,
  subscribeToMyParkingReports,
  deleteParkingReport,
  ParkingReport,
} from "../../parkingReports";
import { FIREBASE_AUTH } from "../../FirebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";

// Configure how notifications should be handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
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

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  // Start with default region immediately (Santa Cruz, CA)
  const [region, setRegion] = useState<Region>({
    latitude: 36.9741,
    longitude: -122.0308,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [tick, setTick] = useState(0); // Updates every second
  const [cloudReports, setCloudReports] = useState<ParkingReport[]>([]);

  // Track which IDs we have already alerted for so we don't spam
  const alertedIds = useRef<Set<string>>(new Set());

  const [pendingCoord, setPendingCoord] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [spotType, setSpotType] = useState<"free" | "paid">("free");
  const [rate, setRate] = useState("");
  const [showModal, setShowModal] = useState(false);

  // Duration picker state
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(30);

  // My reports history
  const [myReports, setMyReports] = useState<ParkingReport[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [uid, setUid] = useState<string | null>(
    FIREBASE_AUTH.currentUser?.uid ?? null
  );

  // Selected marker modal
  const [selectedMarker, setSelectedMarker] = useState<{
    data: any;
    isCloud: boolean;
  } | null>(null);

  // ---- Coordinate firewall ----
  const safeCoord = (
    lat: any,
    lon: any
  ): { latitude: number; longitude: number } | null => {
    const latitude = typeof lat === "string" ? Number(lat) : lat;
    const longitude = typeof lon === "string" ? Number(lon) : lon;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90) return null;
    if (longitude < -180 || longitude > 180) return null;

    return { latitude, longitude };
  };

  /* ---------- HELPER: Time Calculations ---------- */
  const getTimeInMillis = (timeData: any) => {
    if (!timeData) return Date.now();
    if (timeData.seconds) return timeData.seconds * 1000;
    return typeof timeData === "number"
      ? timeData
      : new Date(timeData).getTime();
  };

  const getAgeInSeconds = (createdAt: any) => {
    const timeInMillis = getTimeInMillis(createdAt);
    return Math.floor((Date.now() - timeInMillis) / 1000);
  };

  // Helper to format text like "1m 30s"
  const formatDuration = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  // Request notification permissions
  const requestNotificationPermissions = async () => {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      Alert.alert(
        'Permission Required',
        'Please enable notifications to get alerts when your parking spots are expiring.'
      );
      return false;
    }
    return true;
  };

  // Schedule notification for a parking spot
  const scheduleSpotNotification = async (spotId: string, durationSeconds: number, spotType: string) => {
    // Only schedule actual push notifications on Android or in production builds
    // For iOS in Expo Go, rely on in-app Alert dialogs
    if (Platform.OS === 'ios') {
      //console.log('iOS: Using in-app alerts instead of notifications in Expo Go');
      return null;
    }

    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return null;

    // Schedule notification at 90% of duration (warning time)
    const warningTime = Math.floor(durationSeconds * 0.9);
    const timeRemaining = durationSeconds - warningTime;

    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: '⚠️ Parking Spot Expiring Soon',
          body: `Your ${spotType === 'free' ? 'Free' : 'Paid'} parking spot will expire in ${formatDuration(timeRemaining)}!`,
          sound: true,
          vibrate: [0, 250, 250, 250], // Vibrate pattern: wait 0ms, vibrate 250ms, wait 250ms, vibrate 250ms
          priority: Notifications.AndroidNotificationPriority.HIGH,
          ...(Platform.OS === 'android' && { channelId: 'parking-alerts' }),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: warningTime,
          repeats: false,
        },
      });
      return notificationId;
    } catch (error) {
      //console.log('Failed to schedule notification:', error);
      return null;
    }
  };

  /* ---------- HELPER: Get Status for Rendering ---------- */
  const getPinStatus = (createdAt: any, durationSeconds: number) => {
    const age = getAgeInSeconds(createdAt);
    const warningThreshold = Math.floor(durationSeconds * 0.9); // Warning at 90% of duration

    if (age >= durationSeconds) {
      return { color: null, expired: true, warning: false, age };
    }
    if (age >= warningThreshold) {
      return { color: "#FF0000", expired: false, warning: true, age };
    }
    return { color: "#00FF00", expired: false, warning: false, age };
  };

  /* ---------- CHECK FOR WARNINGS & EXPIRATIONS ---------- */
  const checkAlertsAndExpiration = () => {
    //console.log("Checking alerts... tick:", tick);
    // Combine local spots and my cloud reports
    const allMySpots = [...spots, ...myReports];
    //console.log("Total spots to check:", allMySpots.length);

    for (const spot of allMySpots) {
      const age = getAgeInSeconds(spot.createdAt);
      const duration = spot.durationSeconds || 30; // Default to 30s if not set
      const warningThreshold = Math.floor(duration * 0.9); // Warning at 90%

      //console.log(`Spot ${spot.id}: age=${age}s, duration=${duration}s, threshold=${warningThreshold}s`);

      // If it's in the warning zone AND we haven't alerted yet
      if (age >= warningThreshold && age < duration) {
        //console.log(`Spot ${spot.id} is in warning zone!`);
        if (!alertedIds.current.has(spot.id)) {
          //console.log(`Showing alert for spot ${spot.id}`);
          const timeRemaining = duration - age;
          const spotLabel = spot.type === "free" ? "Free" : "Paid";

          // Use Alert for compatibility with Expo Go
          Alert.alert(
            "⚠️ Parking Spot Expiring Soon",
            `Your ${spotLabel} parking spot will expire in ${formatDuration(timeRemaining)}!`,
            [{ text: "OK" }]
          );

          // Mark as alerted so we don't spam
          alertedIds.current.add(spot.id);
        } else {
          //console.log(`Already alerted for spot ${spot.id}`);
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
        // Show alert for expired spots
        Alert.alert(
          "Parking Spots Expired",
          `${removedCount} parking spot(s) have expired and been removed.`,
          [{ text: "OK" }]
        );
      }

      return stillValid;
    });
  };

  /* ---------- EFFECTS ---------- */

  // The "Game Loop" - Ticks every 1 second
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []); // Empty deps - never recreate

  // Separate effect to check alerts/expiration
  useEffect(() => {
    checkAlertsAndExpiration();
  }, [tick]); // Only run when tick changes

  // Standard Setup (Location, Auth, etc)
  useEffect(() => {
    (async () => {
      try {
        // Request notification permissions
        await requestNotificationPermissions();

        // Set up Android notification channel
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('parking-alerts', {
            name: 'Parking Alerts',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            sound: 'default',
            enableVibrate: true,
            enableLights: true,
            lightColor: '#FF0000',
          });
        }

        // Request location permission
        const { status } = await Location.requestForegroundPermissionsAsync();

        // Load saved spots from storage
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

        // Try to get current location
        if (status === "granted") {
          try {
            const loc = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
              timeInterval: 5000,
            });
            setRegion({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            });
            ////console.log("Got location:", loc.coords.latitude, loc.coords.longitude);
          } catch (locError) {
            ////console.log("Failed to get current location, using default:", locError);
            // Fallback to default location
            setRegion({
              latitude: 36.9741, // Santa Cruz, CA
              longitude: -122.0308,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            });
          }
        } else {
          ////console.log("Location permission not granted, using default location");
          // Use default location if no permission
          setRegion({
            latitude: 36.9741,
            longitude: -122.0308,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          });
        }
      } catch (err) {
        //console.error("Initialization error:", err);
        // Always set a default region so app works
        setRegion({
          latitude: 36.9741, // Santa Cruz, CA
          longitude: -122.0308,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
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
    if (!uid) {
      setMyReports([]);
      return;
    }
    const unsub = subscribeToMyParkingReports(
      (reports) => setMyReports(reports),
      (err) => console.log("My reports error:", err)
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

    const totalSeconds = hours * 3600 + minutes * 60 + seconds;

    if (totalSeconds === 0) {
      Alert.alert("Invalid Duration", "Please set a duration greater than 0");
      return;
    }

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

    closeModal();

    // Schedule notification for this spot
    await scheduleSpotNotification(id, totalSeconds, spotType);

    try {
      // Save to Firestore and get the document ID
      const firestoreId = await createParkingReport({
        latitude: newSpot.latitude,
        longitude: newSpot.longitude,
        type: newSpot.type,
        rate: newSpot.rate,
        durationSeconds: totalSeconds,
      });

      // Add the Firestore ID to the spot and save locally
      newSpot.firestoreId = firestoreId;
      setSpots((prev) => [...prev, newSpot]);
      ////console.log("Saved spot with Firestore ID:", firestoreId);
    } catch (e) {
      ////console.log("Cloud save failed", e);
      // Still add locally even if cloud save fails
      setSpots((prev) => [...prev, newSpot]);
    }
  };

  const closeModal = () => {
    Keyboard.dismiss();
    setShowModal(false);
    setPendingCoord(null);
    // Reset duration picker
    setHours(0);
    setMinutes(0);
    setSeconds(30);
  };

  const confirmRemoveSpot = (id: string) => {
    ////console.log("confirmRemoveSpot called with id:", id);

    // Find the spot to get its Firestore ID
    const spot = spots.find((s) => s.id === id);

    Alert.alert("Remove Spot?", "Permanently remove this marker?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          ////console.log("Removing spot from local array:", id);

          // Remove from local state immediately
          setSpots((prev) => {
            const newSpots = prev.filter((s) => s.id !== id);
            ////console.log("Spots before:", prev.length, "after:", newSpots.length);
            return newSpots;
          });

          // Delete from Firestore if we have the document ID
          if (spot?.firestoreId) {
            try {
              await deleteParkingReport(spot.firestoreId);
              ////console.log("Deleted from Firestore:", spot.firestoreId);
            } catch (e) {
              ////console.log("Failed to delete from Firestore:", e);
            }
          } else {
            ////console.log("No Firestore ID found for spot:", id);
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

    const duration = data.durationSeconds || 30; // Default to 30s
    const { color, expired, warning } = getPinStatus(data.createdAt, duration);

    // If expired, DO NOT RENDER on map
    if (expired) return null;

    // Stable key - never changes unless marker is added/removed
    return (
      <Marker
        key={`${isCloud ? 'cloud' : 'local'}-${data.id}`}
        coordinate={coord}
        onPress={() => {
          setSelectedMarker({ data, isCloud });
        }}
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
        onLongPress={handleMapLongPress}
      >
        {/* Render local spots (your spots that you control) */}
        {spots.map((spot) => {
          ////console.log("Rendering local spot:", spot.id);
          return renderMarker(spot, false);
        })}

        {/* Render cloud spots from ALL users (will sync deletions) */}
        {cloudReports
          .filter((r) => {
            // Filter out spots that match our local spots (avoid duplicates)
            const isDuplicate = spots.some((s) => s.firestoreId === r.id);
            if (isDuplicate) {
              ////console.log("Skipping duplicate cloud spot:", r.id);
            }
            return !isDuplicate;
          })
          .map((r) => renderMarker(r, true))}
      </MapView>

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
            {selectedMarker && (() => {
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
                  <Text style={[styles.markerModalTitle, warning && { color: "red" }]}>
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

            <FlatList
              data={myReports}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={{ textAlign: "center" }}>No reports yet.</Text>
              }
              renderItem={({ item }) => {
                // Check if it expired relative to NOW
                const ageSeconds = getAgeInSeconds(item.createdAt);
                const duration = item.durationSeconds || 30;
                const isExpired = ageSeconds >= duration;

                // If expired, cap the time at duration. If active, show real time.
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
                    style={[styles.historyRow, isExpired && styles.historyRowExpired]}
                    disabled={isExpired}
                    onPress={() => {
                      if(!isExpired) {
                        mapRef.current?.animateToRegion({
                            latitude: item.latitude,
                            longitude: item.longitude,
                            latitudeDelta: 0.01,
                            longitudeDelta: 0.01,
                        }, 350);
                        setShowHistory(false);
                      }
                    }}
                  >
                    <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                        <Text style={[styles.historyTitle, isExpired && {color: '#666'}]}>{label}</Text>
                        <Text style={{fontWeight: 'bold', color: statusColor}}>{statusLabel}</Text>
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

            {/* Duration Picker */}
            <Text style={styles.durationLabel}>Duration:</Text>
            <View style={styles.pickerContainer}>
              <View style={styles.pickerColumn}>
                <Text style={styles.pickerColumnLabel}>Hours</Text>
                <ScrollView style={styles.picker} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 25 }, (_, i) => i).map((h) => (
                    <TouchableOpacity
                      key={`h-${h}`}
                      style={[
                        styles.pickerItem,
                        hours === h && styles.pickerItemSelected,
                      ]}
                      onPress={() => setHours(h)}
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
                <ScrollView style={styles.picker} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                    <TouchableOpacity
                      key={`m-${m}`}
                      style={[
                        styles.pickerItem,
                        minutes === m && styles.pickerItemSelected,
                      ]}
                      onPress={() => setMinutes(m)}
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
                <ScrollView style={styles.picker} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 60 }, (_, i) => i).map((s) => (
                    <TouchableOpacity
                      key={`s-${s}`}
                      style={[
                        styles.pickerItem,
                        seconds === s && styles.pickerItemSelected,
                      ]}
                      onPress={() => setSeconds(s)}
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
  calloutContainer: {
    backgroundColor: "white",
    borderRadius: 8,
    padding: 12,
    width: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  callout: {
    width: 200,
  },
  calloutTitle: {
    fontWeight: "bold",
    marginBottom: 5,
    fontSize: 14,
    color: "#000",
  },
  warningText: {
    color: "red",
  },
  calloutAge: {
    fontWeight: "600",
    color: "#333",
    marginTop: 4,
  },
  calloutTimeLeft: {
    fontWeight: "600",
    color: "#666",
    fontSize: 12,
    marginTop: 2,
  },
  removeHintContainer: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  removeHint: {
    color: "#FF3B30",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
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
});