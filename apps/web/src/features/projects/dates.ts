const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

export interface DayFormat {
  readonly withYear: boolean;
  readonly missing: string;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatDay(value: string | null, format: DayFormat): string {
  if (value === null) return format.missing;
  const parts = DAY_ONLY.exec(value);
  if (parts === null) return format.missing;
  const year = parts[1];
  const month = MONTHS[Number(parts[2]) - 1];
  const day = parts[3];
  if (year === undefined || month === undefined || day === undefined) return format.missing;
  const plainDay = String(Number(day));
  return format.withYear ? `${plainDay} ${month} ${year}` : `${plainDay} ${month}`;
}
