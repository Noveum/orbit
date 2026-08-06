const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MONDAY = 1;
const SUNDAY = 0;

function startOfDay(value: Date): Date {
  const day = new Date(value.getTime());
  day.setHours(0, 0, 0, 0);
  return day;
}

function daysBack(weekday: number): number {
  if (weekday === MONDAY) return 3;
  if (weekday === SUNDAY) return 2;
  return 1;
}

export function standupSince(now: Date): Date {
  const day = startOfDay(now);
  day.setDate(day.getDate() - daysBack(day.getDay()));
  return day;
}

export function formatSinceLabel(since: Date, now: Date): string {
  const yesterday = startOfDay(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (startOfDay(since).getTime() === yesterday.getTime()) return 'since yesterday';
  return `since ${WEEKDAYS[since.getDay()] ?? 'earlier'}`;
}

export function formatBoardDate(now: Date): string {
  const weekday = WEEKDAYS[now.getDay()] ?? '';
  const month = MONTHS[now.getMonth()] ?? '';
  return `${weekday} ${month} ${now.getDate()}`;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const padded = (value: number) => String(value).padStart(2, '0');
  if (hours === 0) return `${minutes}:${padded(seconds)}`;
  return `${hours}:${padded(minutes)}:${padded(seconds)}`;
}
