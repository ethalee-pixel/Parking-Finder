// NewSpotModal.tsx
// Modal form for creating a new parking spot.
// Triggered by long-press on the map. User selects free/paid, optional rate,
// and a duration (hours/minutes/seconds).
//
// Save behavior:
// - attempts to create a cloud report as OPEN
// - uses a deterministic clientSpotId for idempotent retries
// - if cloud write fails, saves locally so the sync hook can retry later

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { createParkingReport } from '../services/parkingReports';
import { type ParkingSpot } from '../types/parking';
import { scheduleSpotNotification } from '../utils/notifications';
import { formatDuration } from '../utils/time';

type Props = {
  showModal: boolean;

  // Coordinates from the long-press that triggered this modal.
  pendingCoord: { latitude: number; longitude: number } | null;

  // Current user's UID (null if not signed in).
  uid: string | null;

  // True while a Firestore write is in flight (disables actions).
  isCreatingSpot: boolean;

  setIsCreatingSpot: (v: boolean) => void;
  setShowModal: (v: boolean) => void;
  setPendingCoord: (v: { latitude: number; longitude: number } | null) => void;

  // Local fallback list update (used when cloud write fails).
  setSpots: (fn: (prev: ParkingSpot[]) => ParkingSpot[]) => void;

  // Shared bottom-banner message.
  setAutoTakenBanner: (v: string | null) => void;
};

type SpotType = 'free' | 'paid';

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

const PICKER_ITEM_HEIGHT = 40;

export function NewSpotModal({
  showModal,
  pendingCoord,
  uid,
  isCreatingSpot,
  setIsCreatingSpot,
  setShowModal,
  setPendingCoord,
  setSpots,
  setAutoTakenBanner,
}: Props) {
  // Free vs paid selector.
  const [spotType, setSpotType] = useState<SpotType>('free');

  // Rate string for paid spots only (example: "$2/hr").
  const [rate, setRate] = useState('');

  // Duration picker values.
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(30);

  const totalSeconds = useMemo(() => {
    const h = clampInt(hours, 0, 24);
    const m = clampInt(minutes, 0, 59);
    const s = clampInt(seconds, 0, 59);
    return h * 3600 + m * 60 + s;
  }, [hours, minutes, seconds]);

  // Resets all state and closes the modal.
  const closeModal = () => {
    Keyboard.dismiss();
    setShowModal(false);
    setPendingCoord(null);
    setHours(0);
    setMinutes(0);
    setSeconds(30);
    setRate('');
    setSpotType('free');
  };

  // Creates an OPEN report in Firestore.
  // Falls back to local storage if cloud write fails.
  const saveSpot = async () => {
    if (!pendingCoord) return;

    // Guard against double taps.
    if (isCreatingSpot) return;

    if (!uid) {
      Alert.alert('Not signed in', 'Please sign in to create a spot.');
      return;
    }

    if (totalSeconds <= 0) {
      Alert.alert('Invalid Duration', 'Please set a duration greater than 0.');
      return;
    }

    // Generate a local ID up front (used for idempotent cloud write + fallback).
    const timestamp = Date.now();
    const localId = `spot-${timestamp}-${Math.random()}`;

    // Build the local fallback spot object.
    const newSpot: ParkingSpot = {
      id: localId,
      latitude: pendingCoord.latitude,
      longitude: pendingCoord.longitude,
      type: spotType,
      rate: spotType === 'paid' ? rate.trim() : undefined,
      createdAt: timestamp,
      version: 0,
      durationSeconds: totalSeconds,
    };

    setIsCreatingSpot(true);

    // Close the modal immediately for responsiveness.
    closeModal();

    // Schedule an expiry warning notification.
    await scheduleSpotNotification(localId, totalSeconds, spotType);

    try {
      await createParkingReport({
        latitude: newSpot.latitude,
        longitude: newSpot.longitude,
        type: newSpot.type,
        rate: newSpot.rate,
        durationSeconds: totalSeconds,
        clientSpotId: localId,
      });

      setAutoTakenBanner('Spot reported and shared.');
    } catch (e: any) {
      // Cloud save failed, keep the spot locally so the user doesn't lose it.
      setSpots((prev) => [...prev, newSpot]);

      Alert.alert(
        'Saved locally',
        'Spot was saved on this device and will sync automatically when online.',
      );

      setAutoTakenBanner('Saved locally. Will auto-sync when online.');

      console.warn('Cloud save failed. Spot queued for retry:', e?.message ?? e);
    } finally {
      setIsCreatingSpot(false);
    }
  };

  return (
    <Modal visible={showModal} transparent animationType="slide">
      {/* Shifts content up when the keyboard appears. */}
      <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>New Parking Spot</Text>

          {/* Free / Paid selector */}
          <View style={styles.typeRow}>
            <TouchableOpacity
              style={[styles.typeButton, spotType === 'free' && styles.typeButtonSelectedFree]}
              onPress={() => setSpotType('free')}
              disabled={isCreatingSpot}
            >
              <Text>Free</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.typeButton, spotType === 'paid' && styles.typeButtonSelectedPaid]}
              onPress={() => setSpotType('paid')}
              disabled={isCreatingSpot}
            >
              <Text>Paid</Text>
            </TouchableOpacity>
          </View>

          {/* Rate input only for paid spots */}
          {spotType === 'paid' && (
            <TextInput
              placeholder="Rate (e.g. $2/hr)"
              value={rate}
              onChangeText={setRate}
              style={styles.input}
              editable={!isCreatingSpot}
            />
          )}

          <Text style={styles.durationLabel}>Duration</Text>

          {/* Duration picker: hours/minutes/seconds */}
          <View style={styles.pickerContainer}>
            <PickerColumn
              label="Hours"
              value={hours}
              max={24}
              disabled={isCreatingSpot}
              onSelect={setHours}
              keyPrefix="h"
            />
            <PickerColumn
              label="Minutes"
              value={minutes}
              max={59}
              disabled={isCreatingSpot}
              onSelect={setMinutes}
              keyPrefix="m"
            />
            <PickerColumn
              label="Seconds"
              value={seconds}
              max={59}
              disabled={isCreatingSpot}
              onSelect={setSeconds}
              keyPrefix="s"
            />
          </View>

          {/* Live preview of selected duration */}
          <Text style={styles.durationPreview}>Total: {formatDuration(totalSeconds)}</Text>

          {/* Save button */}
          <TouchableOpacity
            style={[styles.saveButton, isCreatingSpot && styles.saveButtonDisabled]}
            onPress={saveSpot}
            disabled={isCreatingSpot}
          >
            <Text style={styles.saveText}>{isCreatingSpot ? 'Saving...' : 'Save'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={closeModal} disabled={isCreatingSpot}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type PickerColumnProps = {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onSelect: (v: number) => void;
  keyPrefix: string;
};

// Small helper component: a scrollable number picker column.
function PickerColumn({ label, value, max, disabled, onSelect, keyPrefix }: PickerColumnProps) {
  const items = useMemo(() => Array.from({ length: max + 1 }, (_, i) => i), [max]);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    // Keep the selected value in view so defaults like "30s" are obvious.
    const offsetY = value * PICKER_ITEM_HEIGHT;

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: offsetY, animated: false });
    });
  }, [value]);

  return (
    <View style={styles.pickerColumn}>
      <Text style={styles.pickerColumnLabel}>{label}</Text>
      <ScrollView ref={scrollRef} style={styles.picker} showsVerticalScrollIndicator={false}>
        {items.map((n) => {
          const selected = n === value;
          return (
            <TouchableOpacity
              key={`${keyPrefix}-${n}`}
              style={[styles.pickerItem, selected && styles.pickerItemSelected]}
              onPress={() => onSelect(n)}
              disabled={disabled}
            >
              <Text style={[styles.pickerItemText, selected && styles.pickerItemTextSelected]}>
                {n}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    width: '85%',
    maxHeight: '85%',
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 15,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 15,
  },

  typeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  typeButton: {
    width: '45%',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
  },
  // Green tint when free is selected.
  typeButtonSelectedFree: {
    backgroundColor: '#c8e6c9',
  },
  // Red tint when paid is selected.
  typeButtonSelectedPaid: {
    backgroundColor: '#ffcdd2',
  },

  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    borderRadius: 8,
    marginBottom: 15,
  },

  durationLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    marginTop: 5,
  },

  pickerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
    height: 150,
  },
  pickerColumn: {
    flex: 1,
    marginHorizontal: 5,
  },
  pickerColumnLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 5,
    color: '#666',
  },
  picker: {
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#f9f9f9',
  },
  pickerItem: {
    height: PICKER_ITEM_HEIGHT,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  pickerItemSelected: {
    backgroundColor: '#007AFF',
  },
  pickerItemText: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  pickerItemTextSelected: {
    color: 'white',
    fontWeight: 'bold',
  },

  durationPreview: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 15,
  },

  saveButton: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  },

  cancelText: {
    textAlign: 'center',
    marginTop: 15,
    color: '#666',
  },
});
