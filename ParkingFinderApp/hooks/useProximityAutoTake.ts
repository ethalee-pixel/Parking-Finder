// useProximityAutoTake.ts
//
// Nearby flow for "I'm parked":
// 1) If an OPEN pin is very close, ask to mark that one as TAKEN.
// 2) If not, ask to create a new pin at the user's location and mark it TAKEN.
//
// Enforces: one taken pin at a time via myTakenReportId gate.

import { useEffect, useMemo, useRef } from 'react';
import { Alert, AppState } from 'react-native';

import {
  createParkingReport,
  getParkingReportById,
  markReportTaken,
  reopenParkingReport,
  type ParkingReport,
} from '../services/parkingReports';

type UserPos = { lat: number; lon: number };

const DEFAULT_AUTO_TAKE_RADIUS_M = 25;
const DEFAULT_AUTO_PLACE_DURATION_SECONDS = 30;
const AUTO_REOPEN_MS = 60 * 60 * 1000;

// How long to "ignore" a report after you undo it (prevents instant retake)
const UNDO_COOLDOWN_MS = 90_000;

// Avoid re-prompting the same auto action repeatedly when the user taps "Not now".
const ACTION_PROMPT_COOLDOWN_MS = 60_000;
const AUTO_TAKE_NETWORK_TIMEOUT_MS = 8_000;

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function timestampToMs(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;

  const maybeTimestamp = value as { toMillis?: unknown };
  if (typeof maybeTimestamp.toMillis !== 'function') return null;

  return (maybeTimestamp.toMillis as () => number)();
}

function pickClosestOpenReport(
  reports: ParkingReport[],
  userPos: UserPos,
  radiusM: number,
  hiddenIds?: Set<string>,
): { report: ParkingReport; distM: number } | null {
  let best: { report: ParkingReport; distM: number } | null = null;

  for (const report of reports) {
    if (!report) continue;
    if (report.status !== 'open') continue;
    if (hiddenIds && hiddenIds.has(report.id)) continue;

    const distanceM = distanceMeters(userPos.lat, userPos.lon, report.latitude, report.longitude);
    if (distanceM > radiusM) continue;

    if (!best || distanceM < best.distM) {
      best = { report, distM: distanceM };
    }
  }

  return best;
}

function toPlacePromptKey(userPos: UserPos): string {
  // 4 decimals ~ 11m precision. Good enough for de-duping repeated prompts in one area.
  return `place:${userPos.lat.toFixed(4)}:${userPos.lon.toFixed(4)}`;
}

function confirmAutoAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    Alert.alert(
      title,
      message,
      [
        { text: 'Not now', style: 'cancel', onPress: () => finish(false) },
        { text: confirmLabel, onPress: () => finish(true) },
      ],
      {
        cancelable: true,
        onDismiss: () => finish(false),
      },
    );
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return (await Promise.race([promise, timeoutPromise])) as T;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

type Params = {
  uid: string | null;
  cloudReports: ParkingReport[];

  userPosRef: React.MutableRefObject<UserPos | null>;

  // Gate + UI state from Map screen
  isAutoTaking: boolean;
  setIsAutoTaking: (v: boolean) => void;

  hasManuallyTakenASpot: boolean;
  setHasManuallyTakenASpot: (v: boolean) => void;

  // One-taken-at-a-time gate
  myTakenReportId: string | null;

  setManualTakenReportId: (id: string | null) => void;
  setMyTakenReportId: (id: string | null) => void;
  setTakenByMeIds: (fn: (prev: Set<string>) => Set<string>) => void;

  hiddenCloudIds?: Set<string>;
  autoTakeRadiusM?: number;

  setAutoTakenBanner?: (v: string | null) => void;
  showUndoBanner?: (id: string, message?: string) => void;
};

export function useProximityAutoTake({
  uid,
  cloudReports,
  userPosRef,

  isAutoTaking,
  setIsAutoTaking,

  hasManuallyTakenASpot,
  setHasManuallyTakenASpot,

  myTakenReportId,

  setManualTakenReportId,
  setMyTakenReportId,
  setTakenByMeIds,

  hiddenCloudIds,
  autoTakeRadiusM,
  setAutoTakenBanner,
  showUndoBanner,
}: Params) {
  const radiusM = autoTakeRadiusM ?? DEFAULT_AUTO_TAKE_RADIUS_M;

  // Prevent re-taking the same report repeatedly (GPS jitter / snapshot churn).
  const alreadyAutoTakenRef = useRef<Set<string>>(new Set());

  // Cooldowns for undone reports: id -> untilMs
  const cooldownUntilRef = useRef<Map<string, number>>(new Map());

  // Cooldowns for declined prompts: actionKey -> untilMs
  const promptCooldownUntilRef = useRef<Map<string, number>>(new Map());

  // Guard against stacking multiple Alert popups.
  const promptInFlightRef = useRef(false);

  // Track a scheduled reopen timer for the report you took.
  const reopenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canTakeAny = useMemo(() => {
    return Boolean(uid) && !hasManuallyTakenASpot && !isAutoTaking && !myTakenReportId;
  }, [uid, hasManuallyTakenASpot, isAutoTaking, myTakenReportId]);

  const isInCooldown = (reportId: string) => {
    const until = cooldownUntilRef.current.get(reportId);
    if (!until) return false;

    if (Date.now() >= until) {
      cooldownUntilRef.current.delete(reportId);
      return false;
    }

    return true;
  };

  const isPromptSuppressed = (actionKey: string) => {
    const until = promptCooldownUntilRef.current.get(actionKey);
    if (!until) return false;

    if (Date.now() >= until) {
      promptCooldownUntilRef.current.delete(actionKey);
      return false;
    }

    return true;
  };

  const suppressPrompt = (actionKey: string) => {
    promptCooldownUntilRef.current.set(actionKey, Date.now() + ACTION_PROMPT_COOLDOWN_MS);
  };

  const markTakenInState = (reportId: string) => {
    setHasManuallyTakenASpot(true);
    setManualTakenReportId(reportId);
    setMyTakenReportId(reportId);
    setTakenByMeIds((prev) => {
      const next = new Set(prev);
      next.add(reportId);
      return next;
    });
  };

  const clearTakenInState = (reportId: string) => {
    setHasManuallyTakenASpot(false);
    setManualTakenReportId(null);
    setMyTakenReportId(null);
    setTakenByMeIds((prev) => {
      const next = new Set(prev);
      next.delete(reportId);
      return next;
    });
  };

  const scheduleAutoReopen = (reportId: string) => {
    if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);

    reopenTimerRef.current = setTimeout(async () => {
      try {
        await reopenParkingReport(reportId);
        clearTakenInState(reportId);
        setAutoTakenBanner?.('Spot auto-reopened after 1 hour.');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.log('Auto-reopen failed:', message);
      }
    }, AUTO_REOPEN_MS);
  };

  const runTakeFlow = async (reportId: string, undoMessage: string) => {
    setIsAutoTaking(true);
    alreadyAutoTakenRef.current.add(reportId);

    try {
      await withTimeout(
        markReportTaken(reportId),
        AUTO_TAKE_NETWORK_TIMEOUT_MS,
        'Mark taken request timed out.',
      );

      markTakenInState(reportId);
      showUndoBanner?.(reportId, undoMessage);
      scheduleAutoReopen(reportId);
    } catch (err: unknown) {
      alreadyAutoTakenRef.current.delete(reportId);
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Auto-take failed', message);
    } finally {
      setIsAutoTaking(false);
    }
  };

  const runPlaceAndTakeFlow = async (userPos: UserPos) => {
    setIsAutoTaking(true);

    let reportId: string | null = null;

    try {
      reportId = await withTimeout(
        createParkingReport({
          latitude: userPos.lat,
          longitude: userPos.lon,
          type: 'free',
          durationSeconds: DEFAULT_AUTO_PLACE_DURATION_SECONDS,
        }),
        AUTO_TAKE_NETWORK_TIMEOUT_MS,
        'Auto-place request timed out.',
      );

      alreadyAutoTakenRef.current.add(reportId);
      await withTimeout(
        markReportTaken(reportId),
        AUTO_TAKE_NETWORK_TIMEOUT_MS,
        'Mark taken request timed out.',
      );

      markTakenInState(reportId);
      showUndoBanner?.(reportId, 'Placed a new pin and marked it as taken.');
      scheduleAutoReopen(reportId);
    } catch (err: unknown) {
      if (reportId) alreadyAutoTakenRef.current.delete(reportId);

      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Auto place failed', message);
    } finally {
      setIsAutoTaking(false);
    }
  };

  // Call this after an UNDO succeeds so we don't instantly retake it.
  const markUndone = (reportId: string) => {
    cooldownUntilRef.current.set(reportId, Date.now() + UNDO_COOLDOWN_MS);
    alreadyAutoTakenRef.current.delete(reportId);
  };

  const tryAutoTakeClosest = async () => {
    if (!uid) return;
    if (!canTakeAny) return;
    if (promptInFlightRef.current) return;

    const userPos = userPosRef.current;
    if (!userPos) return;

    const best = pickClosestOpenReport(cloudReports, userPos, radiusM, hiddenCloudIds);

    if (best) {
      const reportId = best.report.id;
      const promptKey = `take:${reportId}`;

      if (alreadyAutoTakenRef.current.has(reportId)) return;
      if (isInCooldown(reportId)) return;
      if (isPromptSuppressed(promptKey)) return;

      promptInFlightRef.current = true;
      try {
        const confirmed = await confirmAutoAction(
          'Nearby parking spot found',
          `You are about ${Math.round(best.distM)}m from an open pin. Mark it as taken?`,
          'Mark Taken',
        );

        if (!confirmed) {
          suppressPrompt(promptKey);
          return;
        }
      } finally {
        promptInFlightRef.current = false;
      }

      await runTakeFlow(reportId, `Marked nearby spot as taken (${Math.round(best.distM)}m away).`);
      return;
    }

    const placePromptKey = toPlacePromptKey(userPos);
    if (isPromptSuppressed(placePromptKey)) return;

    promptInFlightRef.current = true;
    try {
      const confirmed = await confirmAutoAction(
        'No nearby open spot',
        'No open pin is very close. Place a new pin at your location and mark it as taken?',
        'Place + Take',
      );

      if (!confirmed) {
        suppressPrompt(placePromptKey);
        return;
      }
    } finally {
      promptInFlightRef.current = false;
    }

    await runPlaceAndTakeFlow(userPos);
  };

  // Poll for proximity auto actions every few seconds.
  useEffect(() => {
    if (!uid) return;

    const interval = setInterval(() => {
      void tryAutoTakeClosest();
    }, 2500);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, cloudReports, radiusM, isAutoTaking, hasManuallyTakenASpot, myTakenReportId]);

  // Catch-up reopen when app becomes active again.
  useEffect(() => {
    if (!uid) return;

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (!myTakenReportId) return;

      void (async () => {
        try {
          const report = await getParkingReportById(myTakenReportId);
          if (!report) return;
          if (report.status !== 'resolved') return;

          const resolvedAtMs = timestampToMs(report.resolvedAt);
          if (!resolvedAtMs) return;

          if (Date.now() - resolvedAtMs >= AUTO_REOPEN_MS) {
            await reopenParkingReport(myTakenReportId);
            clearTakenInState(myTakenReportId);
            setAutoTakenBanner?.('Spot auto-reopened (catch-up).');
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.log('Catch-up reopen failed:', message);
        }
      })();
    });

    return () => sub.remove();
  }, [uid, myTakenReportId, setAutoTakenBanner]);

  useEffect(() => {
    return () => {
      if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);
    };
  }, []);

  return { tryAutoTakeClosest, alreadyAutoTakenRef, markUndone };
}
