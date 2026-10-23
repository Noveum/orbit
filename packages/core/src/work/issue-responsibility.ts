import { and, eq, schema } from '@orbit/db';
import { validationFailed } from '@orbit/shared/errors';
import type { Actor } from '@orbit/shared/events';
import { assertInTeam, assertPersonalAgentAssignment, type Principal } from '@orbit/shared/policy';
import type { Executor } from '../internal.ts';
import { findPrincipal } from '../org/member-service.ts';
import { attachIssueActors } from './issue-actor-view.ts';
import type { IssueRow } from './issue-fields.ts';

type IssueAssignmentValues = Partial<
  Pick<IssueRow, 'assigneeId' | 'assigneeUserId' | 'assigneeAgentId' | 'ownerUserId'>
>;

interface AssignmentInput {
  readonly assigneeId?: string | null | undefined;
  readonly assigneeAgentId?: string | null | undefined;
}

async function requireHumanReader(
  executor: Executor,
  organizationId: string,
  teamId: string,
  userId: string,
): Promise<void> {
  await executor
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, organizationId)))
    .for('share');
  await executor
    .select({ id: schema.teamMember.id })
    .from(schema.teamMember)
    .where(and(eq(schema.teamMember.userId, userId), eq(schema.teamMember.teamId, teamId)))
    .for('share');
  const human = await findPrincipal(userId, organizationId, executor);
  if (human === null)
    throw validationFailed('The responsible person is not a member of this workspace.');
  assertInTeam(human, { id: teamId, organizationId });
}

export async function issueAssignmentValues(
  executor: Executor,
  principal: Principal,
  actor: Actor,
  teamId: string,
  input: AssignmentInput,
  current?: IssueRow,
): Promise<IssueAssignmentValues> {
  const { userId, agentId, changing } = requestedAssignment(input, current);
  const moved = current !== undefined && teamId !== current.teamId;
  let ownerUserId = current?.ownerUserId ?? null;
  if (agentId !== null && (changing || moved)) {
    const agentOwner = await agentAssignmentOwner(
      executor,
      principal,
      actor,
      teamId,
      agentId,
      changing,
    );
    if (changing) ownerUserId ??= agentOwner;
  } else if (userId !== null && (changing || moved)) {
    await requireHumanReader(executor, principal.organizationId, teamId, userId);
    if (changing) ownerUserId ??= userId;
  }
  if (moved && ownerUserId !== null)
    await requireHumanReader(executor, principal.organizationId, teamId, ownerUserId);
  if (!changing) return {};
  return { assigneeId: userId, assigneeUserId: userId, assigneeAgentId: agentId, ownerUserId };
}

function requestedAssignment(input: AssignmentInput, current: IssueRow | undefined) {
  if (input.assigneeId != null && input.assigneeAgentId != null) {
    throw validationFailed('An Issue can have only one Assignee.');
  }
  const explicit = input.assigneeId !== undefined || input.assigneeAgentId !== undefined;
  const userId = explicit
    ? (input.assigneeId ?? null)
    : (current?.assigneeUserId ?? current?.assigneeId ?? null);
  const agentId = explicit ? (input.assigneeAgentId ?? null) : (current?.assigneeAgentId ?? null);
  const changing =
    current === undefined ||
    userId !== (current.assigneeUserId ?? current.assigneeId) ||
    agentId !== current.assigneeAgentId;
  return { userId, agentId, changing };
}

async function agentAssignmentOwner(
  executor: Executor,
  principal: Principal,
  actor: Actor,
  teamId: string,
  agentId: string,
  establishing: boolean,
): Promise<string> {
  const [agent] = await executor
    .select()
    .from(schema.agentIdentity)
    .where(eq(schema.agentIdentity.id, agentId))
    .limit(1)
    .for('share');
  if (
    agent === undefined ||
    agent.deletedAt !== null ||
    agent.ownerUserId === null ||
    agent.organizationId !== principal.organizationId
  ) {
    throw validationFailed('That Personal Agent is not available in this workspace.');
  }
  if (establishing) assertPersonalAgentAssignment(principal, actor, agent);
  await requireHumanReader(executor, principal.organizationId, teamId, agent.ownerUserId);
  return agent.ownerUserId;
}

export function initialAssigneeId(actor: Actor, input: AssignmentInput): string | null {
  if (input.assigneeId !== undefined || input.assigneeAgentId !== undefined)
    return input.assigneeId ?? null;
  return actor.type === 'user' ? actor.id : null;
}

export function issueCreatorValues(
  actor: Actor,
): Pick<IssueRow, 'creatorId' | 'creatorUserId' | 'creatorAgentId'> {
  if (actor.type === 'agent')
    return { creatorId: null, creatorUserId: null, creatorAgentId: actor.id };
  return { creatorId: actor.id, creatorUserId: actor.id, creatorAgentId: null };
}

export async function assignmentActivityValues(
  executor: Executor,
  organizationId: string,
  current: IssueRow,
  next: IssueRow,
): Promise<{ from: unknown; to: unknown }> {
  if (current.assigneeAgentId === null && next.assigneeAgentId === null)
    return { from: current.assigneeId, to: next.assigneeId };
  const [before, after] = await attachIssueActors(executor, organizationId, [current, next]);
  return { from: before?.assignee ?? null, to: after?.assignee ?? null };
}

export async function assignmentRecipient(
  executor: Executor,
  issue: IssueRow,
): Promise<string | null> {
  if (issue.assigneeAgentId === null) return issue.assigneeUserId ?? issue.assigneeId;
  const [agent] = await executor
    .select({ ownerUserId: schema.agentIdentity.ownerUserId })
    .from(schema.agentIdentity)
    .where(
      and(
        eq(schema.agentIdentity.id, issue.assigneeAgentId),
        eq(schema.agentIdentity.organizationId, issue.organizationId),
      ),
    )
    .limit(1);
  return agent?.ownerUserId ?? null;
}
