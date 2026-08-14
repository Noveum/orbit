import { type AnalyticsIssueRow, listAnalyticsDrilldown } from '@orbit/core';
import { toCsv } from '@/features/analytics/csv.ts';
import { analyticsDrilldownFromSearchParams } from '@/features/analytics/query-state.ts';
import { handle } from '@/lib/api/handler.ts';

const PAGE_SIZE = 200;
const EXPORT_LIMIT = 10_000;

export async function GET(request: Request): Promise<Response> {
  const query = analyticsDrilldownFromSearchParams(new URL(request.url).searchParams);
  return await handle(async (principal) => {
    const issues: AnalyticsIssueRow[] = [];
    let cursor: string | undefined;
    let first: Awaited<ReturnType<typeof listAnalyticsDrilldown>> | undefined;
    do {
      const page = await listAnalyticsDrilldown(principal, {
        query,
        cohort: query.cohort,
        ...(cursor === undefined ? {} : { cursor }),
        limit: PAGE_SIZE,
      });
      first ??= page;
      issues.push(...page.issues.slice(0, EXPORT_LIMIT - issues.length));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined && issues.length < EXPORT_LIMIT);

    const page = first;
    const truncated = page !== undefined && page.total > issues.length;
    const metadata: ReadonlyArray<ReadonlyArray<string | number>> =
      page === undefined
        ? []
        : [
            ['Orbit analytics evidence'],
            ['Predicate', page.predicate],
            ['Measure', query.measure],
            [
              'Formula',
              query.measure === 'points'
                ? 'Sum of estimates; unestimated is zero'
                : 'Count of issues',
            ],
            ['Timezone', page.timezone],
            ['Coverage', 'Exact semantic issue cohort at the data-through timestamp'],
            ['From', page.from],
            ['To', page.to],
            ['Data through', page.asOf],
            ['Matching issues', page.total],
            [],
          ];
    const rows = issues.map((issue) => [
      issue.identifier,
      issue.title,
      issue.state.name,
      issue.assignee?.name ?? 'Unassigned',
      issue.project?.name ?? 'No project',
      issue.estimate ?? 'Unestimated',
      issue.priority,
      issue.dueDate ?? '',
      issue.completedAt ?? '',
      issue.updatedAt,
    ]);
    const csv = toCsv([
      ...metadata,
      [
        'Identifier',
        'Title',
        'State',
        'Assignee',
        'Project',
        'Estimate',
        'Priority',
        'Due date',
        'Completed at',
        'Updated at',
      ],
      ...rows,
    ]);

    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="orbit-analytics-evidence.csv"',
        'x-orbit-export-limit': String(EXPORT_LIMIT),
        'x-orbit-export-truncated': truncated ? 'true' : 'false',
      },
    });
  });
}
