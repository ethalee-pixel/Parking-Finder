// MapOverlays.tsx
// UI elements that appear on top of the map: non-blocking centered loading indicator,
// status legend, history/sign-out buttons, recenter button, and a shared bottom banner.

import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type UndoState = {
  reportId: string;
  message: string;
  expiresAt: number;
  isProcessing: boolean;
};

type Props = {
  isCreatingSpot: boolean;
  isAutoTaking: boolean;
  isValidatingPlacement: boolean;
  undoState: UndoState | null;

  autoTakenBanner: string | null;

  onUndo: () => void;
  onShowHistory: () => void;
  onSignOut: () => void;
  onRecenter: () => void;
};

export function MapOverlays({
  isCreatingSpot,
  isAutoTaking,
  isValidatingPlacement,
  undoState,
  autoTakenBanner,
  onUndo,
  onShowHistory,
  onSignOut,
  onRecenter,
}: Props) {
  const undoSecondsLeft = useMemo(() => {
    if (!undoState) return 0;
    return Math.max(0, Math.ceil((undoState.expiresAt - Date.now()) / 1000));
  }, [undoState]);

  const bottomBannerMessage = undoState
    ? `${undoState.message} Undo? (${undoSecondsLeft}s)`
    : autoTakenBanner;

  const isBusy = isCreatingSpot || isAutoTaking || isValidatingPlacement;

  const loadingText = isCreatingSpot
    ? 'Saving spot...'
    : isValidatingPlacement
      ? 'Checking location...'
      : 'Updating...';

  return (
    <>
      {isBusy && (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#111111" />
            <Text style={styles.loadingText}>{loadingText}</Text>
          </View>
        </View>
      )}

      <View style={styles.colorGuide}>
        <Text style={styles.guideTitle}>Status</Text>

        <View style={styles.colorRow}>
          <View style={[styles.colorDot, styles.dotActive]} />
          <Text style={styles.guideText}>Active</Text>
        </View>

        <View style={styles.colorRow}>
          <View style={[styles.colorDot, styles.dotExpiring]} />
          <Text style={styles.guideText}>Expiring Soon</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.actionBtn} onPress={onShowHistory}>
        <Text style={styles.actionBtnText}>My History</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.actionBtn, styles.signOutBtn]} onPress={onSignOut}>
        <Text style={styles.actionBtnText}>Sign Out</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.recenterBtn}
        onPress={onRecenter}
        accessibilityLabel="Recenter map"
      >
        <Text style={styles.recenterText}>O</Text>
      </TouchableOpacity>

      {bottomBannerMessage && (
        <View style={styles.bottomBanner}>
          <Text style={styles.bottomBannerText}>{bottomBannerMessage}</Text>

          {undoState && (
            <TouchableOpacity
              style={[styles.undoBtn, undoState.isProcessing && styles.disabled]}
              onPress={onUndo}
              disabled={undoState.isProcessing}
            >
              <Text style={styles.undoBtnText}>
                {undoState.isProcessing ? 'Undoing...' : 'UNDO'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.20)',
    zIndex: 30,
    elevation: 30,
  },
  loadingCard: {
    minWidth: 240,
    paddingVertical: 22,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: 'white',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  loadingText: {
    marginTop: 12,
    fontWeight: '700',
    fontSize: 16,
    color: '#111111',
  },

  colorGuide: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 20,
    elevation: 5,
  },
  guideTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  guideText: {
    fontSize: 10,
    marginLeft: 5,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotActive: {
    backgroundColor: '#00ff00',
  },
  dotExpiring: {
    backgroundColor: '#ff0000',
  },

  actionBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'white',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    elevation: 5,
  },
  signOutBtn: {
    top: 100,
  },
  actionBtnText: {
    fontWeight: 'bold',
  },

  recenterBtn: {
    position: 'absolute',
    right: 20,
    bottom: 34,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
  },
  recenterText: {
    fontSize: 22,
    fontWeight: '800',
  },

  bottomBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 96,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomBannerText: {
    color: 'white',
    flex: 1,
    marginRight: 12,
  },
  undoBtn: {
    backgroundColor: 'white',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  undoBtnText: {
    fontWeight: '800',
  },

  disabled: {
    opacity: 0.6,
  },
});
