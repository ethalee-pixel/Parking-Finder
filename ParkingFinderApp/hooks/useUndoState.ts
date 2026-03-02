import { useState, useRef, useEffect } from "react";
import { Alert } from "react-native";
import { doc, updateDoc } from "firebase/firestore";
import { FIRESTORE_DB } from "../FirebaseConfig";

const UNDO_WINDOW_MS = 45_000;

export const useUndoState = (
  myTakenReportId: string | null,
  setMyTakenReportId: (id: string | null) => void,
  manualTakenReportId: string | null,
  setHasManuallyTakenASpot: (v: boolean) => void,
  setManualTakenReportId: (id: string | null) => void,
) => {
  const [undoState, setUndoState] = useState<{
    reportId: string;
    expiresAt: number;
    isProcessing: boolean;
  } | null>(null);

  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUndoBanner = (reportId: string) => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    const expiresAt = Date.now() + UNDO_WINDOW_MS;
    setUndoState({ reportId, expiresAt, isProcessing: false });

    undoTimerRef.current = setTimeout(() => {
      setUndoState(null);
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  };

  const undoAutoTaken = async () => {
    if (!undoState) return;

    if (Date.now() > undoState.expiresAt) {
      setUndoState(null);
      return;
    }

    if (undoState.isProcessing) return;

    setUndoState({ ...undoState, isProcessing: true });

    try {
      await updateDoc(
        doc(FIRESTORE_DB, "parkingReports", undoState.reportId),
        {
          status: "open",
          resolvedAt: null,
          resolvedBy: null,
        },
      );

      if (myTakenReportId === undoState.reportId) setMyTakenReportId(null);

      if (manualTakenReportId === undoState.reportId) {
        setHasManuallyTakenASpot(false);
        setManualTakenReportId(null);
      }

      setUndoState(null);
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
    } catch (e: any) {
      setUndoState({ ...undoState, isProcessing: false });
      Alert.alert(
        "Undo failed",
        e?.message ?? "Could not undo the auto-taken update.",
      );
    }
  };

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
    };
  }, []);

  return { undoState, showUndoBanner, undoAutoTaken };
};