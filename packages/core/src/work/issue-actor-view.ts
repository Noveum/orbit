export type IssueActorRef =
  | { readonly type: 'user'; readonly id: string }
  | { readonly type: 'agent'; readonly id: string };

export interface IssueActorColumns {
  readonly creatorId: string;
  readonly creatorUserId: string | null;
  readonly creatorAgentId: string | null;
  readonly assigneeId: string | null;
  readonly assigneeUserId: string | null;
  readonly assigneeAgentId: string | null;
  readonly ownerUserId: string | null;
}

export interface IssueActorView {
  readonly creator: IssueActorRef;
  readonly assignee: IssueActorRef | null;
  readonly owner: Extract<IssueActorRef, { readonly type: 'user' }> | null;
  readonly creatorId: string;
  readonly assigneeId: string | null;
  readonly assigneeAgentId: string | null;
}

export type CanonicalIssueRead<T extends IssueActorColumns> = T & IssueActorView;

function actorOf(
  userId: string | null,
  agentId: string | null,
  legacyUserId: string | null,
): IssueActorRef | null {
  if (userId !== null) return { type: 'user', id: userId };
  if (agentId !== null) return { type: 'agent', id: agentId };
  return legacyUserId === null ? null : { type: 'user', id: legacyUserId };
}

export function issueActorView(input: IssueActorColumns): IssueActorView {
  const creator = actorOf(input.creatorUserId, input.creatorAgentId, input.creatorId);
  if (creator === null) throw new Error('An Issue must have a creator actor.');
  return {
    creator,
    assignee: actorOf(input.assigneeUserId, input.assigneeAgentId, input.assigneeId),
    owner: input.ownerUserId === null ? null : { type: 'user', id: input.ownerUserId },
    creatorId: input.creatorId,
    assigneeId: input.assigneeId,
    assigneeAgentId: input.assigneeAgentId,
  };
}

export function canonicalIssueRead<T extends IssueActorColumns>(row: T): CanonicalIssueRead<T> {
  return { ...row, ...issueActorView(row) };
}
