// HistoryModal.tsx
// Modal that shows the signed-in user's report history with simple filters + sorting.

import React, { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type MapView from 'react-native-maps';
import type { Region } from 'react-native-maps';

import type { ParkingReport } from '../services/parkingReports';
import { formatDuration, getAgeInSeconds, getTimeInMillis } from '../utils/time';

const DEFAULT_FOCUS_REGION: Pick<Region, 'latitudeDelta' | 'longitudeDelta'> = {
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const FOCUS_ANIMATION_MS = 350;

type HistoryTypeFilter = 'all' | 'free' | 'paid';
type HistoryStatusFilter = 'all' | 'open' | 'resolved';
type HistoryRangeFilter = 'all' | '24h' | '7d' | '30d';
type HistorySortOption = 'newest' | 'oldest' | 'paidFirst' | 'freeFirst';

type Props = {
  showHistory: boolean;
  myReports: ParkingReport[];
  mapRef: React.RefObject<MapView | null>;
  setShowHistory: (v: boolean) => void;
};

function getRangeMs(range: HistoryRangeFilter): number | null {
  switch (range) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
    case 'all':
    default:
      return null;
  }
}

function compareByTypeThenTime(
  a: ParkingReport,
  b: ParkingReport,
  typeFirst: 'paid' | 'free',
): number {
  const at = getTimeInMillis(a.createdAt);
  const bt = getTimeInMillis(b.createdAt);

  if (a.type !== b.type) {
    return a.type === typeFirst ? -1 : 1;
  }

  // Within the same type, default to newest-first.
  return bt - at;
}

export function HistoryModal({ showHistory, myReports, mapRef, setShowHistory }: Props) {
  const [historyType, setHistoryType] = useState<HistoryTypeFilter>('all');

  // Filters: status, range, and sort.
  const [historyStatus, setHistoryStatus] = useState<HistoryStatusFilter>('all');
  const [historyRange, setHistoryRange] = useState<HistoryRangeFilter>('all');
  const [historySort, setHistorySort] = useState<HistorySortOption>('newest');

  // Filter + sort are derived state.
  const filteredMyReports = useMemo(() => {
    const nowMs = Date.now();
    const rangeMs = getRangeMs(historyRange);

    const matchesRange = (createdAt: unknown) => {
      if (!rangeMs) return true;

      const t = getTimeInMillis(createdAt);
      const ageMs = nowMs - t;

      return ageMs <= rangeMs;
    };

    const filtered = myReports.filter((r) => {
      if (historyType !== 'all' && r.type !== historyType) return false;
      if (historyStatus !== 'all' && r.status !== historyStatus) return false;
      if (!matchesRange(r.createdAt)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const at = getTimeInMillis(a.createdAt);
      const bt = getTimeInMillis(b.createdAt);

      switch (historySort) {
        case 'newest':
          return bt - at;
        case 'oldest':
          return at - bt;
        case 'paidFirst':
          return compareByTypeThenTime(a, b, 'paid');
        case 'freeFirst':
          return compareByTypeThenTime(a, b, 'free');
        default:
          return bt - at;
      }
    });

    return filtered;
  }, [myReports, historyType, historyStatus, historyRange, historySort]);

  const close = () => setShowHistory(false);

  const focusMarker = (report: ParkingReport) => {
    mapRef.current?.animateToRegion(
      {
        latitude: report.latitude,
        longitude: report.longitude,
        ...DEFAULT_FOCUS_REGION,
      },
      FOCUS_ANIMATION_MS,
    );

    close();
  };

  const renderPill = (label: string, isActive: boolean, onPress: () => void) => {
    return (
      <TouchableOpacity style={[styles.pill, isActive && styles.pillActive]} onPress={onPress}>
        <Text style={styles.pillText}>{label}</Text>
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item }: { item: ParkingReport }) => {
    const ageSeconds = getAgeInSeconds(item.createdAt);
    const durationSeconds = item.durationSeconds ?? 30;

    const isExpired = ageSeconds >= durationSeconds;

    // Display how long it lasted if expired, otherwise show "alive so far".
    const durationText = isExpired ? formatDuration(durationSeconds) : formatDuration(ageSeconds);

    const statusLabel = isExpired ? 'Expired' : 'Active';
    const statusColor = isExpired ? '#999' : 'green';

    const label =
      item.type === 'free' ? 'Free Spot' : `Paid Spot${item.rate ? `: ${item.rate}` : ''}`;

    return (
      // Each row shows type, status, and duration. Tapping focuses the map if not expired.
      <TouchableOpacity
        style={[styles.historyRow, isExpired && styles.historyRowExpired]}
        disabled={isExpired}
        onPress={() => focusMarker(item)}
      >
        <View style={styles.rowHeader}>
          <Text style={[styles.historyTitle, isExpired && styles.textMuted]}>{label}</Text>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>

        <Text style={styles.historySub}>Alive for: {durationText}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={showHistory} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>My Report History</Text>

          {/* Filters: type, status, range, sort */}
          <View style={styles.filterBlock}>
            <Text style={styles.filterLabel}>Type</Text>
            <View style={styles.pillRow}>
              {renderPill('All', historyType === 'all', () => setHistoryType('all'))}
              {renderPill('Free', historyType === 'free', () => setHistoryType('free'))}
              {renderPill('Paid', historyType === 'paid', () => setHistoryType('paid'))}
            </View>

            <Text style={styles.filterLabel}>Status</Text>
            <View style={styles.pillRow}>
              {renderPill('All', historyStatus === 'all', () => setHistoryStatus('all'))}
              {renderPill('Open', historyStatus === 'open', () => setHistoryStatus('open'))}
              {renderPill('Resolved', historyStatus === 'resolved', () =>
                setHistoryStatus('resolved'),
              )}
            </View>

            <Text style={styles.filterLabel}>Range</Text>
            <View style={styles.pillRow}>
              {renderPill('All', historyRange === 'all', () => setHistoryRange('all'))}
              {renderPill('24h', historyRange === '24h', () => setHistoryRange('24h'))}
              {renderPill('7d', historyRange === '7d', () => setHistoryRange('7d'))}
              {renderPill('30d', historyRange === '30d', () => setHistoryRange('30d'))}
            </View>

            <Text style={styles.filterLabel}>Sort</Text>
            <View style={styles.pillRow}>
              {renderPill('Newest', historySort === 'newest', () => setHistorySort('newest'))}
              {renderPill('Oldest', historySort === 'oldest', () => setHistorySort('oldest'))}
              {renderPill('Paid first', historySort === 'paidFirst', () =>
                setHistorySort('paidFirst'),
              )}
              {renderPill('Free first', historySort === 'freeFirst', () =>
                setHistorySort('freeFirst'),
              )}
            </View>
          </View>

          <FlatList
            data={filteredMyReports}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ListEmptyComponent={<Text style={styles.emptyText}>No reports yet.</Text>}
            showsVerticalScrollIndicator={false}
          />

          <TouchableOpacity onPress={close}>
            <Text style={styles.cancelText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
    maxHeight: '80%',
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
  filterBlock: { marginBottom: 12 },
  filterLabel: { fontWeight: 'bold', marginTop: 8, marginBottom: 6 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    borderWidth: 1,
    borderColor: '#ddd',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  pillActive: { backgroundColor: '#e8f0ff', borderColor: '#9bbcff' },
  pillText: { fontSize: 12 },
  historyRow: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  historyRowExpired: {
    backgroundColor: '#f5f5f5',
    borderColor: '#ddd',
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyTitle: { fontWeight: 'bold' },
  statusText: { fontWeight: 'bold' },
  historySub: { color: '#666', marginTop: 4, fontSize: 12 },
  cancelText: { textAlign: 'center', marginTop: 15, color: '#666' },
  emptyText: { textAlign: 'center' },
  textMuted: { color: '#666' },
});
