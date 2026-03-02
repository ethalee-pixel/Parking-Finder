// Notification utilities: requesting permissions and scheduling
// expiry warning notifications for parking spots.

import { Platform, Alert } from "react-native";
import * as Notifications from "expo-notifications";
import { formatDuration } from "./time";

// Configure how notifications appear when the app is in the foreground.
// This runs once when the module is first imported.
Notifications.setNotificationHandler({
  handleNotification:
    async (): Promise<Notifications.NotificationBehavior> => ({
      shouldShowAlert: true,   // Show the alert banner
      shouldPlaySound: true,   // Play the notification sound
      shouldSetBadge: false,   // Don't update the app icon badge count
      shouldShowBanner: true,  // iOS: show the banner
      shouldShowList: true,    // iOS: show in notification center
    }),
});

// Requests notification permissions from the user if not already granted.
// Shows an alert explaining why permissions are needed if denied.
// Returns true if permissions are granted, false otherwise.
export const requestNotificationPermissions = async () => {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Only prompt if not already granted
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    Alert.alert(
      "Permission Required",
      "Please enable notifications to get alerts when your parking spots are expiring.",
    );
    return false;
  }
  return true;
};

// Schedules a local notification to fire at 90% of the spot's duration,
// warning the user that their spot is about to expire.
// iOS in Expo Go doesn't support scheduled notifications, so this is skipped there.
export const scheduleSpotNotification = async (
  spotId: string,
  durationSeconds: number,
  spotType_: string,
) => {
  // Expo Go on iOS doesn't support scheduled local notifications
  if (Platform.OS === "ios") return null;

  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return null;

  // Fire the warning at 90% of the spot's lifetime
  const warningTime = Math.floor(durationSeconds * 0.9);
  // Tell the user how much time they have left when the notification fires
  const timeRemaining = durationSeconds - warningTime;

  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "⚠️ Parking Spot Expiring Soon",
        body: `Your ${
          spotType_ === "free" ? "Free" : "Paid"
        } parking spot will expire in ${formatDuration(timeRemaining)}!`,
        sound: true,
        vibrate: [0, 250, 250, 250],
        priority: Notifications.AndroidNotificationPriority.HIGH,
        // Android requires the channelId to be specified (channel created in Map.tsx)
        ...(Platform.OS === "android" && { channelId: "parking-alerts" }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: warningTime, // Fire after this many seconds
        repeats: false,
      },
    });
    return notificationId;
  } catch {
    return null;
  }
};