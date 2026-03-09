// Map.tsx
// Main map screen. Renders the map + markers and connects hooks + modals.

import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  deleteParkingReport,
  getParkingReportById,
  markReportTaken,
  reopenParkingReport,
  type ParkingReport,
} from '../../services/parkingReports';
import { FIREBASE_AUTH } from '../../FirebaseConfig';
import { MY_TAKEN_KEY, STORAGE_KEY, type ParkingSpot } from '../../types/parking';
import { distanceMeters, isNearMe, isNearRoadOrParkingOSM, safeCoord } from '../../utils/geo';
import { formatDuration, getAgeInSeconds, getPinStatus } from '../../utils/time';
import { requestNotificationPermissions } from '../../utils/notifications';

import { useLocalSpotSync } from '../../hooks/useLocalSpotSync';
import { useParkingReports } from '../../hooks/useParkingReports';
import { useUndoState } from '../../hooks/useUndoState';

import { HistoryModal } from '../../components/HistoryModal';
import { MapOverlays } from '../../components/MapOverlays';
import { MarkerInfoModal } from '../../components/MarkerInfoModal';
import { NewSpotModal } from '../../components/NewSpotModal';

import { useProximityAutoTake } from '../../hooks/useProximityAutoTake';

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
  latitudeDelta: 0.0015,
  longitudeDelta: 0.0015,
};

const MAX_PIN_PLACE_DISTANCE_M = 200;

const PIN_SIZE = 35;
const PIN_FONT_SIZE = 14;
const TAKEN_PIN_FONT_SIZE = 18;

const REGION_DEBOUNCE_MS = 400;
const TICK_INTERVAL_MS = 1000;
const AUTO_TAKEN_BANNER_MS = 4000;

const LOCATION_WATCH_TIME_INTERVAL_MS = 3000;
const LOCATION_WATCH_DISTANCE_INTERVAL_M = 3;
const PLACEMENT_VALIDATE_TIMEOUT_MS = 7_000;

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

async function withTimeoutFallback<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallbackValue: T,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(fallbackValue), timeoutMs);
  });

  try {
    return (await Promise.race([promise, timeoutPromise])) as T;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export default function MapScreen() {
  // Map ref used for animateToRegion.
  const mapRef = useRef<MapView | null>(null);

  // Prevent re-centering on the user after the first successful center.
  const didCenterOnUserRef = useRef(false);

  // Latest known GPS position for proximity checks (manual-taken).
  const userPosRef = useRef<{ lat: number; lon: number } | null>(null);

  // Foreground location watcher used to keep userPosRef fresh while moving.
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);

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

  // True while long-press placement is being validated against location/OSM.
  const [isValidatingPlacement, setIsValidatingPlacement] = useState(false);

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

  // Temporary banner shown after auto-taking a spot.
  const [autoTakenBanner, setAutoTakenBanner] = useState<string | null>(null);

  // Undo banner state + undo handler.
  const { undoState, showUndoBanner, undoAutoTaken, clearUndoBanner } = useUndoState(
    myTakenReportId,
    setMyTakenReportId,
    manualTakenReportId,
    setHasManuallyTakenASpot,
    setManualTakenReportId,
  );

  // Firestore subscriptions for reports in visible area and "my reports".
  const { cloudReports, myReports } = useParkingReports(visibleRegion, uid);

  // Cloud reports eligible for auto-take checks (in region + not hidden + not expired).
  const autoTakeCloudReports = cloudReports
    .filter((report) => !hiddenCloudIds.has(report.id))
    .filter((report) => {
      const { expired } = getPinStatus(report.createdAt, getDurationSeconds(report));
      return !expired;
    });

  // Rendered cloud reports exclude cloud docs that already have a local marker copy.
  const visibleCloudReports = autoTakeCloudReports.filter(
    (report) => !spots.some((spot) => spot.firestoreId === report.id),
  );

  // Retry local fallback spots and remove them once cloud sync succeeds.
  useLocalSpotSync({
    uid,
    spots,
    setSpots,
    onSpotSynced: () => {
      setAutoTakenBanner('Queued local spot synced to cloud.');
    },
  });

  const { tryAutoTakeClosest } = useProximityAutoTake({
    uid,
    cloudReports: autoTakeCloudReports,
    userPosRef,

    isAutoTaking,
    setIsAutoTaking,

    hasManuallyTakenASpot,
    setHasManuallyTakenASpot,

    setManualTakenReportId,
    myTakenReportId,
    setMyTakenReportId,
    setTakenByMeIds,

    hiddenCloudIds,
    autoTakeRadiusM: 25, // change radius if you want

    setAutoTakenBanner,
    showUndoBanner,
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
            'Parking Spot Expiring Soon',
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
      await reopenParkingReport(reportId);

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

  const clearTakenLockState = (reportId: string | null = null) => {
    setMyTakenReportId(null);
    setHasManuallyTakenASpot(false);
    setManualTakenReportId(null);
    clearUndoBanner();

    setTakenByMeIds((prev) => {
      if (!reportId) return new Set<string>();

      const next = new Set(prev);
      next.delete(reportId);
      return next;
    });
  };

  const confirmUnstuck = () => {
    if (!uid) {
      Alert.alert('Not signed in', 'Please sign in to clear taken status.');
      return;
    }

    if (isAutoTaking || isCreatingSpot || isValidatingPlacement) return;

    const lockedId = myTakenReportId;
    const hasLock = Boolean(lockedId || hasManuallyTakenASpot);
    if (!hasLock) {
      Alert.alert('Nothing to clear', 'You do not have a taken-spot lock right now.');
      return;
    }

    Alert.alert(
      'Clear taken status?',
      'Use this if your taken status got stuck. If your taken report still exists, we will try to reopen it first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Status',
          style: 'destructive',
          onPress: async () => {
            setIsAutoTaking(true);
            try {
              let reopened = false;

              if (lockedId) {
                const report = await getParkingReportById(lockedId);
                if (report && report.status === 'resolved' && report.resolvedBy === uid) {
                  await reopenParkingReport(lockedId);
                  reopened = true;
                }
              }

              clearTakenLockState(lockedId);
              setAutoTakenBanner(
                reopened ? 'Taken status cleared and report reopened.' : 'Taken status cleared.',
              );
            } catch (err: unknown) {
              console.warn('Unstuck reopen failed; clearing local lock only:', err);
              clearTakenLockState(lockedId);
              setAutoTakenBanner('Taken status cleared locally.');
            } finally {
              setIsAutoTaking(false);
            }
          },
        },
      ],
    );
  };

  // Allows the user to manually mark a cloud report as taken.
  // Enforces: signed in, hasn't already taken one, and must be nearby.
  const manualMarkTaken = async (reportId: string, reportLat: number, reportLon: number) => {
    if (!uid) {
      Alert.alert('Not signed in', 'Please sign in to mark a spot as taken.');
      return;
    }
    if (myTakenReportId) {
      Alert.alert('Limit reached', 'You already have a taken spot. Reopen/undo it first.');
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
      await markReportTaken(reportId);

      setMyTakenReportId(reportId);
      setTakenByMeIds((prev) => {
        const next = new Set(prev);
        next.add(reportId);
        return next;
      });

      setHasManuallyTakenASpot(true);
      setManualTakenReportId(reportId);

      // Show undo banner so the user can reverse within the undo window.
      showUndoBanner(reportId, 'Marked spot as taken.');

      Alert.alert('Marked taken', 'This spot was marked as taken.');
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message ?? 'Could not mark as taken.';
      Alert.alert('Failed', message);
    } finally {
      setIsAutoTaking(false);
    }
  };

  // Shows a confirmation dialog before removing a local spot and its cloud copy (if any).
  // Shows a confirmation dialog before removing a local spot and its cloud copy (if any).
  const confirmRemoveSpot = (id: string) => {
    const spot = spots.find((s) => s.id === id);

    Alert.alert('Remove Spot?', 'Permanently remove this marker?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          // Remove locally right away
          setSpots((prev) => prev.filter((s) => s.id !== id));

          const cloudId = spot?.firestoreId;

          // If this spot was your "taken" one, immediately unlock taking another
          if (cloudId) {
            if (myTakenReportId === cloudId) {
              setMyTakenReportId(null);
            }

            if (manualTakenReportId === cloudId) {
              setHasManuallyTakenASpot(false);
              setManualTakenReportId(null);
            }

            setTakenByMeIds((prev) => {
              const next = new Set(prev);
              next.delete(cloudId);
              return next;
            });
          }

          // If there is no cloud doc, we're done
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

  // Reads the latest user position from the shared ref, falling back to a fresh GPS read.
  const getCurrentUserPos = async () => {
    if (userPosRef.current) return userPosRef.current;

    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      const pos = {
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
      };

      userPosRef.current = pos;
      return pos;
    } catch (err: unknown) {
      console.warn('Could not get current user position:', err);
      return null;
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

      userPosRef.current = {
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
      };

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
  const handleCheckNearby = async () => {
    if (isCreatingSpot || isAutoTaking || isValidatingPlacement) return;

    const userPos = await getCurrentUserPos();
    if (!userPos) {
      Alert.alert('Location unavailable', 'Could not read your location. Try again in a moment.');
      return;
    }

    await tryAutoTakeClosest({ forcePrompt: true, showWhyNot: true });
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
      <Marker
        key={`taken-${keyId}-view-v1`}
        coordinate={coord}
        onPress={onPress}
        anchor={{ x: 0.5, y: 0.5 }}
      >
        <View style={styles.takenPin}>
          <Text allowFontScaling={false} style={styles.takenPinText}>
            T
          </Text>
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
      const takenByMe = data.id === myTakenReportId;
      if (!takenByMe) return null;

      return renderTakenTMarker(data.id, coord.latitude, coord.longitude, () => {
        setSelectedMarker({ data, isCloud: true });
      });
    }

    const durationSeconds = getDurationSeconds(data);
    const { color, expired } = getPinStatus(data.createdAt, durationSeconds);

    if (expired) return null;

    return (
      <Marker
        key={`${isCloud ? 'cloud' : 'local'}-${data.id}-view-v1`}
        coordinate={coord}
        onPress={() => setSelectedMarker({ data, isCloud })}
        anchor={{ x: 0.5, y: 0.5 }}
      >
        <View style={[styles.customPin, { backgroundColor: color }]}>
          <Text allowFontScaling={false} style={styles.pinText}>
            {data.type === 'free' ? 'F' : '$'}
          </Text>
        </View>
      </Marker>
    );
  };

  // Handles long-press on the map: enforce distance to user, validate near road/parking,
  // then open the NewSpotModal.
  const handleMapLongPress = async (event: MapLongPressEvent) => {
    if (isCreatingSpot || isValidatingPlacement) return;

    setIsValidatingPlacement(true);
    try {
      const { latitude, longitude } = event.nativeEvent.coordinate;

      const userPos = await getCurrentUserPos();
      if (!userPos) {
        Alert.alert('Location unavailable', 'Could not read your location. Try again in a moment.');
        return;
      }

      const tapDistanceM = distanceMeters(userPos.lat, userPos.lon, latitude, longitude);
      if (tapDistanceM > MAX_PIN_PLACE_DISTANCE_M) {
        Alert.alert(
          'Pin too far away',
          `Pins can only be placed within ${MAX_PIN_PLACE_DISTANCE_M}m of you.\n\nSelected point: ${Math.round(tapDistanceM)}m away.`,
        );
        return;
      }

      const isRoadOrParking = await withTimeoutFallback(
        isNearRoadOrParkingOSM(latitude, longitude),
        PLACEMENT_VALIDATE_TIMEOUT_MS,
        false,
      );
      if (!isRoadOrParking) {
        Alert.alert(
          'Invalid placement',
          'Could not verify this point as a road/parking area. Move closer to a road or lot and try again.',
        );
        return;
      }

      setPendingCoord({ latitude, longitude });
      setShowModal(true);
    } finally {
      setIsValidatingPlacement(false);
    }
  };

  // Debounces the visible region update to avoid excessive Firestore queries.
  const handleRegionChangeComplete = (r: Region) => {
    if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
    regionDebounceRef.current = setTimeout(() => setVisibleRegion(r), REGION_DEBOUNCE_MS);
  };

  // Effects

  // Keep userPosRef updated continuously so auto-take can react while moving.
  useEffect(() => {
    let mounted = true;

    const startWatchingLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        locationWatchRef.current?.remove();
        locationWatchRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: LOCATION_WATCH_TIME_INTERVAL_MS,
            distanceInterval: LOCATION_WATCH_DISTANCE_INTERVAL_M,
          },
          (loc) => {
            if (!mounted) return;

            userPosRef.current = {
              lat: loc.coords.latitude,
              lon: loc.coords.longitude,
            };
          },
        );
      } catch (err: unknown) {
        console.warn('Failed to start location watcher:', err);
      }
    };

    void startWatchingLocation();

    return () => {
      mounted = false;
      locationWatchRef.current?.remove();
      locationWatchRef.current = null;
    };
  }, []);

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

        if (status !== 'granted') {
          setRegion(DEFAULT_REGION);
          setVisibleRegion(DEFAULT_REGION);
          return;
        }

        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Highest,
          });

          userPosRef.current = {
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
          };

          const userRegion: Region = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            ...USER_CENTER_DELTA,
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

  // Verify our taken report is still resolved by us when that report is in the current viewport.
  useEffect(() => {
    if (!uid || !myTakenReportId) return;

    const report = cloudReports.find((x) => x.id === myTakenReportId);

    // The report may be outside the current visible region; do not unlock based on that.
    if (!report) return;

    const stillMine = report.status === 'resolved' && report.resolvedBy === uid;

    if (!stillMine) {
      setMyTakenReportId(null);

      setTakenByMeIds((prev) => {
        const next = new Set(prev);
        next.delete(myTakenReportId);
        return next;
      });

      if (manualTakenReportId === myTakenReportId) {
        setHasManuallyTakenASpot(false);
        setManualTakenReportId(null);
      }
    }
  }, [
    cloudReports,
    uid,
    myTakenReportId,
    manualTakenReportId,
    setHasManuallyTakenASpot,
    setManualTakenReportId,
    setTakenByMeIds,
  ]);

  // Keep taken lock healthy over time: clear if report is missing, no longer resolved by us,
  // or expired (auto-untake on expiry to avoid softlocks).
  useEffect(() => {
    if (!uid || !myTakenReportId) return;

    // Poll lightly while a taken lock exists.
    if (tick % 5 !== 0) return;

    let cancelled = false;

    void (async () => {
      try {
        const inViewReport = cloudReports.find((x) => x.id === myTakenReportId);
        const report = inViewReport ?? (await getParkingReportById(myTakenReportId));

        if (cancelled) return;

        if (!report) {
          clearTakenLockState(myTakenReportId);
          setAutoTakenBanner('Cleared stale taken status.');
          return;
        }

        const stillMine = report.status === 'resolved' && report.resolvedBy === uid;
        if (!stillMine) {
          clearTakenLockState(report.id);
          setAutoTakenBanner('Cleared stale taken status.');
          return;
        }

        const durationSeconds = report.durationSeconds ?? 30;
        const { expired } = getPinStatus(report.createdAt, durationSeconds);
        if (!expired) return;

        try {
          await reopenParkingReport(report.id);
        } catch (err: unknown) {
          console.warn('Failed to reopen expired taken report (clearing local lock anyway):', err);
        }

        if (cancelled) return;

        clearTakenLockState(report.id);
        setAutoTakenBanner('Taken spot expired and was automatically cleared.');
      } catch (err: unknown) {
        console.warn('Failed to validate taken status:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tick, uid, myTakenReportId, cloudReports]);

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
        {visibleCloudReports.map((report) => renderMarker(report, true))}
      </MapView>
      {/* Overlays: busy indicator, undo banner, legend, history, sign-out, and recenter */}
      <MapOverlays
        isCreatingSpot={isCreatingSpot}
        isAutoTaking={isAutoTaking}
        isValidatingPlacement={isValidatingPlacement}
        undoState={undoState}
        autoTakenBanner={autoTakenBanner}
        showUnstuckButton={Boolean(myTakenReportId || hasManuallyTakenASpot)}
        onUndo={undoAutoTaken}
        onShowHistory={() => setShowHistory(true)}
        onSignOut={handleSignOut}
        onRecenter={centerOnUser}
        onCheckNearby={handleCheckNearby}
        onUnstuck={confirmUnstuck}
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
        setAutoTakenBanner={setAutoTakenBanner}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  customPin: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    borderWidth: 2,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },

  pinText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: PIN_FONT_SIZE,
    lineHeight: PIN_FONT_SIZE + 1,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },

  takenPin: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    backgroundColor: 'red',
    borderWidth: 2,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },

  takenPinText: {
    color: 'white',
    fontWeight: '900',
    fontSize: TAKEN_PIN_FONT_SIZE,
    lineHeight: TAKEN_PIN_FONT_SIZE + 1,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
