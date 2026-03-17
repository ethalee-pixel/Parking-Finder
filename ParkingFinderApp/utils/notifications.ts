// notifications.ts
// Notification utilities: requesting permissions and scheduling expiry warnings.

import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { formatDuration } from './time';

type SpotType = 'free' | 'paid';

// Configure how notifications appear when the app is in the foreground.
// Runs once when this module is imported.
Notifications.setNotificationHandler({
  handleNotification: async (): Promise<Notifications.NotificationBehavior> => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true, // iOS
    shouldShowList: true, // iOS
  }),
});

// Requests notification permissions if not already granted.
// Returns true if granted, false otherwise.
export async function requestNotificationPermissions(): Promise<boolean> {
  // user story 1.3
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Only prompt if not already granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    Alert.alert(
      'Permission Required',
      'Please enable notifications to get alerts when your parking spots are expiring.',
    );
    return false;
  }

  return true;
}

// Schedules a local notification to fire at 90% of the spot's lifetime.
// Note: Expo Go on iOS does not support scheduled local notifications, so this is skipped.
export async function scheduleSpotNotification(
  spotId: string,
  durationSeconds: number,
  spotType: SpotType,
): Promise<string | null> {
  // Keep the parameter to allow cancellation later if you add it.
  void spotId;

  if (Platform.OS === 'ios') return null;

  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return null;

  // user story 1.3
  const warningTimeSeconds = Math.floor(durationSeconds * 0.9);
  const secondsRemaining = Math.max(0, durationSeconds - warningTimeSeconds);

  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Parking Spot Expiring Soon',
        body: `Your ${
          spotType === 'free' ? 'Free' : 'Paid'
        } parking spot will expire in ${formatDuration(secondsRemaining)}!`,
        sound: true,

        // Android options
        vibrate: [0, 250, 250, 250],
        priority: Notifications.AndroidNotificationPriority.HIGH,
        ...(Platform.OS === 'android' ? { channelId: 'parking-alerts' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: warningTimeSeconds,
        repeats: false,
      },
    });

    return notificationId;
  } catch (err: unknown) {
    console.warn('Failed to schedule spot notification:', err);
    return null;
  }
}
