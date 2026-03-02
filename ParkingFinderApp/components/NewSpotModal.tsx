// NewSpotModal - the modal form for creating a new parking spot.
// Triggered by a long-press on the map. Lets the user pick free/paid,
// set a rate (if paid), and choose a duration via hour/minute/second pickers.
// On save, creates the report in Firestore and immediately marks it as taken by the creator.

import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Alert,
  StyleSheet,
} from "react-native";
import { formatDuration } from "../utils/time";
import { isNearRoadOrParkingOSM } from "../utils/geo";
import { createParkingReport, markReportTaken } from "../parkingReports";
import { scheduleSpotNotification } from "../utils/notifications";
import { ParkingSpot } from "../types/parking";

type Props = {
  showModal: boolean;
  // The coordinates from the long-press that triggered this modal
  pendingCoord: { latitude: number; longitude: number } | null;
  uid: string | null;
  // True while the Firestore write is in flight (disables the save button)
  isCreatingSpot: boolean;
  setIsCreatingSpot: (v: boolean) => void;
  setShowModal: (v: boolean) => void;
  setPendingCoord: (v: { latitude: number; longitude: number } | null) => void;
  setSpots: (fn: (prev: ParkingSpot[]) => ParkingSpot[]) => void;
  setMyTakenReportId: (id: string | null) => void;
  setTakenByMeIds: (fn: (prev: Set<string>) => Set<string>) => void;
  setHasManuallyTakenASpot: (v: boolean) => void;
  setManualTakenReportId: (id: string | null) => void;
  setLastReported: (v: any) => void;
  setAutoTakenBanner: (v: string | null) => void;
  showUndoBanner: (id: string) => void;
};

export const NewSpotModal = ({
  showModal,
  pendingCoord,
  uid,
  isCreatingSpot,
  setIsCreatingSpot,
  setShowModal,
  setPendingCoord,
  setSpots,
  setMyTakenReportId,
  setTakenByMeIds,
  setHasManuallyTakenASpot,
  setManualTakenReportId,
  setLastReported,
  setAutoTakenBanner,
  showUndoBanner,
}: Props) => {
  // Whether this is a free or paid spot
  const [spotType, setSpotType] = useState<"free" | "paid">("free");
  // The rate text shown for paid spots (e.g. "$2/hr")
  const [rate, setRate] = useState("");
  // Duration picker values
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(30); // Default to 30 seconds

  // Resets all modal state and closes the modal
  const closeModal = () => {
    Keyboard.dismiss();
    setShowModal(false);
    setPendingCoord(null);
    setHours(0);
    setMinutes(0);
    setSeconds(30);
  };

  // Creates the parking report in Firestore and immediately marks it as taken by the creator.
  // Falls back to saving as a local spot if the Firestore write fails.
  const saveSpot = async () => {
    if (!pendingCoord) return;

    // Guard against double-tap
    if (isCreatingSpot) return;

    const totalSeconds = hours * 3600 + minutes * 60 + seconds;

    if (totalSeconds === 0) {
      Alert.alert("Invalid Duration", "Please set a duration greater than 0");
      return;
    }

    setIsCreatingSpot(true);

    const timestamp = Date.now();
    const id = `spot-${timestamp}-${Math.random()}`;

    // Build the local spot object (used as fallback if Firestore fails)
    const newSpot: ParkingSpot = {
      id,
      latitude: pendingCoord.latitude,
      longitude: pendingCoord.longitude,
      type: spotType,
      rate: spotType === "paid" ? rate.trim() : undefined,
      createdAt: timestamp,
      version: 0,
      durationSeconds: totalSeconds,
    };

    // Close the modal immediately so the UI feels responsive
    closeModal();

    // Schedule a local notification warning before the spot expires
    await scheduleSpotNotification(id, totalSeconds, spotType);

    try {
      // Save the report to Firestore
      const firestoreId = await createParkingReport({
        latitude: newSpot.latitude,
        longitude: newSpot.longitude,
        type: newSpot.type,
        rate: newSpot.rate,
        durationSeconds: totalSeconds,
      });

      // Immediately mark the spot as taken by the creator so it shows as a red T
      await markReportTaken(firestoreId, uid!);

      setMyTakenReportId(firestoreId);
      setTakenByMeIds((prev) => {
        const next = new Set(prev);
        next.add(firestoreId);
        return next;
      });

      // Lock the one-taken-spot limit since the creator is "taking" their own spot
      setHasManuallyTakenASpot(true);
      setManualTakenReportId(firestoreId);

      // Show undo banner so the creator can reverse if they made a mistake
      showUndoBanner(firestoreId);

      // Attach the Firestore ID to the local spot object for deletion purposes
      newSpot.firestoreId = firestoreId;

      try {
        // Second markReportTaken call ensures state is fully synced
        await markReportTaken(firestoreId, uid!);

        setTakenByMeIds((prev) => new Set(prev).add(firestoreId));
        setMyTakenReportId(firestoreId);

        setHasManuallyTakenASpot(true);
        setManualTakenReportId(firestoreId);

        showUndoBanner(firestoreId);

        setAutoTakenBanner("Placed spot and marked as TAKEN.");
      } catch (e: any) {
        Alert.alert(
          "Created, but could not mark taken",
          e?.message ?? "The marker was created but could not be resolved.",
        );
      }

      // Clear lastReported since we no longer need auto-taken tracking for this spot
      setLastReported(null);
    } catch (e: any) {
      Alert.alert(
        "Firestore save failed",
        e?.message ? String(e.message) : JSON.stringify(e),
      );
      // Fall back to keeping the spot locally if the cloud save failed
      setSpots((prev) => [...prev, newSpot]);
    } finally {
      setIsCreatingSpot(false);
    }
  };

  return (
    <Modal visible={showModal} transparent animationType="slide">
      {/* Shift content up when keyboard appears */}
      <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>New Parking Spot</Text>

          {/* Free / Paid type selector */}
          <View style={styles.typeRow}>
            <TouchableOpacity
              style={[styles.typeButton, spotType === "free" && styles.freeSelected]}
              onPress={() => setSpotType("free")}
              disabled={isCreatingSpot}
            >
              <Text>Free</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.typeButton, spotType === "paid" && styles.paidSelected]}
              onPress={() => setSpotType("paid")}
              disabled={isCreatingSpot}
            >
              <Text>Paid</Text>
            </TouchableOpacity>
          </View>

          {/* Rate input only shown when "Paid" is selected */}
          {spotType === "paid" && (
            <TextInput
              placeholder="Rate"
              value={rate}
              onChangeText={setRate}
              style={styles.input}
              editable={!isCreatingSpot}
            />
          )}

          <Text style={styles.durationLabel}>Duration:</Text>

          {/* Duration picker: three scrollable columns for hours, minutes, seconds */}
          <View style={styles.pickerContainer}>
            {/* Hours column (0-24) */}
            <View style={styles.pickerColumn}>
              <Text style={styles.pickerColumnLabel}>Hours</Text>
              <ScrollView style={styles.picker} showsVerticalScrollIndicator={false}>
                {Array.from({ length: 25 }, (_, i) => i).map((h) => (
                  <TouchableOpacity
                    key={`h-${h}`}
                    style={[styles.pickerItem, hours === h && styles.pickerItemSelected]}
                    onPress={() => setHours(h)}
                    disabled={isCreatingSpot}
                  >
                    <Text style={[styles.pickerItemText, hours === h && styles.pickerItemTextSelected]}>
                      {h}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Minutes column (0-59) */}
            <View style={styles.pickerColumn}>
              <Text style={styles.pickerColumnLabel}>Minutes</Text>
              <ScrollView style={styles.picker} showsVerticalScrollIndicator={false}>
                {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                  <TouchableOpacity
                    key={`m-${m}`}
                    style={[styles.pickerItem, minutes === m && styles.pickerItemSelected]}
                    onPress={() => setMinutes(m)}
                    disabled={isCreatingSpot}
                  >
                    <Text style={[styles.pickerItemText, minutes === m && styles.pickerItemTextSelected]}>
                      {m}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Seconds column (0-59) */}
            <View style={styles.pickerColumn}>
              <Text style={styles.pickerColumnLabel}>Seconds</Text>
              <ScrollView style={styles.picker} showsVerticalScrollIndicator={false}>
                {Array.from({ length: 60 }, (_, i) => i).map((s) => (
                  <TouchableOpacity
                    key={`s-${s}`}
                    style={[styles.pickerItem, seconds === s && styles.pickerItemSelected]}
                    onPress={() => setSeconds(s)}
                    disabled={isCreatingSpot}
                  >
                    <Text style={[styles.pickerItemText, seconds === s && styles.pickerItemTextSelected]}>
                      {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {/* Live preview of the total selected duration */}
          <Text style={styles.durationPreview}>
            Total: {formatDuration(hours * 3600 + minutes * 60 + seconds)}
          </Text>

          {/* Save button - dims while saving */}
          <TouchableOpacity
            style={[styles.saveButton, isCreatingSpot && { opacity: 0.6 }]}
            onPress={saveSpot}
            disabled={isCreatingSpot}
          >
            <Text style={styles.saveText}>
              {isCreatingSpot ? "Saving..." : "Save"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={closeModal} disabled={isCreatingSpot}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    width: "85%",
    maxHeight: "85%",
    backgroundColor: "white",
    padding: 20,
    borderRadius: 15,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 15,
  },
  typeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  typeButton: {
    padding: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    width: "45%",
    alignItems: "center",
  },
  freeSelected: { backgroundColor: "#c8e6c9" },  // Green tint when free is selected
  paidSelected: { backgroundColor: "#ffcdd2" },  // Red tint when paid is selected
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 10,
    borderRadius: 8,
    marginBottom: 15,
  },
  durationLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
    marginTop: 5,
  },
  pickerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
    height: 150,
  },
  pickerColumn: {
    flex: 1,
    marginHorizontal: 5,
  },
  pickerColumnLabel: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 5,
    color: "#666",
  },
  picker: {
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "#f9f9f9",
  },
  pickerItem: {
    padding: 8,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  // Highlighted blue background for the selected value
  pickerItemSelected: {
    backgroundColor: "#007AFF",
  },
  pickerItemText: {
    fontSize: 16,
    color: "#333",
  },
  pickerItemTextSelected: {
    color: "white",
    fontWeight: "bold",
  },
  durationPreview: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
    color: "#007AFF",
    marginBottom: 15,
  },
  saveButton: { backgroundColor: "#007AFF", padding: 12, borderRadius: 8 },
  saveText: { color: "white", textAlign: "center", fontWeight: "bold" },
  cancelText: { textAlign: "center", marginTop: 15, color: "#666" },
});