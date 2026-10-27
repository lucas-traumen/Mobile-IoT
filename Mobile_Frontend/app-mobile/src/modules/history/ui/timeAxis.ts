/**
 * Shared time-axis utilities for the History chart cards
 * (history-smart-home-redesign): ONE x-domain (computed from the active
 * range, end = now) + ONE tick formatter, so every chart card on the screen
 * aligns on the same time scale (two charts never disagree about the time
 * window or the label format).
 *
 * Tick contract (approved spec):
 * - labels are 24h `HH:mm`;
 * - when the range crosses midnight (more than one calendar day visible),
 *   the FIRST tick of each new day includes the date (`DD/MM HH:mm`) so a
 *   7d chart stays readable;
 * - the tick COUNT adapts to the available pixel width (narrow screens get
 *   fewer ticks — no overlapping labels).
 */

import type { HistoryRange } from '@modules/history/api';

/** One shared x-domain for every chart on the History screen. */
export interface TimeDomain {
  /** Window start (unix seconds, inclusive). */
  readonly start: number;
  /** Window end (unix seconds = the "now" the domain was computed at). */
  readonly end: number;
}

/** Range → window length in milliseconds (end − start). */
const RANGE_MS: Record<HistoryRange, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

/**
 * The shared x-domain for the active range: `[now − duration, now]` (unix
 * seconds — the series' `t` unit).
 */
export function timeDomainForRange(range: HistoryRange, now: Date): TimeDomain {
  const end = Math.floor(now.getTime() / 1000);
  const start = Math.floor((now.getTime() - RANGE_MS[range]) / 1000);
  return { start, end };
}

/** `HH:mm` (24h, zero-padded) for a unix-seconds timestamp. */
export function formatTime(tSeconds: number): string {
  const date = new Date(tSeconds * 1000);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** `DD/MM` (zero-padded) for a unix-seconds timestamp. */
export function formatDay(tSeconds: number): string {
  const date = new Date(tSeconds * 1000);
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mo}`;
}

/**
 * The visible date-range line under the filter dropdowns:
 * `DD/MM HH:mm – DD/MM HH:mm` (24h). May wrap on narrow screens (the
 * caller allows wrapping).
 */
export function formatRangeLine(range: HistoryRange, now: Date): string {
  const domain = timeDomainForRange(range, now);
  const startText = `${formatDay(domain.start)} ${formatTime(domain.start)}`;
  const endText = `${formatDay(domain.end)} ${formatTime(domain.end)}`;
  return `${startText} – ${endText}`;
}

/** `DD/MM HH:mm` (24h) — tooltip timestamp (always carries the date). */
export function formatTooltipTime(tSeconds: number): string {
  return `${formatDay(tSeconds)} ${formatTime(tSeconds)}`;
}

/**
 * The target tick count for a chart of `width` pixels: ~64pt per tick
 * keeps labels from overlapping on narrow phones while denser wide/tablet
 * charts stay readable. Clamped to 3–7 ticks.
 */
export function tickCountForWidth(width: number): number {
  return Math.max(3, Math.min(7, Math.floor(width / 64)));
}

/**
 * The x-axis tick VALUES for a domain + width: `tickCountForWidth(width)`
 * evenly spaced unix-seconds timestamps from start to end (inclusive).
 */
export function tickValuesForDomain(
  domain: TimeDomain,
  width: number,
): number[] {
  const count = tickCountForWidth(width);
  if (count <= 1) {
    return [domain.start];
  }
  const step = (domain.end - domain.start) / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    Math.round(domain.start + step * i),
  );
}

/**
 * The shared x-axis tick FORMATTER: `HH:mm` for every tick, upgraded to
 * `DD/MM HH:mm` when the domain spans more than one calendar day AND the
 * tick is the first one of its day (the date appears exactly where the day
 * changes, so a 7d chart stays readable without a date on every label).
 */
export function tickFormatter(domain: TimeDomain): (t: number) => string {
  const startDay = formatDay(domain.start);
  const endDay = formatDay(domain.end);
  const crossesMidnight = startDay !== endDay;
  let lastDay = '';
  return (t: number) => {
    if (!crossesMidnight) {
      return formatTime(t);
    }
    const day = formatDay(t);
    if (day !== lastDay) {
      lastDay = day;
      return `${day} ${formatTime(t)}`;
    }
    return formatTime(t);
  };
}
