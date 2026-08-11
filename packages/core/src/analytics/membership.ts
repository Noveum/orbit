import { and, asc, eq, gt, inArray, isNull, lte, schema } from '@orbit/db';
import type { Executor } from '../internal.ts';
import { newId } from '../internal.ts';
import type { IssueRow } from '../work/issue-fields.ts';

interface MembershipChangeInput {
  readonly issue: IssueRow;
  readonly fromCycleId: string | null;
  readonly toCycleId: string | null;
  readonly occurredAt: Date;
  readonly entryKind: 'added' | 'rollover';
}

interface OpenMembershipInput {
  readonly issue: IssueRow;
  readonly cycleId: string;
  readonly occurredAt: Date;
  readonly entryKind: 'added' | 'rollover' | 'bootstrap';
  readonly coverage: 'captured' | 'observed';
}

interface CycleCloseInput {
  readonly cycle: {
    readonly id: string;
    readonly organizationId: string;
    readonly teamId: string;
    readonly startsAt: Date;
  };
  readonly rolloverCycleId: string;
  readonly occurredAt: Date;
}

type Outcome = 'completed' | 'incomplete' | 'canceled' | 'removed' | 'carryover';

async function closeOpenMembership(
  tx: Executor,
  input: Pick<MembershipChangeInput, 'issue' | 'fromCycleId' | 'occurredAt'>,
): Promise<void> {
  if (input.fromCycleId === null) return;
  await tx
    .update(schema.cycleIssueMembership)
    .set({ removedAt: input.occurredAt })
    .where(
      and(
        eq(schema.cycleIssueMembership.issueId, input.issue.id),
        eq(schema.cycleIssueMembership.cycleId, input.fromCycleId),
        isNull(schema.cycleIssueMembership.removedAt),
      ),
    );
}

async function openMembership(tx: Executor, input: OpenMembershipInput): Promise<void> {
  await tx.insert(schema.cycleIssueMembership).values({
    id: newId(),
    organizationId: input.issue.organizationId,
    teamId: input.issue.teamId,
    cycleId: input.cycleId,
    issueId: input.issue.id,
    issueIdentifier: input.issue.identifier,
    addedAt: input.occurredAt,
    entryKind: input.entryKind,
    estimateAtAdd: input.issue.estimate,
    assigneeIdAtAdd: input.issue.assigneeId,
    projectIdAtAdd: input.issue.projectId,
    milestoneIdAtAdd: input.issue.milestoneId,
    coverage: input.coverage,
  });
}

export async function captureCreatedCycleMembership(
  tx: Executor,
  input: { readonly issue: IssueRow; readonly occurredAt: Date },
): Promise<void> {
  if (input.issue.cycleId === null) return;
  await openMembership(tx, {
    issue: input.issue,
    cycleId: input.issue.cycleId,
    occurredAt: input.occurredAt,
    entryKind: 'added',
    coverage: 'captured',
  });
}

export async function captureCycleMembershipChange(
  tx: Executor,
  input: MembershipChangeInput,
): Promise<void> {
  if (input.fromCycleId !== null) await closeOpenMembership(tx, input);
  if (input.toCycleId === null) return;
  await openMembership(tx, {
    issue: input.issue,
    cycleId: input.toCycleId,
    occurredAt: input.occurredAt,
    entryKind: input.entryKind,
    coverage: 'captured',
  });
}

function closeOutcome(
  category: string | undefined,
  hasOpenMembership: boolean,
  archivedAt: Date | null | undefined,
): Outcome {
  if (!hasOpenMembership || category === undefined) return 'removed';
  if (category === 'completed') return 'completed';
  if (category === 'canceled') return 'canceled';
  if (archivedAt !== null) return 'incomplete';
  return 'carryover';
}

export async function captureCycleCloseOutcomes(
  tx: Executor,
  input: CycleCloseInput,
): Promise<void> {
  const memberships = await tx
    .select()
    .from(schema.cycleIssueMembership)
    .where(eq(schema.cycleIssueMembership.cycleId, input.cycle.id))
    .orderBy(asc(schema.cycleIssueMembership.addedAt));
  if (memberships.length === 0) return;

  const issueIds = [...new Set(memberships.map((entry) => entry.issueId))];
  const current = await tx
    .select({
      issue: schema.issue,
      category: schema.workflowState.category,
    })
    .from(schema.issue)
    .innerJoin(schema.workflowState, eq(schema.workflowState.id, schema.issue.stateId))
    .where(
      and(
        eq(schema.issue.organizationId, input.cycle.organizationId),
        inArray(schema.issue.id, issueIds),
      ),
    );
  const currentById = new Map(current.map((entry) => [entry.issue.id, entry]));
  const commitmentCutoff = input.cycle.startsAt.getTime() + 24 * 3_600_000;

  await tx.insert(schema.cycleIssueOutcome).values(
    issueIds.map((issueId) => {
      const intervals = memberships.filter((entry) => entry.issueId === issueId);
      const first = intervals[0];
      if (first === undefined) throw new Error('Sprint membership disappeared during close.');
      const plannedMembership = intervals.find(
        (entry) => entry.coverage === 'captured' && entry.addedAt.getTime() <= commitmentCutoff,
      );
      const currentEntry = currentById.get(issueId);
      const issue = currentEntry?.issue;
      const hasOpenMembership =
        issue?.cycleId === input.cycle.id &&
        intervals.some(
          (entry) =>
            entry.removedAt === null && entry.addedAt.getTime() <= input.occurredAt.getTime(),
        );
      const outcome = closeOutcome(currentEntry?.category, hasOpenMembership, issue?.archivedAt);
      return {
        id: newId(),
        organizationId: input.cycle.organizationId,
        teamId: input.cycle.teamId,
        cycleId: input.cycle.id,
        issueId,
        issueIdentifier: issue?.identifier ?? first.issueIdentifier,
        planned: plannedMembership !== undefined,
        estimateAtCommitment: plannedMembership?.estimateAtAdd ?? null,
        estimateAtClose: issue?.estimate ?? null,
        assigneeIdAtClose: issue?.assigneeId ?? null,
        projectIdAtClose: issue?.projectId ?? null,
        milestoneIdAtClose: issue?.milestoneId ?? null,
        outcome,
        completedAt: issue?.completedAt ?? null,
        closedAt: input.occurredAt,
        rolloverCycleId: outcome === 'carryover' ? input.rolloverCycleId : null,
      };
    }),
  );
}

export async function bootstrapActiveCycleMemberships(
  tx: Executor,
  occurredAt: Date = new Date(),
): Promise<number> {
  const activeCycles = await tx
    .select({ id: schema.cycle.id })
    .from(schema.cycle)
    .where(
      and(
        isNull(schema.cycle.archivedAt),
        isNull(schema.cycle.completedAt),
        lte(schema.cycle.startsAt, occurredAt),
        gt(schema.cycle.endsAt, occurredAt),
      ),
    );
  if (activeCycles.length === 0) return 0;

  const issues = await tx
    .select()
    .from(schema.issue)
    .where(
      and(
        inArray(
          schema.issue.cycleId,
          activeCycles.map((cycle) => cycle.id),
        ),
        isNull(schema.issue.archivedAt),
      ),
    );
  if (issues.length === 0) return 0;

  const existing = await tx
    .select({
      issueId: schema.cycleIssueMembership.issueId,
      cycleId: schema.cycleIssueMembership.cycleId,
    })
    .from(schema.cycleIssueMembership)
    .where(
      and(
        inArray(
          schema.cycleIssueMembership.issueId,
          issues.map((issue) => issue.id),
        ),
        isNull(schema.cycleIssueMembership.removedAt),
      ),
    );
  const openKeys = new Set(existing.map((entry) => `${entry.issueId}:${entry.cycleId}`));
  const missing = issues.filter(
    (issue) => issue.cycleId !== null && !openKeys.has(`${issue.id}:${issue.cycleId}`),
  );
  for (const issue of missing) {
    if (issue.cycleId === null) continue;
    await openMembership(tx, {
      issue,
      cycleId: issue.cycleId,
      occurredAt,
      entryKind: 'bootstrap',
      coverage: 'observed',
    });
  }
  return missing.length;
}
