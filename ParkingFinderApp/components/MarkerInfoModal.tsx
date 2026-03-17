// MarkerInfoModal.tsx
// Shown when the user taps a marker.
// Displays spot details (age, time left, type) and relevant actions:
// - Remove Pin (owner/local only)
// - Mark as Taken (open cloud reports, proximity-gated)
// - Unmark (Reopen) (resolved cloud reports)
import React, { useMemo } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { deleteParkingReport } from '../services/parkingReports';
import { isNearMe } from '../utils/geo';
import { formatDuration, getAgeInSeconds } from '../utils/time';

type SelectedMarker = { data: any; isCloud: boolean };

type Props = {
  // Selected marker (or null when closed).
  selectedMarker: SelectedMarker | null;

  // Current signed-in user's UID (null if not signed in).
  uid: string | null;

  // True while a take/untake operation is in progress (disables actions).
  isAutoTaking: boolean;

  // True if the user already manually took one spot this session.
  hasManuallyTakenASpot: boolean;

  // Latest user position for proximity checks.
  userPos: { lat: number; lon: number } | null;

  // Distance threshold (meters) for allowing mark-taken.
  NEARBY_TAKEN_RADIUS_M: number;

  // IDs used for tracking taken state.
  myTakenReportId: string | null;
  manualTakenReportId: string | null;
  takenByMeIds: Set<string>;

  // State setters and action callbacks provided by Map.tsx.
  setSelectedMarker: (v: SelectedMarker | null) => void;
  setHiddenCloudIds: (fn: (prev: Set<string>) => Set<string>) => void;
  setTakenByMeIds: (fn: (prev: Set<string>) => Set<string>) => void;
  setHasManuallyTakenASpot: (v: boolean) => void;
  setManualTakenReportId: (id: string | null) => void;
  setMyTakenReportId: (id: string | null) => void;

  onConfirmRemoveSpot: (id: string) => void;
  onManualMarkTaken: (reportId: string, reportLat: number, reportLon: number) => void;
  onReopenReport: (reportId: string) => void;
};

function getSpotTitle(data: any, isExpiringSoon: boolean): string {
  if (isExpiringSoon) return '⚠️ Expiring Soon!';
  if (data.type === 'free') return 'Free Spot';
  // user story 2.2
  return `Paid: ${data.rate ?? ''}`.trim();
}

export function MarkerInfoModal({
  selectedMarker,
  uid,
  isAutoTaking,
  hasManuallyTakenASpot,
  userPos,
  NEARBY_TAKEN_RADIUS_M,
  setSelectedMarker,
  setHiddenCloudIds,
  onConfirmRemoveSpot,
  onManualMarkTaken,
  onReopenReport,
}: Props) {
  const data = selectedMarker?.data;
  const isCloud = selectedMarker?.isCloud ?? false;

  const isResolved = Boolean(isCloud && data?.status === 'resolved');

  const durationSeconds = data?.durationSeconds ?? 30;
  const ageSeconds = data ? getAgeInSeconds(data.createdAt) : 0;

  // Expiring soon at 90% of lifetime.
  // user story 2.4
  const isExpiringSoon = useMemo(() => {
    if (!data) return false;
    const warningThreshold = Math.floor(durationSeconds * 0.9);
    return ageSeconds >= warningThreshold;
  }, [data, durationSeconds, ageSeconds]);

  const title = data ? getSpotTitle(data, isExpiringSoon) : '';
  const ageText = formatDuration(ageSeconds);
  const timeLeftText = formatDuration(Math.max(0, durationSeconds - ageSeconds));

  const close = () => setSelectedMarker(null);

  const canRemoveLocal = Boolean(data && !isCloud);
  const canRemoveCloud = Boolean(data && isCloud && uid && data.createdBy === uid);
  const canRemove = canRemoveLocal || canRemoveCloud;

  const canShowReopen = Boolean(isCloud && isResolved);

  const showMarkTakenForOpenCloud = Boolean(isCloud && data && data.status !== 'resolved');
  const showMarkTakenForFirestoreId = Boolean(isCloud && data?.firestoreId);

  const proximity = data
    ? isNearMe(userPos, data.latitude, data.longitude, NEARBY_TAKEN_RADIUS_M)
    : { ok: false, dist: Infinity };

  const markTakenDisabled = !uid || isAutoTaking || hasManuallyTakenASpot || !proximity.ok;

  const markTakenLabel = hasManuallyTakenASpot
    ? 'Already taken a spot'
    : !proximity.ok
      ? `Too far (${Math.round(proximity.dist)}m)`
      : 'Mark as Taken';

  const confirmReopen = (reportId: string) => {
    Alert.alert(
      'Reopen this spot?',
      'This will mark the report as OPEN again so others can see it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reopen',
          onPress: async () => {
            close();
            // user story 3.5
            await onReopenReport(reportId);
          },
        },
      ],
    );
  };

  const confirmMarkTaken = (reportId: string) => {
    if (!data) return;

    Alert.alert('Mark as taken?', "This will resolve the report so others won't see it as open.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Taken',
        style: 'destructive',
        onPress: async () => {
          close();
          await onManualMarkTaken(reportId, data.latitude, data.longitude);
        },
      },
    ]);
  };

  const removePin = () => {
    if (!data) return;

    close();

    // Local spot removal uses the existing confirm dialog in Map.tsx.
    if (!isCloud) {
      onConfirmRemoveSpot(data.id);
      return;
    }

    // Cloud removal: hide immediately, then delete.
    const cloudId = data.id;

    setHiddenCloudIds((prev) => {
      const next = new Set(prev);
      next.add(cloudId);
      return next;
    });

    deleteParkingReport(cloudId).catch((e: any) => {
      // If delete fails, unhide it.
      setHiddenCloudIds((prev) => {
        const next = new Set(prev);
        next.delete(cloudId);
        return next;
      });

      Alert.alert('Delete failed', e?.message ?? 'Could not delete.');
    });
  };

  return (
    // Tapping the dark overlay closes the modal.
    // user story 1.2
    <Modal
      visible={selectedMarker !== null}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <TouchableOpacity style={styles.markerModalOverlay} activeOpacity={1} onPress={close}>
        <View style={styles.markerModalContent}>
          {data && (
            <>
              <Text style={[styles.markerModalTitle, isExpiringSoon && styles.titleWarning]}>
                {title}
              </Text>

              <Text style={styles.markerModalText}>Age: {ageText}</Text>
              <Text style={styles.markerModalText}>Time Left: {timeLeftText}</Text>

              {/* Remove Pin (local always, cloud only if createdBy is current user) */}
              {canRemove && (
                <TouchableOpacity style={styles.removeButton} onPress={removePin}>
                  <Text style={styles.removeButtonText}>Remove Pin</Text>
                </TouchableOpacity>
              )}

              {/* Reopen (only for resolved cloud reports) */}
              {canShowReopen && (
                <TouchableOpacity
                  style={[styles.takeButton, styles.reopenButton]}
                  onPress={() => confirmReopen(data.id)}
                >
                  <Text style={styles.takeButtonText}>Unmark (Reopen)</Text>
                </TouchableOpacity>
              )}

              {/* Mark as Taken for open cloud reports */}
              {/* user story 4.2 */}
              {showMarkTakenForOpenCloud && (
                <TouchableOpacity
                  style={[styles.takeButton, markTakenDisabled && styles.takeButtonDisabled]}
                  disabled={markTakenDisabled}
                  onPress={() => confirmMarkTaken(data.id)}
                >
                  <Text
                    style={[
                      styles.takeButtonText,
                      markTakenDisabled && styles.takeButtonTextDisabled,
                    ]}
                  >
                    {markTakenLabel}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Mark as Taken for items that carry a firestoreId (rare, but supported) */}
              {/* user story 4.2 */}
              {showMarkTakenForFirestoreId && (
                <TouchableOpacity
                  style={[styles.takeButton, markTakenDisabled && styles.takeButtonDisabled]}
                  disabled={markTakenDisabled}
                  onPress={() => confirmMarkTaken(String(data.firestoreId))}
                >
                  <Text
                    style={[
                      styles.takeButtonText,
                      markTakenDisabled && styles.takeButtonTextDisabled,
                    ]}
                  >
                    {markTakenLabel}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.closeButton} onPress={close}>
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  markerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  markerModalContent: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    width: '80%',
    maxWidth: 300,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  markerModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
    color: '#000',
  },
  titleWarning: {
    color: 'red',
  },
  markerModalText: {
    fontSize: 16,
    marginBottom: 8,
    color: '#333',
  },

  // Destructive button for removing a pin.
  removeButton: {
    backgroundColor: '#FF3B30',
    padding: 12,
    borderRadius: 8,
    marginTop: 15,
  },
  removeButtonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },

  closeButton: {
    marginTop: 10,
    padding: 10,
  },
  closeButtonText: {
    color: '#007AFF',
    textAlign: 'center',
    fontSize: 16,
  },

  // Primary action button for marking taken (or reopening).
  takeButton: {
    backgroundColor: '#FF9500',
    padding: 12,
    borderRadius: 8,
    marginTop: 10,
  },
  reopenButton: {
    backgroundColor: '#007AFF',
  },
  takeButtonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },

  // Disabled styles for the take button.
  takeButtonDisabled: {
    backgroundColor: '#BDBDBD',
  },
  takeButtonTextDisabled: {
    color: '#EEEEEE',
  },
});
