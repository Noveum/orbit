import { z } from 'zod';
import { SLUG_PATTERN } from '../constants/index.ts';

export const idSchema = z.string().min(1).max(64);
export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(SLUG_PATTERN, 'Use lowercase and dashes.');
export const emailSchema = z.string().email().max(254).toLowerCase();
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #5A63C8.');
export const markdownSchema = z.string().max(100_000);
export const titleSchema = z.string().trim().min(1, 'Give it a title.').max(255);

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const EARLIEST_CALENDAR_YEAR = 1;
const LATEST_CALENDAR_YEAR = 9999;

function calendarDayOf(value: string | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : inCalendarRange(value);
  }
  if (!CALENDAR_DAY.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value)) return null;
  return inCalendarRange(parsed);
}

function inCalendarRange(value: Date): Date | null {
  const year = value.getUTCFullYear();
  if (year < EARLIEST_CALENDAR_YEAR || year > LATEST_CALENDAR_YEAR) return null;
  return value;
}

export const calendarDateSchema = z
  .union([z.string().trim().max(64), z.date()])
  .transform((value, ctx) => {
    const day = calendarDayOf(value);
    if (day === null) {
      ctx.addIssue({ code: 'custom', message: 'Use a calendar day like 2031-03-04.' });
      return z.NEVER;
    }
    return day;
  });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(256).optional(),
});
