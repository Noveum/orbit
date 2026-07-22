export const MINUTES_PER_DAY = 1440;

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
  const parts = formatter.formatToParts(at);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '0';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '0';
  return (Number.parseInt(hour, 10) % 24) * 60 + Number.parseInt(minute, 10);
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
  const untilEnd = (end - now + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
  const rounded = new Date(at.getTime());
  rounded.setUTCSeconds(0, 0);
  return new Date(rounded.getTime() + untilEnd * 60_000);
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
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
}
