/**
 * History screen — Vietnamese room-aware sensor charts for 1h/24h/7d
 * (CP4 + CP-R5), restyled to the Smart Home design language
 * (history-smart-home-redesign): the screen now consumes the shared
 * `tokens.smart` block and no longer touches the legacy gel tokens.
 *
 * Visual language (synced with the Dashboard tab):
 * - background: the ambient diagonal wash (tealTint → page → amberTint);
 * - header: the ☰ menu button (opens the shared `RoomListModal` from the
 *   dashboard module — imported via `@modules/dashboard/api` per the
 *   module boundaries rule) + the `Lịch sử` screen title
 *   (`smart.typography.screenTitle`), both in the same centered 880pt
 *   content band as the Dashboard header;
 * - filters: TWO white dropdowns (`FilterDropdown`) — the room selector
 *   (the dropdown replaces the legacy chip strip) and the range selector
 *   (`1 giờ` / `24 giờ` / `7 ngày` — the HistoryRange values are
 *   unchanged) — plus the actual visible date range line below them
 *   (`DD/MM HH:mm – DD/MM HH:mm`, wraps on narrow screens);
 * - charts: one Smart Home card per eligible saved-layout room sensor
 *   (`HistoryChartCard`) stacked vertically on every form factor —
 *   registration order is preserved (temperature then humidity in the
 *   default catalog), and a registration without points renders its
 *   `Chưa có dữ liệu` card instead of disappearing. Identity stays the
 *   room-scoped `field`. App selects valid registered sensor bindings from
 *   the active Template's saved room layout, independently of editor drafts.
 *
 * Charting: `victory-native` (v36) on top of `react-native-svg` — React 19
 * requires explicit native SVG primitives for every victory component
 * (see `HistoryChartCard`). All colors come from the active theme tokens
 * (smart block for surfaces/typography; the per-series accent resolves
 * through the centralized capability resolver). The x-domain and tick
 * formatting are SHARED across cards (`timeAxis.ts`) so the charts align.
 */

import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { HISTORY_RANGES } from '@core/constants';
import { STRINGS } from '@core/i18n';
import { useTheme } from '@core/theme';
import { RoomListModal, STACKED_BREAKPOINT } from '@modules/dashboard/api';
import type { CapabilityDef, Room } from '@modules/devices/api';
import { resolveCapabilityAccent } from '@modules/widgets/api';
import type { HistoryRange, HistorySeries } from '@modules/history/api';

import { FilterDropdown, type FilterDropdownOption } from './FilterDropdown';
import { HistoryChartCard } from './HistoryChartCard';
import {
  formatRangeLine,
  tickFormatter,
  tickValuesForDomain,
  timeDomainForRange,
} from './timeAxis';

interface HistoryScreenProps {
  /** Selected range. */
  range: HistoryRange;
  /** Fetched series (one per roomId + field for the queried room). */
  series: HistorySeries[];
  loading: boolean;
  error: string | null;
  /** All rooms (room dropdown + menu dialog). */
  rooms: readonly Room[];
  /**
   * Registered fields selected by valid sensor-value widgets in the active
   * Template's saved room layout (derived in App). Every entry renders one
   * card with or without points; returned series cannot add unselected cards.
   */
  registeredFields: readonly string[];
  /** Capability catalog (card label/unit + accent fallback). */
  capabilities: readonly CapabilityDef[];
  /** The shared active room (`null` = no valid room — directed to Settings). */
  roomId: string | null;
  /**
   * The identity the queried series carry in their `roomId` (optional,
   * board-discovery-binding): the board code when the active room is bound
   * to a board, the internal room id otherwise. Pairing uses THIS value;
   * the room dropdown keeps using `roomId`. Omitted → identity pairing
   * against `roomId` (the historical behavior).
   */
  seriesRoomId?: string | null;
  /** True when no sensor is selected in the saved room layout (no query). */
  noSensors: boolean;
  /** Called when the user picks a new range. */
  onRangeChange: (range: HistoryRange) => void;
  /** Called when the user picks a room (updates the shared active room). */
  onRoomChange: (roomId: string) => void;
}

/** One prepared per-registration card model. */
interface SeriesCardModel {
  /** Stable card identity: the room-scoped field. */
  key: string;
  /** Raw capability field (accent + series pairing). */
  field: string;
  /** Card header label (capability label, `def?.label ?? field`). */
  fieldLabel: string;
  /** Display unit appended to the title + stats (may be ''). */
  unit: string;
  /** Line/area accent (theme tokens for built-ins, catalog color else). */
  color: string;
  points: { t: number; value: number }[];
}

/**
 * The card-header glyph for a sensor field (approved iconography):
 * thermometer for temperature, water-drop for humidity, the neutral
 * analytics fallback for every other registered capability.
 */
function iconForField(field: string): keyof typeof Ionicons.glyphMap {
  switch (field) {
    case 'temperature':
      return 'thermometer-outline';
    case 'humidity':
      return 'water-outline';
    default:
      return 'analytics-outline';
  }
}

/** Responsive chart height: 160–200 phone, 200–240 tablet (wide canvas). */
function chartHeightForWidth(windowWidth: number, wide: boolean): number {
  if (wide) {
    return Math.min(240, Math.max(200, Math.round(windowWidth * 0.28)));
  }
  return Math.min(200, Math.max(160, Math.round(windowWidth * 0.5)));
}

/**
 * History screen: the Smart Home header (menu + title), two filter
 * dropdowns (room + range) with the visible date-range line, then one
 * smart chart card per selected registered sensor — with loading / error /
 * no-rooms / no-sensors / no-data branches preserved.
 */
export function HistoryScreen({
  range,
  series,
  loading,
  error,
  rooms,
  registeredFields,
  capabilities,
  roomId,
  seriesRoomId,
  noSensors,
  onRangeChange,
  onRoomChange,
}: HistoryScreenProps) {
  const { tokens } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);

  // History's own band decision on the SHARED 560 threshold (the same
  // constant the Dashboard view uses for its narrow/wide inset — see
  // `STACKED_BREAKPOINT`): zero behavior change from the view WYSIWYG
  // refactor.
  const wide = windowWidth >= STACKED_BREAKPOINT;
  const contentWidth = wide
    ? Math.min(windowWidth, 880) - tokens.smart.spacing.screenHWide * 2
    : windowWidth - tokens.smart.spacing.screenH * 2;
  const chartHeight = chartHeightForWidth(windowWidth, wide);

  // The SHARED time axis: one domain (range end = now) + one tick value
  // set + one formatter for every card, so the charts always align.
  const domain = timeDomainForRange(range, new Date());
  const tickValues = tickValuesForDomain(domain, contentWidth);
  const tickFormat = tickFormatter(domain);
  const dateRangeText = formatRangeLine(range, new Date());

  const rangeOptions: readonly FilterDropdownOption<HistoryRange>[] =
    HISTORY_RANGES.map(r => ({ value: r, label: STRINGS.history.ranges[r] }));
  const roomOptions: readonly FilterDropdownOption<string>[] = rooms.map(
    room => ({ value: room.id, label: room.name }),
  );

  // One card per selected registered sensor field: the card exists whether
  // or not the query returned points — a selected registered
  // sensor without data shows `Chưa có dữ liệu` instead of disappearing.
  // Defensive room identity (approved `roomId + field`, "never guess"
  // contract): a series is paired ONLY when its identity tag equals
  // the queried room identity (`seriesRoomId` — the board code for bound
  // rooms, the internal id otherwise; falls back to `roomId`). The identity
  // tag is `(boardId ?? roomId)` (boards-topic-contract-v2): board-bound
  // rows pair by the board tag, legacy rows by `roomId` — untagged (`null`)
  // and wrong-room series can never populate a card (the pairing runs even
  // though the Flux query already filters the room, so a legacy/broken
  // source cannot leak points in).
  const seriesIdentity = seriesRoomId ?? roomId;
  const cards: SeriesCardModel[] = registeredFields.map(field => {
    const entry =
      seriesIdentity === null
        ? undefined
        : series.find(
            candidate =>
              candidate.field === field &&
              (candidate.boardId ?? candidate.roomId) !== null &&
              (candidate.boardId ?? candidate.roomId) === seriesIdentity,
          );
    const def = capabilities.find(candidate => candidate.type === field);
    return {
      key: field,
      field,
      fieldLabel: def?.label ?? field,
      unit: def?.unit ?? '',
      color: resolveCapabilityAccent(field, def, tokens),
      points: entry?.points ?? [],
    };
  });

  return (
    // The ambient Smart Home wash: diagonal teal tint → page → amber tint
    // (same recipe as the Dashboard tab).
    <LinearGradient
      testID="history-ambient"
      colors={[
        tokens.smart.colors.tealTint,
        tokens.smart.colors.page,
        tokens.smart.colors.amberTint,
      ]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.flex}
    >
      <ScrollView
        testID="history-scroll"
        contentContainerStyle={styles.content}
      >
        <View style={[styles.band, wide ? styles.padWide : styles.padNarrow]}>
          {/* Header: ☰ menu (opens the shared room-list dialog) + the
              `Lịch sử` screen title — same band + anatomy as Dashboard. */}
          <View style={styles.header}>
            <Pressable
              testID="history-room-menu"
              style={styles.menuButton}
              accessibilityLabel={STRINGS.history.roomMenu}
              onPress={() => setRoomMenuOpen(true)}
            >
              <Ionicons
                name="menu"
                size={24}
                color={tokens.smart.colors.textPrimary}
              />
            </Pressable>
            <Text
              style={[
                styles.title,
                {
                  color: tokens.smart.colors.textPrimary,
                  fontSize: tokens.smart.typography.screenTitle,
                },
              ]}
            >
              {STRINGS.history.title}
            </Text>
          </View>

          {/* Filters: TWO white dropdowns (room + range) — no chip strip,
              no range chip row. */}
          <View style={styles.filtersRow}>
            <FilterDropdown
              testID="history-room-dropdown"
              placeholder={STRINGS.history.roomPlaceholder}
              title={STRINGS.history.roomMenu}
              value={roomId}
              options={roomOptions}
              onChange={onRoomChange}
              flex
            />
            <FilterDropdown
              testID="history-range-dropdown"
              placeholder={STRINGS.history.rangePlaceholder}
              value={range}
              options={rangeOptions}
              onChange={onRangeChange}
              flex
            />
          </View>

          {/* The ACTUAL visible date range (computed from the active
              range, end = now); wraps on narrow screens. */}
          <Text
            testID="history-date-range"
            style={[
              styles.dateRange,
              {
                color: tokens.smart.colors.textSecondary,
                fontSize: tokens.smart.typography.secondary,
              },
            ]}
          >
            {dateRangeText}
          </Text>

          {loading ? (
            <Text
              style={[
                styles.hint,
                { color: tokens.smart.colors.textSecondary },
              ]}
            >
              {STRINGS.history.loading}
            </Text>
          ) : null}
          {!loading && error ? (
            <Text style={[styles.error, { color: tokens.danger }]}>
              {error}
            </Text>
          ) : null}
          {!loading && !error && rooms.length === 0 ? (
            <Text
              style={[
                styles.hint,
                { color: tokens.smart.colors.textSecondary },
              ]}
            >
              {STRINGS.dashboard.noRooms}
            </Text>
          ) : null}
          {!loading && !error && rooms.length > 0 && noSensors ? (
            <Text
              style={[
                styles.hint,
                { color: tokens.smart.colors.textSecondary },
              ]}
            >
              {STRINGS.history.noSensorForRoom}
            </Text>
          ) : null}
          {/* One card per selected registered sensor — with or without points.
              Hidden while the saved layout has no eligible sensor: stale
              series from the previously selected room must never stay on
              screen. The key scopes the card to room + range
              (history-chart-reveal-downsample AD-1): changing either
              REMOUNTS the card so the reveal animation replays, while a
              plain data refresh (same room + range) keeps the card
              mounted and never replays. */}
          {!loading && !error && !noSensors
            ? cards.map(card => (
                <HistoryChartCard
                  key={`${card.key}:${roomId}:${range}`}
                  testID={`history-card-${card.field}`}
                  icon={iconForField(card.field)}
                  label={card.fieldLabel}
                  unit={card.unit}
                  points={card.points}
                  color={card.color}
                  tokens={tokens}
                  chartWidth={contentWidth}
                  chartHeight={chartHeight}
                  wide={wide}
                  domain={domain}
                  tickValues={tickValues}
                  tickFormat={tickFormat}
                />
              ))
            : null}
        </View>
      </ScrollView>

      {/* The shared full room list — the same dialog the Dashboard header
          opens (via the dashboard module's public facade). */}
      <RoomListModal
        visible={roomMenuOpen}
        rooms={rooms}
        activeRoomId={roomId}
        onSelectRoom={id => {
          onRoomChange(id);
          setRoomMenuOpen(false);
        }}
        onClose={() => setRoomMenuOpen(false)}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Content scrolls; the paddingBottom keeps the last card clear of the
  // tab bar (the navigator owns the bottom inset — this is spacing only).
  content: { paddingBottom: 80 },
  // The centered 880pt content band (same as the Dashboard): horizontal
  // padding comes from the smart spacing scale (16 narrow / 24 wide).
  band: {
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
  },
  padNarrow: { paddingHorizontal: 16 },
  padWide: { paddingHorizontal: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 14,
  },
  // Menu button: ≥44 touch target (approved header anatomy).
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontWeight: '700',
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  dateRange: {
    marginBottom: 14,
    flexShrink: 1,
  },
  hint: { textAlign: 'center', marginVertical: 24 },
  error: { textAlign: 'center', marginVertical: 12 },
});
