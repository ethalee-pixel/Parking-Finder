// useUndoState - manages the undo banner that appears after a spot is marked taken.
// Gives the user a 45-second window to reverse the action.

import { useState, useRef, useEffect } from "react";
import { Alert } from "react-native";
import { doc, updateDoc } from "firebase/firestore";
import { FIRESTORE_DB } from "../FirebaseConfig";

// How long (ms) the user has to undo a mark-taken action
const UNDO_WINDOW_MS = 45_000;

export const useUndoState = (
  myTakenReportId: string | null,
  setMyTakenReportId: (id: string | null) => void,
  // The report that was manually taken - needed to unlock the one-taken limit on undo
  manualTakenReportId: string | null,
  setHasManuallyTakenASpot: (v: boolean) => void,
  setManualTakenReportId: (id: string | null) => void,
) => {
  // Active undo opportunity - null when no undo is available
  const [undoState, setUndoState] = useState<{
    reportId: string;
    expiresAt: number;     // Timestamp when the undo window expires
    isProcessing: boolean; // True while the undo Firestore write is in flight
  } | null>(null);

  // Ref to the auto-dismiss timer so we can cancel it if a new undo starts
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shows the undo banner for a given report ID and starts the 45-second countdown.
  // Cancels any previously active undo timer first.
  const showUndoBanner = (reportId: string) => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    const expiresAt = Date.now() + UNDO_WINDOW_MS;
    setUndoState({ reportId, expiresAt, isProcessing: false });

    // Auto-dismiss the banner when the window expires
    undoTimerRef.current = setTimeout(() => {
      setUndoState(null);
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  };

  // Reverses a mark-taken action by setting the report status back to "open".
  // Also unlocks the one-manual-taken limit if this was the manual report.
  const undoAutoTaken = async () => {
    if (!undoState) return;

    // Reject undo if the window has already expired
    if (Date.now() > undoState.expiresAt) {
      setUndoState(null);
      return;
    }

    // Prevent double-tapping the undo button
    if (undoState.isProcessing) return;

    setUndoState({ ...undoState, isProcessing: true });

    try {
      // Write the reversal to Firestore
      await updateDoc(
        doc(FIRESTORE_DB, "parkingReports", undoState.reportId),
        {
          status: "open",
          resolvedAt: null,
          resolvedBy: null,
        },
      );

      // Clear the taken report tracking if this was our active taken report
      if (myTakenReportId === undoState.reportId) setMyTakenReportId(null);

      // Unlock the one-manual-taken limit if this was the manually taken report
      if (manualTakenReportId === undoState.reportId) {
        setHasManuallyTakenASpot(false);
        setManualTakenReportId(null);
      }

      // Hide the banner and clear the timer
      setUndoState(null);
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
    } catch (e: any) {
      // Re-enable the button so the user can try again
      setUndoState({ ...undoState, isProcessing: false });
      Alert.alert("Undo failed", e?.message ?? "Could not undo the auto-taken update.");
    }
  };

  // Cleanup: cancel the undo timer when the component using this hook unmounts
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