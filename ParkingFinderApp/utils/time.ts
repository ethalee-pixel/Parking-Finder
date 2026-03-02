// Time utilities: converting timestamps, calculating age,
// formatting durations, and determining pin color status.

// Normalizes various timestamp formats (Firestore Timestamp, Unix ms, Date string)
// into a plain JavaScript millisecond timestamp.
export function getTimeInMillis(timeData: any) {
  if (!timeData) return Date.now();
  // Firestore Timestamps have a .seconds property
  if (timeData.seconds) return timeData.seconds * 1000;
  return typeof timeData === "number"
    ? timeData
    : new Date(timeData).getTime();
}

// Returns how many seconds old a parking spot is based on its createdAt timestamp
export const getAgeInSeconds = (createdAt: any) => {
  const timeInMillis = getTimeInMillis(createdAt);
  return Math.floor((Date.now() - timeInMillis) / 1000);
};

// Formats a number of seconds into a human-readable string.
// Examples: 3661s -> "1h 1m", 90s -> "1m 30s", 45s -> "45s"
export const formatDuration = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

// Returns the color and state for a parking spot marker based on its age.
// - Grey (#999999) + expired=true: spot has fully expired
// - Red (#FF0000) + warning=true: spot is in the last 10% of its lifetime
// - Green (#00FF00): spot is active and not yet near expiry
export const getPinStatus = (createdAt: any, durationSeconds: number) => {
  const age = getAgeInSeconds(createdAt);
  // Warn when the spot has used 90% of its allowed time
  const warningThreshold = Math.floor(durationSeconds * 0.9);

  if (age >= durationSeconds) {
    return { color: "#999999", expired: true, warning: false, age };
  }
  if (age >= warningThreshold) {
    return { color: "#FF0000", expired: false, warning: true, age };
  }
  return { color: "#00FF00", expired: false, warning: false, age };
};