import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";

type Props = {
  isCreatingSpot: boolean;
  isAutoTaking: boolean;
  undoState: {
    reportId: string;
    expiresAt: number;
    isProcessing: boolean;
  } | null;
  autoTakenBanner: string | null;
  onUndo: () => void;
  onShowHistory: () => void;
  onSignOut: () => void;
};

export const MapOverlays = ({
  isCreatingSpot,
  isAutoTaking,
  undoState,
  autoTakenBanner,
  onUndo,
  onShowHistory,
  onSignOut,
}: Props) => {
  return (
    <>
      {(isCreatingSpot || isAutoTaking) && (
        <View style={styles.busyPill}>
          <ActivityIndicator size="small" color="#000" />
          <Text style={styles.busyPillText}>
            {isCreatingSpot ? "Saving spot..." : "Updating..."}
          </Text>
        </View>
      )}

      {undoState && (
        <View style={styles.undoBanner}>
          <Text style={styles.undoText}>
            Marked as taken. Undo? (
            {Math.max(0, Math.ceil((undoState.expiresAt - Date.now()) / 1000))}
            s)
          </Text>

          <TouchableOpacity
            style={[styles.undoBtn, undoState.isProcessing && { opacity: 0.6 }]}
            onPress={onUndo}
            disabled={undoState.isProcessing}
          >
            <Text style={styles.undoBtnText}>
              {undoState.isProcessing ? "Undoing..." : "UNDO"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.colorGuide}>
        <Text style={styles.guideTitle}>Status</Text>
        <View style={styles.colorRow}>
          <View style={[styles.colorDot, { backgroundColor: "#00FF00" }]} />
          <Text style={styles.guideText}>Active</Text>
        </View>
        <View style={styles.colorRow}>
          <View style={[styles.colorDot, { backgroundColor: "#FF0000" }]} />
          <Text style={styles.guideText}>Expiring Soon</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.historyBtn} onPress={onShowHistory}>
        <Text style={styles.historyBtnText}>My History</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.historyBtn, { top: 100 }]}
        onPress={onSignOut}
      >
        <Text style={styles.historyBtnText}>Sign Out</Text>
      </TouchableOpacity>

      {autoTakenBanner && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{autoTakenBanner}</Text>
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  busyPill: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    elevation: 6,
  },
  busyPillText: {
    marginLeft: 8,
    fontWeight: "600",
  },
  colorGuide: {
    position: "absolute",
    bottom: 20,
    left: 20,
    backgroundColor: "white",
    padding: 10,
    borderRadius: 20,
    elevation: 5,
  },
  guideTitle: { fontSize: 10, fontWeight: "bold", marginBottom: 5 },
  colorRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  guideText: { fontSize: 10, marginLeft: 5 },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  historyBtn: {
    position: "absolute",
    top: 50,
    right: 20,
    backgroundColor: "white",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    elevation: 5,
  },
  historyBtnText: { fontWeight: "bold" },
  banner: {
    position: "absolute",
    top: 140,
    left: 20,
    right: 20,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "white",
    elevation: 6,
  },
  bannerText: {
    textAlign: "center",
    fontWeight: "600",
  },
  undoBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  undoText: { color: "white", flex: 1, marginRight: 12 },
  undoBtn: {
    backgroundColor: "white",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  undoBtnText: { fontWeight: "800" },
});