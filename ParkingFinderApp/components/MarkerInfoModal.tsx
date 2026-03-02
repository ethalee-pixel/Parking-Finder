// MarkerInfoModal - shown when the user taps a map marker.
// Displays spot details (age, time left, type) and action buttons:
// Remove Pin, Mark as Taken, and Unmark (Reopen).

import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from "react-native";
import { getAgeInSeconds, formatDuration } from "../utils/time";
import { isNearMe } from "../utils/geo";
import { deleteParkingReport } from "../parkingReports";
import { doc, updateDoc } from "firebase/firestore";
import { FIRESTORE_DB } from "../FirebaseConfig";

type Props = {
  // The currently selected marker, or null if none is selected
  selectedMarker: { data: any; isCloud: boolean } | null;
  // Current user's Firebase UID
  uid: string | null;
  // True while a mark-taken operation is in progress (disables the button)
  isAutoTaking: boolean;
  // True if the user has already manually taken one spot this session
  hasManuallyTakenASpot: boolean;
  // Latest known user position for proximity checks
  userPos: { lat: number; lon: number } | null;
  // Distance threshold in meters for marking a spot as taken
  NEARBY_TAKEN_RADIUS_M: number;
  // The report ID the user currently has marked as taken
  myTakenReportId: string | null;
  // The report ID that was manually taken (for undo unlock)
  manualTakenReportId: string | null;
  // Set of all report IDs taken by the current user
  takenByMeIds: Set<string>;
  setSelectedMarker: (v: { data: any; isCloud: boolean } | null) => void;
  setHiddenCloudIds: (fn: (prev: Set<string>) => Set<string>) => void;
  setTakenByMeIds: (fn: (prev: Set<string>) => Set<string>) => void;
  setHasManuallyTakenASpot: (v: boolean) => void;
  setManualTakenReportId: (id: string | null) => void;
  setMyTakenReportId: (id: string | null) => void;
  onConfirmRemoveSpot: (id: string) => void;
  onManualMarkTaken: (reportId: string, reportLat: number, reportLon: number) => void;
  onReopenReport: (reportId: string) => void;
};

export const MarkerInfoModal = ({
  selectedMarker,
  uid,
  isAutoTaking,
  hasManuallyTakenASpot,
  userPos,
  NEARBY_TAKEN_RADIUS_M,
  myTakenReportId,
  manualTakenReportId,
  takenByMeIds,
  setSelectedMarker,
  setHiddenCloudIds,
  setTakenByMeIds,
  setHasManuallyTakenASpot,
  setManualTakenReportId,
  setMyTakenReportId,
  onConfirmRemoveSpot,
  onManualMarkTaken,
  onReopenReport,
}: Props) => {
  return (
    // Tapping the overlay background closes the modal
    <Modal
      visible={selectedMarker !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setSelectedMarker(null)}
    >
      <TouchableOpacity
        style={styles.markerModalOverlay}
        activeOpacity={1}
        onPress={() => setSelectedMarker(null)}
      >
        <View style={styles.markerModalContent}>
          {selectedMarker &&
            (() => {
              const data = selectedMarker.data;
              const isCloud = selectedMarker.isCloud;
              // A resolved cloud report means someone (possibly us) has taken this spot
              const isResolved = isCloud && data.status === "resolved";
              const duration = data.durationSeconds || 30;
              const age = getAgeInSeconds(data.createdAt);
              const formattedTime = formatDuration(age);
              const timeRemaining = formatDuration(duration - age);
              // At 90% of lifetime, the spot is considered expiring soon
              const warningThreshold = Math.floor(duration * 0.9);
              const warning = age >= warningThreshold;

              return (
                <>
                  {/* Title turns red when expiring soon */}
                  <Text
                    style={[styles.markerModalTitle, warning && { color: "red" }]}
                  >
                    {warning
                      ? "⚠️ Expiring Soon!"
                      : data.type === "free"
                        ? "Free Spot"
                        : `Paid: ${data.rate}`}
                  </Text>
                  <Text style={styles.markerModalText}>Age: {formattedTime}</Text>
                  <Text style={styles.markerModalText}>Time Left: {timeRemaining}</Text>

                  {/* Remove Pin button - only shown if user owns the spot */}
                  {(() => {
                    const canDeleteLocal = !isCloud;
                    const canDeleteCloud = isCloud && !!uid && data.createdBy === uid;

                    if (!canDeleteLocal && !canDeleteCloud) return null;

                    return (
                      <TouchableOpacity
                        style={styles.removeButton}
                        onPress={() => {
                          setSelectedMarker(null);

                          if (!isCloud) {
                            // Local spot - use the confirm dialog
                            onConfirmRemoveSpot(data.id);
                            return;
                          }

                          // Cloud spot - hide immediately then delete from Firestore
                          const cloudId = data.id;
                          setHiddenCloudIds((prev) => new Set(prev).add(cloudId));

                          deleteParkingReport(cloudId).catch((e: any) => {
                            // If delete fails, unhide the marker
                            setHiddenCloudIds((prev) => {
                              const next = new Set(prev);
                              next.delete(cloudId);
                              return next;
                            });
                            Alert.alert("Delete failed", e?.message ?? "Could not delete.");
                          });
                        }}
                      >
                        <Text style={styles.removeButtonText}>Remove Pin</Text>
                      </TouchableOpacity>
                    );
                  })()}

                  {/* Unmark (Reopen) button - shown when the spot is resolved */}
                  {selectedMarker?.isCloud && isResolved && (
                    <TouchableOpacity
                      style={[styles.takeButton, { backgroundColor: "#007AFF" }]}
                      onPress={() => {
                        Alert.alert(
                          "Reopen this spot?",
                          "This will mark the report as OPEN again so others can see it.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Reopen",
                              onPress: async () => {
                                setSelectedMarker(null);
                                await onReopenReport(data.id);
                              },
                            },
                          ],
                        );
                      }}
                    >
                      <Text style={styles.takeButtonText}>Unmark (Reopen)</Text>
                    </TouchableOpacity>
                  )}

                  {/* Mark as Taken button - shown for open cloud reports.
                      Disabled if: not signed in, already taken a spot, or too far away. */}
                  {isCloud &&
                    data.status !== "resolved" &&
                    (() => {
                      const reportId = data.id;
                      const alreadyTakenSpot = hasManuallyTakenASpot;
                      const near = isNearMe(userPos, data.latitude, data.longitude, NEARBY_TAKEN_RADIUS_M);

                      const disabled = !uid || isAutoTaking || alreadyTakenSpot || !near.ok;

                      // Show a context-aware label explaining why the button is disabled
                      const label = alreadyTakenSpot
                        ? "Already taken a spot"
                        : !near.ok
                          ? `Too far (${Math.round(near.dist)}m)`
                          : "Mark as Taken";

                      return (
                        <TouchableOpacity
                          style={[styles.takeButton, disabled && styles.takeButtonDisabled]}
                          disabled={disabled}
                          onPress={() => {
                            Alert.alert(
                              "Mark as taken?",
                              "This will resolve the report so others won't see it as open.",
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Mark Taken",
                                  style: "destructive",
                                  onPress: async () => {
                                    setSelectedMarker(null);
                                    await onManualMarkTaken(reportId, data.latitude, data.longitude);
                                  },
                                },
                              ],
                            );
                          }}
                        >
                          <Text style={[styles.takeButtonText, disabled && styles.takeButtonTextDisabled]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })()}

                  {/* Mark as Taken button for local spots that also have a Firestore ID */}
                  {isCloud &&
                    data?.firestoreId &&
                    (() => {
                      const data = selectedMarker.data;
                      const reportId = data.firestoreId;
                      const near = isNearMe(userPos, data.latitude, data.longitude, NEARBY_TAKEN_RADIUS_M);

                      const disabled = !uid || isAutoTaking || !near.ok;

                      const label = !near.ok
                        ? `Too far (${Math.round(near.dist)}m)`
                        : "Mark as Taken";

                      return (
                        <TouchableOpacity
                          style={[styles.takeButton, disabled && styles.takeButtonDisabled]}
                          disabled={disabled}
                          onPress={() => {
                            Alert.alert(
                              "Mark as taken?",
                              "This will resolve the report so others won't see it as open.",
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Mark Taken",
                                  style: "destructive",
                                  onPress: async () => {
                                    setSelectedMarker(null);
                                    await onManualMarkTaken(reportId, data.latitude, data.longitude);
                                  },
                                },
                              ],
                            );
                          }}
                        >
                          <Text style={[styles.takeButtonText, disabled && styles.takeButtonTextDisabled]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })()}

                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={() => setSelectedMarker(null)}
                  >
                    <Text style={styles.closeButtonText}>Close</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  markerModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  markerModalContent: {
    backgroundColor: "white",
    borderRadius: 15,
    padding: 20,
    width: "80%",
    maxWidth: 300,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  markerModalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 15,
    textAlign: "center",
    color: "#000",
  },
  markerModalText: {
    fontSize: 16,
    marginBottom: 8,
    color: "#333",
  },
  // Red destructive button for removing a pin
  removeButton: {
    backgroundColor: "#FF3B30",
    padding: 12,
    borderRadius: 8,
    marginTop: 15,
  },
  removeButtonText: {
    color: "white",
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 16,
  },
  closeButton: {
    marginTop: 10,
    padding: 10,
  },
  closeButtonText: {
    color: "#007AFF",
    textAlign: "center",
    fontSize: 16,
  },
  // Orange button for marking a spot as taken
  takeButton: {
    backgroundColor: "#FF9500",
    padding: 12,
    borderRadius: 8,
    marginTop: 10,
  },
  takeButtonText: {
    color: "white",
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 16,
  },
  // Grey style when the take button is disabled
  takeButtonDisabled: {
    backgroundColor: "#BDBDBD",
  },
  takeButtonTextDisabled: {
    color: "#EEEEEE",
  },
});