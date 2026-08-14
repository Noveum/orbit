import type { AnalyticsCompare, AnalyticsQuery } from '@orbit/shared';
import type {
  AnalyticsBucketGranularity,
  AnalyticsDateRange,
  AnalyticsResolutionContext,
  AnalyticsSprint,
  ResolvedAnalyticsQuery,
} from './types.ts';

const DAY_MILLISECONDS = 86_400_000;
const MAX_BUCKETS = 120;

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function validDate(value: Date, name: string): Date {
  if (!Number.isFinite(value.getTime())) throw new RangeError(`${name} must be a valid date.`);
  return value;
}

function validTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new RangeError(`${timezone} is not a valid reporting timezone.`);
  }
}

function dateParts(date: Date, timezone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  if (![year, month, day].every(Number.isInteger)) {
    throw new RangeError(`Could not resolve a calendar date in ${timezone}.`);
  }
  return { year, month, day };
}

export function calendarDateLabel(date: Date, timezone: string): string {
  const value = dateParts(validDate(date, 'The calendar date'), validTimezone(timezone));
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

function dateTimeAsUtc(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = value('hour');
  const minute = value('minute');
  const second = value('second');
  if (![year, month, day, hour, minute, second].every(Number.isInteger)) {
    throw new RangeError(`Could not resolve a UTC offset for ${timezone}.`);
  }
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function startOfCalendarDate(date: CalendarDate, timezone: string): Date {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = new Date(target + hours * 3_600_000);
    offsets.add(dateTimeAsUtc(instant, timezone) - instant.getTime());
  }
  const candidates = [...offsets]
    .map((offset) => new Date(target - offset))
    .filter((candidate) => compareCalendarDates(dateParts(candidate, timezone), date) === 0)
    .sort((left, right) => left.getTime() - right.getTime());
  const earliest = candidates[0];
  if (earliest !== undefined) return earliest;
  throw new RangeError(`The calendar date does not exist in ${timezone}.`);
}

export function reportingCalendar(now: Date, timezone: string) {
  const valid = validTimezone(timezone);
  const current = dateParts(validDate(now, 'The reporting clock'), valid);
  return {
    today: `${String(current.year).padStart(4, '0')}-${String(current.month).padStart(2, '0')}-${String(current.day).padStart(2, '0')}`,
    startOfDay: (day: string): Date => startOfCalendarDate(parseCalendarDate(day), valid),
  };
}

function parseCalendarDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    match === null ||
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day
  ) {
    throw new RangeError(`${value} is not a valid calendar date.`);
  }
  return { year, month, day };
}

function calendarOrdinal(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / DAY_MILLISECONDS;
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  return calendarOrdinal(left) - calendarOrdinal(right);
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
  const monthIndex = date.year * 12 + date.month - 1 + months;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

function assertOrderedRange(range: AnalyticsDateRange): AnalyticsDateRange {
  validDate(range.from, 'The range start');
  validDate(range.to, 'The range end');
  if (range.from.getTime() >= range.to.getTime()) {
    throw new RangeError('The analytics range must end after it starts.');
  }
  return range;
}

function calendarRange(from: CalendarDate, toExclusive: CalendarDate, timezone: string) {
  return assertOrderedRange({
    from: startOfCalendarDate(from, timezone),
    to: startOfCalendarDate(toExclusive, timezone),
    timezone,
  });
}

function trailingDays(now: Date, days: number, timezone: string): AnalyticsDateRange {
  const today = dateParts(now, timezone);
  return calendarRange(addCalendarDays(today, 1 - days), addCalendarDays(today, 1), timezone);
}

function sprintRange(sprint: AnalyticsSprint): AnalyticsDateRange {
  const timezone = validTimezone(sprint.timezone);
  return assertOrderedRange({
    from: new Date(validDate(sprint.startsAt, 'The sprint start').getTime()),
    to: new Date(validDate(sprint.endsAt, 'The sprint end').getTime()),
    timezone,
  });
}

function isArchived(sprint: AnalyticsSprint): boolean {
  return sprint.archivedAt !== undefined && sprint.archivedAt !== null;
}

function activeSprints(cycles: readonly AnalyticsSprint[], now: Date): readonly AnalyticsSprint[] {
  const timestamp = now.getTime();
  return cycles.filter(
    (cycle) =>
      !isArchived(cycle) &&
      cycle.completedAt === null &&
      cycle.startsAt.getTime() <= timestamp &&
      cycle.endsAt.getTime() > timestamp,
  );
}

function cycleMatchesFilter(cycle: AnalyticsSprint, query: AnalyticsQuery): boolean {
  const matches = (node: AnalyticsQuery['filter']['children'][number]): boolean => {
    if (node.kind === 'condition') {
      if (node.property !== 'cycle' || node.operator !== 'in') return true;
      const included = node.values.includes(cycle.id);
      return node.negate ? !included : included;
    }
    const values = node.children.map(matches);
    return node.combinator === 'and' ? values.every(Boolean) : values.some(Boolean);
  };
  const values = query.filter.children.map(matches);
  return query.filter.combinator === 'and' ? values.every(Boolean) : values.some(Boolean);
}

function selectedCycleIds(query: AnalyticsQuery): ReadonlySet<string> {
  const selected = new Set<string>();
  const collect = (node: AnalyticsQuery['filter']['children'][number]): void => {
    if (node.kind === 'group') {
      for (const child of node.children) collect(child);
      return;
    }
    if (node.property !== 'cycle' || node.operator !== 'in' || node.negate) return;
    for (const value of node.values) selected.add(value);
  };
  for (const child of query.filter.children) collect(child);
  return selected;
}

interface SprintRelevance {
  readonly cycles: readonly AnalyticsSprint[];
  readonly active: readonly AnalyticsSprint[];
  readonly anchor: AnalyticsSprint | null;
  readonly teamId: string | null;
}

function sprintRelevance(
  query: AnalyticsQuery,
  context: AnalyticsResolutionContext,
): SprintRelevance {
  const cycles = context.cycles.filter((cycle) => {
    if (
      context.selectedCycleId !== undefined &&
      context.selectedCycleId !== null &&
      cycle.id !== context.selectedCycleId
    )
      return false;
    if (
      context.selectedTeamId !== undefined &&
      context.selectedTeamId !== null &&
      cycle.teamId !== context.selectedTeamId
    )
      return false;
    return cycleMatchesFilter(cycle, query);
  });
  const active = activeSprints(cycles, context.now);
  const filteredCycleIds = selectedCycleIds(query);
  let explicitCycle: AnalyticsSprint | null = null;
  if (context.selectedCycleId !== undefined && context.selectedCycleId !== null) {
    explicitCycle = cycles.find((cycle) => cycle.id === context.selectedCycleId) ?? null;
  } else if (cycles.length === 1 && filteredCycleIds.has(cycles[0]?.id ?? '')) {
    explicitCycle = cycles[0] ?? null;
  }
  const onlyActive = active.length === 1 ? active[0] : undefined;
  const anchor = explicitCycle ?? onlyActive ?? null;
  const teamIds = [...new Set(cycles.map((cycle) => cycle.teamId).filter((id) => id !== null))];
  const teamId =
    anchor === null
      ? (context.selectedTeamId ?? (teamIds.length === 1 ? (teamIds[0] ?? null) : null))
      : anchor.teamId;
  return { cycles, active, anchor, teamId };
}

function latestCompletedSprint(
  cycles: readonly AnalyticsSprint[],
  now: Date,
  teamId: string | null,
  before: AnalyticsSprint | null,
): AnalyticsSprint | null {
  const eligible = cycles.filter((cycle) => {
    if (isArchived(cycle) || cycle.completedAt === null) return false;
    if (cycle.completedAt.getTime() > now.getTime()) return false;
    if (cycle.teamId !== teamId) return false;
    return before === null || cycle.endsAt.getTime() <= before.startsAt.getTime();
  });
  return (
    eligible.sort((left, right) => {
      const byEnd = right.endsAt.getTime() - left.endsAt.getTime();
      return byEnd === 0 ? right.id.localeCompare(left.id) : byEnd;
    })[0] ?? null
  );
}

function allTimeRange(context: AnalyticsResolutionContext, timezone: string): AnalyticsDateRange {
  const fallback = trailingDays(context.now, 30, timezone);
  const earliest = context.allTimeFrom ?? context.earliestIssueAt;
  if (earliest === undefined || earliest === null) return fallback;
  const toDate = addCalendarDays(dateParts(context.now, timezone), 1);
  const earliestDate = dateParts(validDate(earliest, 'The earliest issue date'), timezone);
  const fromDate =
    compareCalendarDates(earliestDate, toDate) < 0 ? earliestDate : addCalendarDays(toDate, -1);
  return calendarRange(fromDate, toDate, timezone);
}

function customRange(from: string, to: string, timezone: string): AnalyticsDateRange {
  const start = parseCalendarDate(from);
  const inclusiveEnd = parseCalendarDate(to);
  if (compareCalendarDates(start, inclusiveEnd) > 0) {
    throw new RangeError('The custom analytics range must end on or after its start.');
  }
  return calendarRange(start, addCalendarDays(inclusiveEnd, 1), timezone);
}

interface SelectedRange {
  readonly range: AnalyticsDateRange;
  readonly sprint: AnalyticsSprint | null;
}

function selectedRange(
  query: AnalyticsQuery,
  context: AnalyticsResolutionContext,
  reportingTimezone: string,
  relevance: SprintRelevance,
): SelectedRange {
  const onlyActive = relevance.active.length === 1 ? relevance.active[0] : undefined;
  switch (query.range.preset) {
    case 'auto':
    case 'active_sprint':
      return onlyActive === undefined
        ? { range: trailingDays(context.now, 30, reportingTimezone), sprint: null }
        : { range: sprintRange(onlyActive), sprint: onlyActive };
    case 'previous_sprint': {
      const reference = onlyActive ?? relevance.anchor;
      const previous = latestCompletedSprint(
        context.cycles,
        context.now,
        relevance.teamId,
        reference,
      );
      const selected = previous;
      return selected === null
        ? { range: trailingDays(context.now, 30, reportingTimezone), sprint: null }
        : { range: sprintRange(selected), sprint: selected };
    }
    case 'last_30_days':
      return { range: trailingDays(context.now, 30, reportingTimezone), sprint: null };
    case 'last_90_days':
      return { range: trailingDays(context.now, 90, reportingTimezone), sprint: null };
    case 'all_time':
      return { range: allTimeRange(context, reportingTimezone), sprint: null };
    case 'custom':
      return {
        range: customRange(query.range.from, query.range.to, reportingTimezone),
        sprint: null,
      };
  }
}

function isLocalMidnight(date: Date, timezone: string): boolean {
  const localDate = dateParts(date, timezone);
  return startOfCalendarDate(localDate, timezone).getTime() === date.getTime();
}

function previousEqualRange(range: AnalyticsDateRange): AnalyticsDateRange {
  if (isLocalMidnight(range.from, range.timezone) && isLocalMidnight(range.to, range.timezone)) {
    const fromDate = dateParts(range.from, range.timezone);
    const toDate = dateParts(range.to, range.timezone);
    const days = calendarOrdinal(toDate) - calendarOrdinal(fromDate);
    return calendarRange(addCalendarDays(fromDate, -days), fromDate, range.timezone);
  }
  const duration = range.to.getTime() - range.from.getTime();
  return assertOrderedRange({
    from: new Date(range.from.getTime() - duration),
    to: new Date(range.from.getTime()),
    timezone: range.timezone,
  });
}

function comparisonRange(
  compare: AnalyticsCompare,
  selected: SelectedRange,
  context: AnalyticsResolutionContext,
  relevance: SprintRelevance,
): AnalyticsDateRange | null {
  let resolvedCompare = compare;
  if (resolvedCompare === 'auto') {
    resolvedCompare = selected.sprint === null ? 'previous_period' : 'previous_sprint';
  }
  if (resolvedCompare === 'none') return null;
  if (resolvedCompare === 'previous_period') return previousEqualRange(selected.range);
  const reference = selected.sprint ?? relevance.anchor;
  const teamId = selected.sprint?.teamId ?? relevance.teamId;
  const previous = latestCompletedSprint(context.cycles, context.now, teamId, reference);
  return previous === null ? null : sprintRange(previous);
}

function bucketForRange(range: AnalyticsDateRange): AnalyticsBucketGranularity {
  const fromDate = dateParts(range.from, range.timezone);
  const toDate = dateParts(range.to, range.timezone);
  const days = calendarOrdinal(toDate) - calendarOrdinal(fromDate);
  if (days <= 45) return 'day';
  const fifteenMonthsLater = addCalendarMonths(fromDate, 15);
  return compareCalendarDates(toDate, fifteenMonthsLater) <= 0 ? 'week' : 'month';
}

export function resolveAnalyticsQuery(
  query: AnalyticsQuery,
  context: AnalyticsResolutionContext,
): ResolvedAnalyticsQuery {
  const reportingTimezone = validTimezone(context.timezone);
  validDate(context.now, 'The reporting clock');
  const relevance = sprintRelevance(query, context);
  const selected = selectedRange(query, context, reportingTimezone, relevance);
  const comparison = comparisonRange(query.compare, selected, context, relevance);
  return {
    ...query,
    asOf: new Date(context.now.getTime()),
    resolvedRange: selected.range,
    comparisonRange: comparison,
    from: selected.range.from,
    to: selected.range.to,
    comparisonFrom: comparison?.from ?? null,
    comparisonTo: comparison?.to ?? null,
    bucket: bucketForRange(selected.range),
    timezone: selected.range.timezone,
    selectedSprintId: selected.sprint?.id ?? null,
  };
}

function monthSpan(range: AnalyticsDateRange): number {
  const from = dateParts(range.from, range.timezone);
  const to = dateParts(new Date(range.to.getTime() - 1), range.timezone);
  return (to.year - from.year) * 12 + to.month - from.month + 1;
}

function bucketDateAt(
  firstDate: CalendarDate,
  bucket: AnalyticsBucketGranularity,
  index: number,
  monthStep: number,
): CalendarDate {
  if (bucket === 'day') return addCalendarDays(firstDate, index);
  if (bucket === 'week') return addCalendarDays(firstDate, index * 7);
  return addCalendarMonths(firstDate, index * monthStep);
}

export function bucketDates(
  range: AnalyticsDateRange,
  bucket: AnalyticsBucketGranularity,
): readonly Date[] {
  const normalized = assertOrderedRange({
    from: new Date(range.from.getTime()),
    to: new Date(range.to.getTime()),
    timezone: validTimezone(range.timezone),
  });
  const dates: Date[] = [normalized.from];
  const firstDate = dateParts(normalized.from, normalized.timezone);
  const monthStep =
    bucket === 'month' ? Math.max(1, Math.ceil(monthSpan(normalized) / MAX_BUCKETS)) : 1;
  let index = 1;
  while (dates.length < MAX_BUCKETS) {
    const nextDate = bucketDateAt(firstDate, bucket, index, monthStep);
    const next = startOfCalendarDate(nextDate, normalized.timezone);
    if (next.getTime() >= normalized.to.getTime()) break;
    const previous = dates.at(-1);
    if (previous !== undefined && next.getTime() > previous.getTime()) dates.push(next);
    index += 1;
  }
  return dates;
}

export type { AnalyticsResolutionContext, AnalyticsSprint } from './types.ts';
