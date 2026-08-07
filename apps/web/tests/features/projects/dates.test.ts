import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { formatDay } from '../../../src/features/projects/dates.ts';

const originalTimezone = process.env['TZ'] ?? '';

function restoreTimezone(): void {
  process.env['TZ'] = originalTimezone;
}

function inTimezone(zone: string, run: () => void): void {
  process.env['TZ'] = zone;
  try {
    run();
  } finally {
    restoreTimezone();
  }
}

beforeEach(restoreTimezone);

afterEach(restoreTimezone);

describe('formatDay', () => {
  it('names the day the server stored, west of UTC as well as east of it', () => {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata']) {
      inTimezone(zone, () => {
        expect(formatDay('2026-06-08', { withYear: true, missing: 'Not set' })).toBe('8 Jun 2026');
      });
    }
  });

  it('drops the year when the caller does not want one', () => {
    expect(formatDay('2026-01-01', { withYear: false, missing: 'No target' })).toBe('1 Jan');
    expect(formatDay('2026-12-31', { withYear: false, missing: 'No target' })).toBe('31 Dec');
  });

  it('reads the day off a full timestamp too', () => {
    expect(formatDay('2026-06-08T23:30:00.000Z', { withYear: true, missing: 'Not set' })).toBe(
      '8 Jun 2026',
    );
  });

  it('falls back to the missing label for null and for anything that is not a date', () => {
    expect(formatDay(null, { withYear: true, missing: 'Not set' })).toBe('Not set');
    expect(formatDay('soon', { withYear: true, missing: 'No target' })).toBe('No target');
    expect(formatDay('2026-13-01', { withYear: true, missing: 'No target' })).toBe('No target');
  });
});
