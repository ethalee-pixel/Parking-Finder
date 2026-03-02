import { Platform, Alert } from "react-native";
import * as Notifications from "expo-notifications";
import { formatDuration } from "./time";

Notifications.setNotificationHandler({
  handleNotification:
    async (): Promise<Notifications.NotificationBehavior> => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
});

export const requestNotificationPermissions = async () => {
  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

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

export const scheduleSpotNotification = async (
  spotId: string,
  durationSeconds: number,
  spotType_: string,
) => {
  if (Platform.OS === "ios") return null;

  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return null;

  const warningTime = Math.floor(durationSeconds * 0.9);
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
        ...(Platform.OS === "android" && { channelId: "parking-alerts" }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: warningTime,
        repeats: false,
      },
    });
    return notificationId;
  } catch {
    return null;
  }
};