// modal that shows the user's report history, with filters and sorting options
import React, { useState, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from "react-native";
import { ParkingReport } from "../parkingReports";
import { getTimeInMillis, getAgeInSeconds, formatDuration } from "../utils/time";


type Props = {
  showHistory: boolean;
  myReports: ParkingReport[];
  mapRef: React.RefObject<any>;
  setShowHistory: (v: boolean) => void;
};

export const HistoryModal = ({
  showHistory,
  myReports,
  mapRef,
  setShowHistory,
}: Props) => {
  const [historyType, setHistoryType] = useState<"all" | "free" | "paid">(
    "all",
  );
  // added status, range, and sort filters to the history modal
  const [historyStatus, setHistoryStatus] = useState<
    "all" | "open" | "resolved"
  >("all");
  const [historyRange, setHistoryRange] = useState<
    "all" | "24h" | "7d" | "30d"
  >("all");
  const [historySort, setHistorySort] = useState<
    "newest" | "oldest" | "paidFirst" | "freeFirst"
  >("newest");
    // useMemo to filter and sort the user's reports based on the selected filters and sorting options
  const filteredMyReports = useMemo(() => {
    const now = Date.now();

    const withinRange = (createdAt: any) => {
      if (historyRange === "all") return true;
      const t = getTimeInMillis(createdAt);
      const ageMs = now - t;

      if (historyRange === "24h") return ageMs <= 24 * 60 * 60 * 1000;
      if (historyRange === "7d") return ageMs <= 7 * 24 * 60 * 60 * 1000;
      if (historyRange === "30d") return ageMs <= 30 * 24 * 60 * 60 * 1000;
      return true;
    };

    // filter the user's reports based on the selected type, status, and range filters
    let arr = myReports.filter((r) => {
      if (historyType !== "all" && r.type !== historyType) return false;
      if (historyStatus !== "all" && r.status !== historyStatus) return false;
      if (!withinRange(r.createdAt)) return false;
      return true;
    });

    // sort the filtered reports based on the selected sorting option
    arr.sort((a, b) => {
      const at = getTimeInMillis(a.createdAt);
      const bt = getTimeInMillis(b.createdAt);

      if (historySort === "newest") return bt - at;
      if (historySort === "oldest") return at - bt;

      // for paidFirst and freeFirst, sort by type first, then by createdAt
      if (historySort === "paidFirst") {
        if (a.type !== b.type) return a.type === "paid" ? -1 : 1;
        return bt - at;
      }

      // for freeFirst, sort by type first, then by createdAt
      if (historySort === "freeFirst") {
        if (a.type !== b.type) return a.type === "free" ? -1 : 1;
        return bt - at;
      }

      return bt - at;
    });

    return arr;
  }, [myReports, historyType, historyStatus, historyRange, historySort]);

  return (
    <Modal visible={showHistory} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={[styles.modal, { maxHeight: "80%" }]}>
          <Text style={styles.modalTitle}>My Report History</Text>
            // filter options for the history modal, including type, status, range, and sort filters
          <View style={styles.filterBlock}>
            <Text style={styles.filterLabel}>Type</Text>
            <View style={styles.pillRow}>
              <TouchableOpacity
                style={[styles.pill, historyType === "all" && styles.pillActive]}
                onPress={() => setHistoryType("all")}
              >
                <Text style={styles.pillText}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historyType === "free" && styles.pillActive,
                ]}
                onPress={() => setHistoryType("free")}
              >
                <Text style={styles.pillText}>Free</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historyType === "paid" && styles.pillActive,
                ]}
                onPress={() => setHistoryType("paid")}
              >
                <Text style={styles.pillText}>Paid</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.filterLabel}>Status</Text>
            <View style={styles.pillRow}>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historyStatus === "all" && styles.pillActive,
                ]}
                onPress={() => setHistoryStatus("all")}
              >
                <Text style={styles.pillText}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historyStatus === "open" && styles.pillActive,
                ]}
                onPress={() => setHistoryStatus("open")}
              >
                <Text style={styles.pillText}>Open</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historyStatus === "resolved" && styles.pillActive,
                ]}
                onPress={() => setHistoryStatus("resolved")}
              >
                <Text style={styles.pillText}>Resolved</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.filterLabel}>Range</Text>
            <View style={styles.pillRow}>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historyRange === "all" && styles.pillActive,
                ]}
                onPress={() => setHistoryRange("all")}
              >
                <Text style={styles.pillText}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historyRange === "24h" && styles.pillActive,
                ]}
                onPress={() => setHistoryRange("24h")}
              >
                <Text style={styles.pillText}>24h</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historyRange === "7d" && styles.pillActive,
                ]}
                onPress={() => setHistoryRange("7d")}
              >
                <Text style={styles.pillText}>7d</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historyRange === "30d" && styles.pillActive,
                ]}
                onPress={() => setHistoryRange("30d")}
              >
                <Text style={styles.pillText}>30d</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.filterLabel}>Sort</Text>
            <View style={styles.pillRow}>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historySort === "newest" && styles.pillActive,
                ]}
                onPress={() => setHistorySort("newest")}
              >
                <Text style={styles.pillText}>Newest</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historySort === "oldest" && styles.pillActive,
                ]}
                onPress={() => setHistorySort("oldest")}
              >
                <Text style={styles.pillText}>Oldest</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historySort === "paidFirst" && styles.pillActive,
                ]}
                onPress={() => setHistorySort("paidFirst")}
              >
                <Text style={styles.pillText}>Paid first</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pill,
                  historySort === "freeFirst" && styles.pillActive,
                ]}
                onPress={() => setHistorySort("freeFirst")}
              >
                <Text style={styles.pillText}>Free first</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            data={filteredMyReports}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <Text style={{ textAlign: "center" }}>No reports yet.</Text>
            }
            renderItem={({ item }) => {
              const ageSeconds = getAgeInSeconds(item.createdAt);
              const duration = item.durationSeconds || 30;
              const isExpired = ageSeconds >= duration;

              // format the duration text to show how long the report was active for, or how long ago it expired
              const durationText = isExpired
                ? formatDuration(duration)
                : formatDuration(ageSeconds);

              const statusLabel = isExpired ? "Expired" : "Active";
              const statusColor = isExpired ? "#999" : "green";

              const label =
                item.type === "free"
                  ? "Free Spot"
                  : `Paid Spot${item.rate ? `: ${item.rate}` : ""}`;

              return (
                // each report row in the history list, showing the type, status, and duration of the report, and allowing the user to tap on it to view it on the map (if it's not expired)
                <TouchableOpacity
                  style={[
                    styles.historyRow,
                    isExpired && styles.historyRowExpired,
                  ]}
                  disabled={isExpired}
                  onPress={() => {
                    if (!isExpired) {
                      mapRef.current?.animateToRegion(
                        {
                          latitude: item.latitude,
                          longitude: item.longitude,
                          latitudeDelta: 0.01,
                          longitudeDelta: 0.01,
                        },
                        350,
                      );
                      setShowHistory(false);
                    }
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text
                      style={[
                        styles.historyTitle,
                        isExpired && { color: "#666" },
                      ]}
                    >
                      {label}
                    </Text>
                    <Text style={{ fontWeight: "bold", color: statusColor }}>
                      {statusLabel}
                    </Text>
                  </View>

                  <Text style={styles.historySub}>
                    Alive for: {durationText}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />

          <TouchableOpacity onPress={() => setShowHistory(false)}>
            <Text style={styles.cancelText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  filterBlock: { marginBottom: 12 },
  filterLabel: { fontWeight: "bold", marginTop: 8, marginBottom: 6 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    borderWidth: 1,
    borderColor: "#ddd",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  pillActive: { backgroundColor: "#e8f0ff", borderColor: "#9bbcff" },
  pillText: { fontSize: 12 },
  historyRow: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  historyRowExpired: {
    backgroundColor: "#f5f5f5",
    borderColor: "#ddd",
  },
  historyTitle: { fontWeight: "bold" },
  historySub: { color: "#666", marginTop: 4, fontSize: 12 },
  cancelText: { textAlign: "center", marginTop: 15, color: "#666" },
});