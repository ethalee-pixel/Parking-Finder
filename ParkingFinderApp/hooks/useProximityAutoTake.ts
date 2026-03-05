// useProximityAutoTake.ts
//
// Automatically marks the closest nearby OPEN pin as TAKEN when you get close enough.
// Enforces: you can only have ONE taken pin at a time (via myTakenReportId gate).
// Adds: cooldown after undo so it won't instantly retake the same report.
//
// NOTE: true "reopen after 1 hour even if app is closed" needs server-side job.

import { useEffect, useMemo, useRef } from "react";
import { Alert, AppState } from "react-native";
import { doc, getDoc, updateDoc } from "firebase/firestore";

import { FIRESTORE_DB } from "../FirebaseConfig";
import { markReportTaken, type ParkingReport } from "../services/parkingReports";

type UserPos = { lat: number; lon: number };

const DEFAULT_AUTO_TAKE_RADIUS_M = 25;
const AUTO_REOPEN_MS = 60 * 60 * 1000;

// How long to "ignore" a report after you undo it (prevents instant retake)
const UNDO_COOLDOWN_MS = 90_000; // 90s (tune)

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

async function reopenReport(reportId: string): Promise<void> {
  await updateDoc(doc(FIRESTORE_DB, "parkingReports", reportId), {
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
  });
}

function pickClosestOpenReport(
  reports: ParkingReport[],
  userPos: UserPos,
  radiusM: number,
  hiddenIds?: Set<string>,
): { report: ParkingReport; distM: number } | null {
  let best: { report: ParkingReport; distM: number } | null = null;

  for (const r of reports) {
    if (!r) continue;
    if (r.status !== "open") continue;
    if (hiddenIds && hiddenIds.has(r.id)) continue;

    const d = distanceMeters(userPos.lat, userPos.lon, r.latitude, r.longitude);
    if (d > radiusM) continue;

    if (!best || d < best.distM) best = { report: r, distM: d };
  }

  return best;
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

  // ✅ THIS is the "only one taken at a time" gate
  myTakenReportId: string | null;

  setManualTakenReportId: (id: string | null) => void;
  setMyTakenReportId: (id: string | null) => void;
  setTakenByMeIds: (fn: (prev: Set<string>) => Set<string>) => void;

  hiddenCloudIds?: Set<string>;
  autoTakeRadiusM?: number;

  setAutoTakenBanner?: (v: string | null) => void;
  showUndoBanner?: (id: string) => void;
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

  // Call this after an UNDO succeeds so we don't instantly retake it.
  const markUndone = (reportId: string) => {
    cooldownUntilRef.current.set(reportId, Date.now() + UNDO_COOLDOWN_MS);
    // also allow future auto-takes later
    alreadyAutoTakenRef.current.delete(reportId);
  };

  const tryAutoTakeClosest = async () => {
    if (!uid) return;
    if (!canTakeAny) return;

    const userPos = userPosRef.current;
    if (!userPos) return;

    const best = pickClosestOpenReport(cloudReports, userPos, radiusM, hiddenCloudIds);
    if (!best) return;

    const reportId = best.report.id;

    if (alreadyAutoTakenRef.current.has(reportId)) return;
    if (isInCooldown(reportId)) return;

    setIsAutoTaking(true);
    alreadyAutoTakenRef.current.add(reportId);

    try {
      await markReportTaken(reportId);

      // Enforce one-take rule
      setHasManuallyTakenASpot(true);
      setManualTakenReportId(reportId);
      setMyTakenReportId(reportId);
      setTakenByMeIds((prev) => {
        const next = new Set(prev);
        next.add(reportId);
        return next;
      });

      setAutoTakenBanner?.(`Auto-took closest spot (${Math.round(best.distM)}m away).`);
      showUndoBanner?.(reportId);

      // Auto-reopen after 1 hour (while app is running)
      if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);
      reopenTimerRef.current = setTimeout(async () => {
        try {
          await reopenReport(reportId);
          setHasManuallyTakenASpot(false);
          setManualTakenReportId(null);
          setMyTakenReportId(null);
          setAutoTakenBanner?.("Spot auto-reopened after 1 hour.");
        } catch (e: any) {
          console.log("Auto-reopen failed:", e?.message ?? e);
        }
      }, AUTO_REOPEN_MS);
    } catch (e: any) {
      alreadyAutoTakenRef.current.delete(reportId);
      Alert.alert("Auto-take failed", e?.message ?? String(e));
    } finally {
      setIsAutoTaking(false);
    }
  };

  // Poll for proximity-taking every few seconds
  useEffect(() => {
    if (!uid) return;

    const interval = setInterval(() => {
      void tryAutoTakeClosest();
    }, 2500);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, cloudReports, radiusM, isAutoTaking, hasManuallyTakenASpot, myTakenReportId]);

  // Catch-up reopen when app becomes active again
  useEffect(() => {
    if (!uid) return;

    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;

      const maybe = Array.from(alreadyAutoTakenRef.current.values());
      const candidateId = maybe.length === 1 ? maybe[0] : null;
      if (!candidateId) return;

      void (async () => {
        try {
          const snap = await getDoc(doc(FIRESTORE_DB, "parkingReports", candidateId));
          if (!snap.exists()) return;

          const data = snap.data() as any;
          if (data.status !== "resolved") return;

          const resolvedAtMs =
            typeof data.resolvedAt?.toMillis === "function" ? data.resolvedAt.toMillis() : null;

          if (!resolvedAtMs) return;

          if (Date.now() - resolvedAtMs >= AUTO_REOPEN_MS) {
            await reopenReport(candidateId);
            setHasManuallyTakenASpot(false);
            setManualTakenReportId(null);
            setMyTakenReportId(null);
            setAutoTakenBanner?.("Spot auto-reopened (catch-up).");
          }
        } catch (e: any) {
          console.log("Catch-up reopen failed:", e?.message ?? e);
        }
      })();
    });

    return () => sub.remove();
  }, [uid, setHasManuallyTakenASpot, setManualTakenReportId, setMyTakenReportId, setAutoTakenBanner]);

  useEffect(() => {
    return () => {
      if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);
    };
  }, []);

  return { tryAutoTakeClosest, alreadyAutoTakenRef, markUndone };
}