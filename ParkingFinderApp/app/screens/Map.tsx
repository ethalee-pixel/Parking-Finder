// Map.tsx
// Main map screen. Renders the map + markers and connects hooks + modals.

import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';

import {
  deleteParkingReport,
  markReportTaken,
  type ParkingReport,
} from '../../services/parkingReports';
import { FIREBASE_AUTH, FIRESTORE_DB } from '../../FirebaseConfig';
import {
  LAST_REPORTED_KEY,
  MY_TAKEN_KEY,
  STORAGE_KEY,
  type LastReported,
  type ParkingSpot,
} from '../../types/parking';
import { isNearMe, isNearRoadOrParkingOSM, safeCoord } from '../../utils/geo';
import { formatDuration, getAgeInSeconds, getPinStatus } from '../../utils/time';
import { requestNotificationPermissions } from '../../utils/notifications';

import { useLocationTracking } from '../../hooks/useLocationTracking';
import { useParkingReports } from '../../hooks/useParkingReports';
import { useUndoState } from '../../hooks/useUndoState';

import { HistoryModal } from '../../components/HistoryModal';
import { MapOverlays } from '../../components/MapOverlays';
import { MarkerInfoModal } from '../../components/MarkerInfoModal';
import { NewSpotModal } from '../../components/NewSpotModal';

// How close (in meters) the user must be to manually mark a spot as taken.
const NEARBY_TAKEN_RADIUS_M = 75;

// Map behavior constants.
const DEFAULT_REGION: Region = {
  latitude: 36.9741,
  longitude: -122.0308,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const USER_CENTER_DELTA: Pick<Region, 'latitudeDelta' | 'longitudeDelta'> = {
  latitudeDelta: 0.005,
  longitudeDelta: 0.005,
};

const REGION_DEBOUNCE_MS = 400;
const TICK_INTERVAL_MS = 1000;
const AUTO_TAKEN_BANNER_MS = 4000;

// Used to type marker modal selection.
type MarkerData = ParkingSpot | ParkingReport;

type SelectedMarker = {
  data: MarkerData;
  isCloud: boolean;
};

type MapLongPressEvent = {
  nativeEvent: {
    coordinate: {
      latitude: number;
      longitude: number;
    };
  };
};

function isCloudReport(data: MarkerData): data is ParkingReport {
  return 'status' in data;
}

function getDurationSeconds(data: MarkerData): number {
  return data.durationSeconds ?? 30;
}

export default function MapScreen() {
  // Map ref used for animateToRegion.
  const mapRef = useRef<MapView | null>(null);

  // Prevent re-centering on the user after the first successful center.
  const didCenterOnUserRef = useRef(false);

  // Latest known GPS position for proximity checks (manual-taken).
  const userPosRef = useRef<{ lat: number; lon: number } | null>(null);

  // Prevents a user from manually marking more than one spot as taken per session.
  const [hasManuallyTakenASpot, setHasManuallyTakenASpot] = useState(false);

  // All report IDs the current user has marked as taken (for rendering taken marker).
  const [takenByMeIds, setTakenByMeIds] = useState<Set<string>>(new Set());

  // Tracks which specific report was manually taken, so undo can unlock it.
  const [manualTakenReportId, setManualTakenReportId] = useState<string | null>(null);

  // Initial and current map region.
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);

  // Visible region drives Firestore "in bounds" subscription.
  const [visibleRegion, setVisibleRegion] = useState<Region>(DEFAULT_REGION);

  // Debounce region updates to avoid querying on every frame.
  const regionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local parking spots saved on-device.
  const [spots, setSpots] = useState<ParkingSpot[]>([]);

  // Increments every second for expiration checks.
  const [tick, setTick] = useState(0);

  // Cloud report IDs to hide immediately after deletion (prevents flicker).
  const [hiddenCloudIds, setHiddenCloudIds] = useState<Set<string>>(new Set());

  // Tracks which spot IDs already triggered the "expiring soon" alert this session.
  const alertedIdsRef = useRef<Set<string>>(new Set());

  // Coordinate created by long-press, passed into NewSpotModal.
  const [pendingCoord, setPendingCoord] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );

  // Controls visibility of the new spot modal.
  const [showModal, setShowModal] = useState(false);

  // Prevents double-tapping save while a spot is being created.
  const [isCreatingSpot, setIsCreatingSpot] = useState(false);

  // Prevents concurrent auto-taken or manual-taken operations.
  const [isAutoTaking, setIsAutoTaking] = useState(false);

  // Controls visibility of the history modal.
  const [showHistory, setShowHistory] = useState(false);

  // Current signed-in user's Firebase UID (null if not signed in).
  const [uid, setUid] = useState<string | null>(FIREBASE_AUTH.currentUser?.uid ?? null);

  // Firestore report ID that this user currently has marked as taken.
  const [myTakenReportId, setMyTakenReportId] = useState<string | null>(null);

  // Selected marker data for MarkerInfoModal.
  const [selectedMarker, setSelectedMarker] = useState<SelectedMarker | null>(null);

  // Last spot this user reported (used for auto-taken proximity detection).
  const [lastReported, setLastReported] = useState<LastReported | null>(null);

  // Temporary banner shown after auto-taking a spot.
  const [autoTakenBanner, setAutoTakenBanner] = useState<string | null>(null);

  // Undo banner state + undo handler.
  const { undoState, showUndoBanner, undoAutoTaken } = useUndoState(
    myTakenReportId,
    setMyTakenReportId,
    manualTakenReportId,
    setHasManuallyTakenASpot,
    setManualTakenReportId,
  );

  // Firestore subscriptions for reports in visible area and "my reports".
  const { cloudReports, myReports } = useParkingReports(visibleRegion, uid);

  // GPS tracking + auto-taken behavior.
  useLocationTracking({
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
  });

  // Called every tick (1s). Sends expiry warning alerts and removes expired local spots.
  const checkAlertsAndExpiration = () => {
    const allMySpots: MarkerData[] = [...spots, ...myReports];

    for (const spot of allMySpots) {
      const ageSeconds = getAgeInSeconds(spot.createdAt);
      const durationSeconds = getDurationSeconds(spot);

      // Warn at 90% of the spot's lifetime.
      const warningThresholdSeconds = Math.floor(durationSeconds * 0.9);

      if (ageSeconds >= warningThresholdSeconds && ageSeconds < durationSeconds) {
        if (!alertedIdsRef.current.has(spot.id)) {
          const timeRemainingSeconds = durationSeconds - ageSeconds;
          const spotLabel = spot.type === 'free' ? 'Free' : 'Paid';

          Alert.alert(
            '⚠️ Parking Spot Expiring Soon',
            `Your ${spotLabel} parking spot will expire in ${formatDuration(
              timeRemainingSeconds,
            )}!`,
            [{ text: 'OK' }],
          );

          alertedIdsRef.current.add(spot.id);
        }
      }
    }

    // Remove fully expired LOCAL spots (device-saved only).
    setSpots((prev) => {
      const stillValid = prev.filter((spot) => {
        const ageSeconds = getAgeInSeconds(spot.createdAt);
        const durationSeconds = getDurationSeconds(spot);
        return ageSeconds < durationSeconds;
      });

      const removedCount = prev.length - stillValid.length;
      if (removedCount === 0) return prev;

      Alert.alert(
        'Parking Spots Expired',
        `${removedCount} parking spot(s) have expired and been removed.`,
        [{ text: 'OK' }],
      );

      return stillValid;
    });
  };

  // Resets a resolved Firestore report back to "open" so others can see it again.
  const reopenReport = async (reportId: string) => {
    if (!uid) {
      Alert.alert('Not signed in', 'Please sign in to reopen a spot.');
      return;
    }

    try {
      await updateDoc(doc(FIRESTORE_DB, 'parkingReports', reportId), {
        status: 'open',
        resolvedAt: null,
        resolvedBy: null,
      });

      // Clear taken tracking if this was our taken report.
      if (myTakenReportId === reportId) {
        setMyTakenReportId(null);
      }

      setTakenByMeIds((prev) => {
        const next = new Set(prev);
        next.delete(reportId);
        return next;
      });

      // Unlock the one-spot manual limit if this was the manually taken report.
      if (manualTakenReportId === reportId) {
        setHasManuallyTakenASpot(false);
        setManualTakenReportId(null);
      }

      Alert.alert('Reopened', 'This spot is open again.');
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message ?? 'Could not reopen this report.';
      Alert.alert('Failed', message);
    }
  };

  // Allows the user to manually mark a cloud report as taken.
  // Enforces: signed in, hasn't already taken one, and must be nearby.
  const manualMarkTaken = async (reportId: string, reportLat: number, reportLon: number) => {
    if (!uid) {
      Alert.alert('Not signed in', 'Please sign in to mark a spot as taken.');
      return;
    }

    if (hasManuallyTakenASpot) {
      Alert.alert('Limit reached', 'You already marked one spot as taken.');
      return;
    }

    const { ok, dist } = isNearMe(userPosRef.current, reportLat, reportLon, NEARBY_TAKEN_RADIUS_M);
    if (!ok) {
      Alert.alert(
        'Too far away',
        `You must be within ${NEARBY_TAKEN_RADIUS_M}m to mark this taken.\n\nDistance: ${Math.round(
          dist,
        )}m`,
      );
      return;
    }

    // Prevent concurrent taking operations.
    if (isAutoTaking) return;

    setIsAutoTaking(true);
    try {
      await markReportTaken(reportId, uid);

      setMyTakenReportId(reportId);
      setTakenByMeIds((prev) => {
        const next = new Set(prev);
        next.add(reportId);
        return next;
      });

      setHasManuallyTakenASpot(true);
      setManualTakenReportId(reportId);

      // Show undo banner so the user can reverse within the undo window.
      showUndoBanner(reportId);

      Alert.alert('Marked taken', 'This spot was marked as taken.');
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message ?? 'Could not mark as taken.';
      Alert.alert('Failed', message);
    } finally {
      setIsAutoTaking(false);
    }
  };

  // Shows a confirmation dialog before removing a local spot and its cloud copy (if any).
  const confirmRemoveSpot = (id: string) => {
    const spot = spots.find((s) => s.id === id);

    Alert.alert('Remove Spot?', 'Permanently remove this marker?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setSpots((prev) => prev.filter((s) => s.id !== id));

          const cloudId = spot?.firestoreId;
          if (!cloudId) return;

          // Hide immediately to prevent flicker while Firestore updates.
          setHiddenCloudIds((prev) => {
            const next = new Set(prev);
            next.add(cloudId);
            return next;
          });

          try {
            await deleteParkingReport(cloudId);
          } catch (err: unknown) {
            // If deletion fails, unhide and notify.
            setHiddenCloudIds((prev) => {
              const next = new Set(prev);
              next.delete(cloudId);
              return next;
            });

            const message =
              (err as { message?: string })?.message ??
              'Could not delete this spot from the cloud.';
            Alert.alert('Delete failed', message);
          }
        },
      },
    ]);
  };

  // Signs the current user out of Firebase Auth.
  const handleSignOut = async () => {
    try {
      await signOut(FIREBASE_AUTH);
      Alert.alert('Signed Out', 'You have been signed out successfully.');
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message ?? 'Sign out failed.';
      Alert.alert('Error', message);
    }
  };

  // Gets the user's current GPS location and animates the map to center on them.
  const centerOnUser = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      const userRegion: Region = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        ...USER_CENTER_DELTA,
      };

      setRegion(userRegion);
      mapRef.current?.animateToRegion(userRegion, 700);
    } catch (err: unknown) {
      console.error('centerOnUser failed:', err);
    }
  };

  // Renders a large red circle marker with a "T" to indicate a taken spot.
  const renderTakenTMarker = (
    keyId: string,
    latitude: number,
    longitude: number,
    onPress?: () => void,
  ) => {
    const coord = safeCoord(latitude, longitude);
    if (!coord) return null;

    return (
      <Marker key={`taken-${keyId}`} coordinate={coord} onPress={onPress}>
        <View style={styles.takenPin}>
          <Text style={styles.takenPinText}>T</Text>
        </View>
      </Marker>
    );
  };

  // Renders a marker for either a local spot or a cloud report.
  // Resolved reports only show if taken by the current user.
  const renderMarker = (data: MarkerData, isCloud: boolean) => {
    const coord = safeCoord(data.latitude, data.longitude);
    if (!coord) return null;

    if (isCloud && isCloudReport(data) && data.status === 'resolved') {
      const takenByMe = data.resolvedBy === uid || takenByMeIds.has(data.id);
      if (!takenByMe) return null;

      return renderTakenTMarker(data.id, coord.latitude, coord.longitude, () => {
        setSelectedMarker({ data, isCloud: true });
      });
    }

    const durationSeconds = getDurationSeconds(data);
    const { color, expired } = getPinStatus(data.createdAt, durationSeconds);

    // Do not render expired markers.
    if (expired) return null;

    return (
      <Marker
        key={`${isCloud ? 'cloud' : 'local'}-${data.id}`}
        coordinate={coord}
        onPress={() => setSelectedMarker({ data, isCloud })}
      >
        <View style={[styles.customPin, { backgroundColor: color }]}>
          <Text style={styles.pinText}>{data.type === 'free' ? 'F' : '$'}</Text>
        </View>
      </Marker>
    );
  };

  // Handles long-press on the map: validate the location is near a road or parking area,
  // then open the NewSpotModal.
  const handleMapLongPress = async (event: MapLongPressEvent) => {
    if (isCreatingSpot) return;

    const { latitude, longitude } = event.nativeEvent.coordinate;

    try {
      const ok = await isNearRoadOrParkingOSM(latitude, longitude);
      if (!ok) {
        Alert.alert(
          'Not on a road/parking area',
          'Try placing the spot closer to a road or a parking lot/structure.',
        );
        return;
      }
    } catch (err: unknown) {
      // If OSM check fails (network/rate-limit), allow the spot but warn the user.
      console.warn('OSM verification failed:', err);
      Alert.alert(
        'Could not verify location',
        'Location check failed (network/rate-limit). Spot was allowed anyway.',
      );
    }

    setPendingCoord({ latitude, longitude });
    setShowModal(true);
  };

  // Debounces the visible region update to avoid excessive Firestore queries.
  const handleRegionChangeComplete = (r: Region) => {
    if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
    regionDebounceRef.current = setTimeout(() => setVisibleRegion(r), REGION_DEBOUNCE_MS);
  };

  // Effects

  // Game loop: increments tick every second to drive expiration checks.
  useEffect(() => {
    const interval = setInterval(() => setTick((prev) => prev + 1), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Cleanup: clears the region debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (regionDebounceRef.current) {
        clearTimeout(regionDebounceRef.current);
      }
    };
  }, []);

  // Run expiration/alert checks every second.
  useEffect(() => {
    checkAlertsAndExpiration();
  }, [tick]);

  // Auto-hide the auto-taken banner after a short delay.
  useEffect(() => {
    if (!autoTakenBanner) return;

    const t = setTimeout(() => setAutoTakenBanner(null), AUTO_TAKEN_BANNER_MS);
    return () => clearTimeout(t);
  }, [autoTakenBanner]);

  // On mount: restore taken report id from device storage.
  useEffect(() => {
    const restoreTakenReportId = async () => {
      try {
        const saved = await AsyncStorage.getItem(MY_TAKEN_KEY);
        if (saved) setMyTakenReportId(saved);
      } catch (err: unknown) {
        console.warn('Failed to restore MY_TAKEN_KEY:', err);
      }
    };

    void restoreTakenReportId();
  }, []);

  // On mount: request permissions, restore local storage, and attempt to center the map.
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await requestNotificationPermissions();

        // Android requires a notification channel before scheduling notifications.
        if (typeof Notifications.setNotificationChannelAsync === 'function') {
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

        const { status } = await Location.requestForegroundPermissionsAsync();

        // Restore locally saved spots from AsyncStorage.
        const savedSpots = await AsyncStorage.getItem(STORAGE_KEY);
        if (savedSpots) {
          const parsed: unknown = JSON.parse(savedSpots);

          if (Array.isArray(parsed)) {
            const cleaned: ParkingSpot[] = parsed
              .map((spot: unknown) => {
                const s = spot as Partial<ParkingSpot>;
                const coord = safeCoord(s.latitude, s.longitude);
                if (!coord || !s.id || !s.type) return null;

                return {
                  ...s,
                  latitude: coord.latitude,
                  longitude: coord.longitude,
                  version: s.version ?? 0,
                  durationSeconds: s.durationSeconds ?? 30,
                } as ParkingSpot;
              })
              .filter((s): s is ParkingSpot => s !== null);

            setSpots(cleaned);
          }
        }

        // Restore last reported spot for auto-taken tracking.
        const savedLast = await AsyncStorage.getItem(LAST_REPORTED_KEY);
        if (savedLast) {
          try {
            setLastReported(JSON.parse(savedLast) as LastReported);
          } catch (err: unknown) {
            console.warn('Failed to parse LAST_REPORTED_KEY:', err);
          }
        }

        if (status !== 'granted') {
          setRegion(DEFAULT_REGION);
          setVisibleRegion(DEFAULT_REGION);
          return;
        }

        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Highest,
          });

          const userRegion: Region = {
            ...DEFAULT_REGION,
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };

          setRegion(userRegion);
          setVisibleRegion(userRegion);

          // Only center on the user once (first load).
          if (!didCenterOnUserRef.current) {
            didCenterOnUserRef.current = true;
            setTimeout(() => {
              mapRef.current?.animateToRegion(userRegion, 700);
            }, 80);
          }
        } catch (err: unknown) {
          console.warn('Failed to get current position:', err);
          setRegion(DEFAULT_REGION);
          setVisibleRegion(DEFAULT_REGION);
        }
      } catch (err: unknown) {
        console.error('Initialization failed:', err);
        setRegion(DEFAULT_REGION);
        setVisibleRegion(DEFAULT_REGION);
      }
    };

    void initializeApp();
  }, []);

  // Verify our taken report is still resolved by us. If not, clear the local tracking.
  useEffect(() => {
    if (!uid || !myTakenReportId) return;

    const report = cloudReports.find((x) => x.id === myTakenReportId);
    if (!report) return;

    const stillMine = report.status === 'resolved' && report.resolvedBy === uid;
    if (!stillMine) setMyTakenReportId(null);
  }, [cloudReports, uid, myTakenReportId]);

  // Persist local spots whenever they change.
  useEffect(() => {
    const persistSpots = async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
      } catch (err: unknown) {
        console.warn('Failed to persist spots:', err);
      }
    };

    void persistSpots();
  }, [spots]);

  // Persist the taken report ID so it survives app restarts.
  useEffect(() => {
    const persistTaken = async () => {
      try {
        if (myTakenReportId) {
          await AsyncStorage.setItem(MY_TAKEN_KEY, myTakenReportId);
        } else {
          await AsyncStorage.removeItem(MY_TAKEN_KEY);
        }
      } catch (err: unknown) {
        console.warn('Failed to persist MY_TAKEN_KEY:', err);
      }
    };

    void persistTaken();
  }, [myTakenReportId]);

  // Listen for Firebase auth state changes to keep uid in sync.
  useEffect(() => {
    const unsub = onAuthStateChanged(FIREBASE_AUTH, (user) => {
      setUid(user?.uid ?? null);
    });

    return unsub;
  }, []);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false}
        followsUserLocation={false}
        onLongPress={handleMapLongPress}
        onRegionChangeComplete={handleRegionChangeComplete}
        onMapReady={() => {
          // Center as soon as map is ready (if permissions are granted).
          void centerOnUser();
        }}
      >
        {/* Local (device-saved) parking spots */}
        {spots.map((spot) => renderMarker(spot, false))}

        {/* Cloud (Firestore) reports, excluding hidden and duplicates of local */}
        {cloudReports
          .filter((r) => !hiddenCloudIds.has(r.id))
          .filter((r) => !spots.some((s) => s.firestoreId === r.id))
          .map((r) => renderMarker(r, true))}
      </MapView>

      {/* Overlays: busy indicator, undo banner, legend, history, sign-out, and recenter */}
      <MapOverlays
        isCreatingSpot={isCreatingSpot}
        isAutoTaking={isAutoTaking}
        undoState={undoState}
        autoTakenBanner={autoTakenBanner}
        onUndo={undoAutoTaken}
        onShowHistory={() => setShowHistory(true)}
        onSignOut={handleSignOut}
        onRecenter={centerOnUser}
      />

      {/* Marker details modal */}
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

      {/* History modal */}
      <HistoryModal
        showHistory={showHistory}
        myReports={myReports}
        mapRef={mapRef}
        setShowHistory={setShowHistory}
      />

      {/* Create new spot modal */}
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

  // Circular pin marker shown on the map for active spots.
  customPin: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },

  pinText: { color: 'white', fontWeight: 'bold' },

  // Marker used to show a taken spot (big red "T").
  takenPin: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'red',
    borderWidth: 2,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },

  takenPinText: {
    color: 'white',
    fontWeight: '900',
    fontSize: 20,
  },
});
