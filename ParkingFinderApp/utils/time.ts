export function getTimeInMillis(timeData: any) {
  if (!timeData) return Date.now();
  if (timeData.seconds) return timeData.seconds * 1000;
  return typeof timeData === "number"
    ? timeData
    : new Date(timeData).getTime();
}

export const getAgeInSeconds = (createdAt: any) => {
  const timeInMillis = getTimeInMillis(createdAt);
  return Math.floor((Date.now() - timeInMillis) / 1000);
};

export const formatDuration = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

export const getPinStatus = (createdAt: any, durationSeconds: number) => {
  const age = getAgeInSeconds(createdAt);
  const warningThreshold = Math.floor(durationSeconds * 0.9);

  if (age >= durationSeconds) {
    return { color: "#999999", expired: true, warning: false, age };
  }
  if (age >= warningThreshold) {
    return { color: "#FF0000", expired: false, warning: true, age };
  }
  return { color: "#00FF00", expired: false, warning: false, age };
};