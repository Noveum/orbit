import { ianaTimezoneSchema } from '@orbit/shared/validators';

export function storedReportingTimezone(value: string | null | undefined): string {
  const timezone = value?.trim() ?? 'UTC';
  const current = ianaTimezoneSchema.safeParse(timezone);
  if (current.success) return current.data;
  const offset = /^UTC([+-])(\d{1,2})$/u.exec(timezone);
  if (offset === null) return 'UTC';
  const hours = Number(offset[2]);
  const candidate = hours === 0 ? 'UTC' : `Etc/GMT${offset[1] === '+' ? '-' : '+'}${hours}`;
  const legacy = ianaTimezoneSchema.safeParse(candidate);
  return legacy.success ? legacy.data : 'UTC';
}
