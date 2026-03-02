// time.ts
// Time utilities: timestamp normalization, age calculation,
// duration formatting, and marker status (color/expiry).

type FirestoreLikeTimestamp = { seconds: number };

/**
 * Converts various timestamp formats into a JS millisecond timestamp.
 * Accepts:
 *  - Firestore Timestamp (has .seconds)
 *  - number (ms since epoch)
 *  - Date
 *  - ISO date string
 */
export function getTimeInMillis(timeData: unknown): number {
  if (!timeData) return Date.now();

  // Firestore Timestamp
  if (typeof timeData === 'object' && timeData !== null && 'seconds' in timeData) {
    const ts = timeData as FirestoreLikeTimestamp;
    return ts.seconds * 1000;
  }

  if (typeof timeData === 'number') return timeData;

  if (timeData instanceof Date) return timeData.getTime();

  return new Date(timeData as string).getTime();
}

/**
 * Returns how many seconds old a parking spot is.
 */
export function getAgeInSeconds(createdAt: unknown): number {
  const timeInMillis = getTimeInMillis(createdAt);
  return Math.floor((Date.now() - timeInMillis) / 1000);
}

/**
 * Formats a number of seconds into a human-readable duration.
 * Examples:
 *  3661 -> "1h 1m"
 *  90   -> "1m 30s"
 *  45   -> "45s"
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export type PinStatus = {
  color: string;
  expired: boolean;
  warning: boolean;
  age: number;
};

/**
 * Determines marker color and state based on age vs duration.
 * - Grey   (#999999): expired
 * - Red    (#FF0000): last 10% of lifetime
 * - Green  (#00FF00): active
 */
export function getPinStatus(createdAt: unknown, durationSeconds: number): PinStatus {
  const age = getAgeInSeconds(createdAt);
  const warningThreshold = Math.floor(durationSeconds * 0.9);

  if (age >= durationSeconds) {
    return { color: '#999999', expired: true, warning: false, age };
  }

  if (age >= warningThreshold) {
    return { color: '#FF0000', expired: false, warning: true, age };
  }

  return { color: '#00FF00', expired: false, warning: false, age };
}
