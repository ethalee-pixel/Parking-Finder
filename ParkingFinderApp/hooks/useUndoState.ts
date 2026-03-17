// useUndoState - manages the undo banner shown after a spot is marked taken.
// Gives the user a 45-second window to reverse the action.
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { reopenParkingReport } from '../services/parkingReports';

// How long (ms) the user has to undo a mark-taken action
const UNDO_WINDOW_MS = 45_000;

type UndoState = {
  reportId: string;
  message: string;
  expiresAt: number; // Timestamp when the undo window expires
  isProcessing: boolean; // True while the undo Firestore write is in flight
} | null;

type UseUndoStateResult = {
  undoState: UndoState;
  showUndoBanner: (reportId: string, message?: string) => void;
  undoAutoTaken: () => Promise<void>;
  clearUndoBanner: () => void;
};

export function useUndoState(
  myTakenReportId: string | null,
  setMyTakenReportId: (id: string | null) => void,
  manualTakenReportId: string | null,
  setHasManuallyTakenASpot: (v: boolean) => void,
  setManualTakenReportId: (id: string | null) => void,
): UseUndoStateResult {
  // Active undo opportunity (null when no undo is available)
  const [undoState, setUndoState] = useState<UndoState>(null);

  // Timer handle for auto-dismissing the banner
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearUndoBanner = () => {
    setUndoState(null);

    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  };

  // Shows the undo banner for a given report ID and starts the countdown.
  // Cancels any previously active timer first.
  const showUndoBanner = (reportId: string, message = 'Marked as taken.') => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    // user story 3.5
    const expiresAt = Date.now() + UNDO_WINDOW_MS;
    setUndoState({ reportId, message, expiresAt, isProcessing: false });

    undoTimerRef.current = setTimeout(() => {
      setUndoState(null);
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  };

  // Reverses a mark-taken action by setting the report status back to "open".
  // Also unlocks the one-manual-taken limit if this was the manually taken report.
  const undoAutoTaken = async () => {
    if (!undoState) return;

    // Reject undo if the window already expired
    if (Date.now() > undoState.expiresAt) {
      clearUndoBanner();
      return;
    }

    // Prevent double-taps
    if (undoState.isProcessing) return;

    setUndoState({ ...undoState, isProcessing: true });

    try {
      // user story 3.5
      await reopenParkingReport(undoState.reportId);

      // Clear "my taken report" tracking if we just undid it
      if (myTakenReportId === undoState.reportId) setMyTakenReportId(null);

      // Unlock the one-manual-taken limit if this was the manually taken report
      if (manualTakenReportId === undoState.reportId) {
        setHasManuallyTakenASpot(false);
        setManualTakenReportId(null);
      }

      // Hide banner and clear timer
      clearUndoBanner();
    } catch (err: unknown) {
      setUndoState((prev) => (prev ? { ...prev, isProcessing: false } : prev));

      const message = err instanceof Error ? err.message : 'Could not undo the mark-taken update.';
      Alert.alert('Undo failed', message);
    }
  };

  // Cleanup: cancel the undo timer when the hook unmounts
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
    };
  }, []);

  return { undoState, showUndoBanner, undoAutoTaken, clearUndoBanner };
}
