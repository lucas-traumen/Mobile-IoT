/**
 * timeAxis tests (history-smart-home-redesign): the shared x-domain +
 * tick formatting contract that keeps every History chart aligned.
 */

import {
  formatRangeLine,
  formatTime,
  formatTooltipTime,
  tickCountForWidth,
  tickFormatter,
  tickValuesForDomain,
  timeDomainForRange,
} from './timeAxis';

const NOW = new Date(2026, 8, 7, 14, 30); // 07/09/2026 14:30 local

describe('timeDomainForRange', () => {
  it('computes [now − duration, now] in unix seconds for every range', () => {
    const end = Math.floor(NOW.getTime() / 1000);
    expect(timeDomainForRange('1h', NOW)).toEqual({ start: end - 3600, end });
    expect(timeDomainForRange('24h', NOW)).toEqual({
      start: end - 86400,
      end,
    });
    expect(timeDomainForRange('7d', NOW)).toEqual({
      start: end - 7 * 86400,
      end,
    });
  });
});

describe('formatRangeLine', () => {
  it('formats `DD/MM HH:mm – DD/MM HH:mm` (24h)', () => {
    expect(formatRangeLine('1h', NOW)).toBe('07/09 13:30 – 07/09 14:30');
  });

  it('crosses midnight for the 24h/7d ranges', () => {
    expect(formatRangeLine('24h', NOW)).toBe('06/09 14:30 – 07/09 14:30');
    expect(formatRangeLine('7d', NOW)).toBe('31/08 14:30 – 07/09 14:30');
  });
});

describe('formatTooltipTime', () => {
  it('always includes the date (`DD/MM HH:mm`)', () => {
    const t = Math.floor(NOW.getTime() / 1000);
    expect(formatTooltipTime(t)).toBe('07/09 14:30');
  });
});

describe('tickCountForWidth', () => {
  it('reduces ticks on narrow widths and clamps to 3–7', () => {
    expect(tickCountForWidth(200)).toBe(3);
    expect(tickCountForWidth(326)).toBe(5);
    expect(tickCountForWidth(600)).toBe(7);
    expect(tickCountForWidth(2000)).toBe(7);
  });
});

describe('tickValuesForDomain', () => {
  it('spans the domain inclusive, evenly spaced', () => {
    const domain = timeDomainForRange('1h', NOW);
    const ticks = tickValuesForDomain(domain, 326);
    expect(ticks).toHaveLength(5);
    expect(ticks[0]).toBe(domain.start);
    expect(ticks[ticks.length - 1]).toBe(domain.end);
    const step = ticks[1] - ticks[0];
    for (let i = 2; i < ticks.length; i++) {
      expect(Math.abs(ticks[i] - ticks[i - 1] - step)).toBeLessThanOrEqual(1);
    }
  });
});

describe('tickFormatter', () => {
  it('is plain `HH:mm` when the domain stays within one calendar day', () => {
    const domain = timeDomainForRange('1h', NOW);
    const format = tickFormatter(domain);
    expect(format(domain.start)).toBe('13:30');
    expect(format(domain.end)).toBe('14:30');
  });

  it('adds the date at each day change when the domain crosses midnight', () => {
    const domain = timeDomainForRange('24h', NOW);
    const format = tickFormatter(domain);
    // First tick starts a new day → date prefix.
    expect(format(domain.start)).toBe('06/09 14:30');
    // A tick on the SAME day stays time-only; a tick on the next day
    // carries the new date.
    const t1 = domain.start + 3600; // 06/09 15:30
    expect(format(t1)).toBe('15:30');
    const nextDay = new Date(2026, 8, 7, 2, 0);
    const t2 = Math.floor(nextDay.getTime() / 1000); // 07/09 02:00
    expect(format(t2)).toBe('07/09 02:00');
    expect(format(t2 + 3600)).toBe('03:00');
    expect(formatTime(t2)).toBe('02:00');
  });
});
