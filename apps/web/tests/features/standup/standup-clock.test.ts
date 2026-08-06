import { describe, expect, it } from 'bun:test';
import {
  formatBoardDate,
  formatElapsed,
  formatSinceLabel,
  standupSince,
} from '../../../src/features/standup/standup-clock.ts';

function localNoon(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

describe('standupSince', () => {
  it('walks a Tuesday back to Monday midnight in the viewer clock', () => {
    const since = standupSince(localNoon(2026, 6, 9));

    expect(since.getFullYear()).toBe(2026);
    expect(since.getMonth()).toBe(5);
    expect(since.getDate()).toBe(8);
    expect(since.getDay()).toBe(1);
  });

  it('walks a Monday back to Friday so weekend work is not lost', () => {
    const since = standupSince(localNoon(2026, 6, 8));

    expect(since.getDate()).toBe(5);
    expect(since.getDay()).toBe(5);
  });

  it('walks a Sunday back to Friday too', () => {
    const since = standupSince(localNoon(2026, 6, 7));

    expect(since.getDate()).toBe(5);
    expect(since.getDay()).toBe(5);
  });

  it('always lands on the start of the local day', () => {
    const since = standupSince(new Date(2026, 5, 9, 23, 47, 12, 500));

    expect(since.getHours()).toBe(0);
    expect(since.getMinutes()).toBe(0);
    expect(since.getSeconds()).toBe(0);
    expect(since.getMilliseconds()).toBe(0);
  });
});

describe('formatSinceLabel', () => {
  it('reads as yesterday on an ordinary weekday', () => {
    const now = localNoon(2026, 6, 9);
    expect(formatSinceLabel(standupSince(now), now)).toBe('since yesterday');
  });

  it('names the day when the window reaches further back', () => {
    const now = localNoon(2026, 6, 8);
    expect(formatSinceLabel(standupSince(now), now)).toBe('since Friday');
  });
});

describe('formatBoardDate', () => {
  it('names the weekday, the month and the day without a locale lookup', () => {
    expect(formatBoardDate(localNoon(2026, 6, 9))).toBe('Tuesday June 9');
  });
});

describe('formatElapsed', () => {
  it('pads seconds under a minute', () => {
    expect(formatElapsed(7_000)).toBe('0:07');
  });

  it('reads minutes and seconds under an hour', () => {
    expect(formatElapsed(65_000)).toBe('1:05');
  });

  it('adds the hour once it passes one', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
  });

  it('never goes negative on a clock that jumped', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});
