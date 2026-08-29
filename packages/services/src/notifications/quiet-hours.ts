export const MINUTES_PER_DAY = 1440;

const OFFSET_SAMPLE_HOURS = [-48, -24, 0, 24, 48] as const;

const formatters = new Map<string, Intl.DateTimeFormat>();

export interface QuietHours {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
}

export function parseClock(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return 0;
  const hours = Number.parseInt(match[1] ?? '0', 10);
  const minutes = Number.parseInt(match[2] ?? '0', 10);
  if (hours > 23 || minutes > 59) return 0;
  return hours * 60 + minutes;
}

export function localMinutes(at: Date, timeZone: string): number {
  const formatter = formatterFor(timeZone);
  const local = localDateTime(at, formatter);
  return local.hour * 60 + local.minute;
}

export function isWithinQuietHours(at: Date, quietHours: QuietHours): boolean {
  if (!quietHours.enabled) return false;
  const start = parseClock(quietHours.start);
  const end = parseClock(quietHours.end);
  if (start === end) return false;
  const now = localMinutes(at, quietHours.timeZone);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export function nextQuietHoursEnd(at: Date, quietHours: QuietHours): Date {
  const end = parseClock(quietHours.end);
  const now = localMinutes(at, quietHours.timeZone);
  const formatter = formatterFor(quietHours.timeZone);
  const local = localDateTime(at, formatter);
  const targetWallClock = Date.UTC(
    local.year,
    local.month - 1,
    local.day + (end <= now ? 1 : 0),
    Math.floor(end / 60),
    end % 60,
  );
  const exactCandidates = new Set<number>();
  for (const sampleHours of OFFSET_SAMPLE_HOURS) {
    const sample = targetWallClock + sampleHours * 60 * 60_000;
    const offset = localTimestamp(new Date(sample), formatter) - sample;
    const candidate = targetWallClock - offset;
    if (
      candidate > at.getTime() &&
      localTimestamp(new Date(candidate), formatter) === targetWallClock
    ) {
      exactCandidates.add(candidate);
    }
  }
  const exact = [...exactCandidates].sort((left, right) => left - right)[0];
  if (exact !== undefined) return new Date(exact);
  const untilEnd = (end - now + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
  const rounded = new Date(at.getTime());
  rounded.setUTCSeconds(0, 0);
  return new Date(rounded.getTime() + untilEnd * 60_000);
}

interface LocalDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function localDateTime(at: Date, formatter: Intl.DateTimeFormat): LocalDateTime {
  const parts = formatter.formatToParts(at);
  return {
    year: partNumber(parts, 'year'),
    month: partNumber(parts, 'month'),
    day: partNumber(parts, 'day'),
    hour: partNumber(parts, 'hour') % 24,
    minute: partNumber(parts, 'minute'),
  };
}

function partNumber(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);
}

function localTimestamp(at: Date, formatter: Intl.DateTimeFormat): number {
  const local = localDateTime(at, formatter);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const created = safeFormatter(timeZone);
  formatters.set(timeZone, created);
  return created;
}

function safeFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
}
