import { inArray, schema } from '@orbit/db';
import type { Executor } from '../internal.ts';

export type IssueActorRef =
  | { readonly type: 'user'; readonly id: string }
  | { readonly type: 'agent'; readonly id: string };

export type ActorView = IssueActorRef & {
  readonly name: string;
  readonly avatar: string | null;
  readonly deleted: boolean;
};

export interface IssueActorColumns {
  readonly creatorId: string | null;
  readonly creatorUserId: string | null;
  readonly creatorAgentId: string | null;
  readonly assigneeId: string | null;
  readonly assigneeUserId: string | null;
  readonly assigneeAgentId: string | null;
  readonly ownerUserId: string | null;
}

export interface IssueActorView {
  readonly creator: ActorView;
  readonly assignee: ActorView | null;
  readonly owner: ActorView | null;
  readonly creatorId: string | null;
  readonly assigneeId: string | null;
  readonly creatorAgentId: string | null;
  readonly assigneeAgentId: string | null;
  readonly ownerId: string | null;
}

export type CanonicalIssueRead<T extends IssueActorColumns> = Omit<T, keyof IssueActorView> &
  IssueActorView;

function actorOf(
  userId: string | null,
  agentId: string | null,
  legacyUserId: string | null,
): IssueActorRef | null {
  if (userId !== null) return { type: 'user', id: userId };
  if (agentId !== null) return { type: 'agent', id: agentId };
  return legacyUserId === null ? null : { type: 'user', id: legacyUserId };
}

export function issueActorView(
  input: IssueActorColumns,
  actors: ReadonlyMap<string, ActorView> = new Map(),
): IssueActorView {
  const creator = actorOf(input.creatorUserId, input.creatorAgentId, input.creatorId);
  if (creator === null) throw new Error('An Issue must have a creator actor.');
  const assignee = actorOf(input.assigneeUserId, input.assigneeAgentId, input.assigneeId);
  const legacy = input.creatorUserId === null && input.creatorAgentId === null;
  const ownerId = input.ownerUserId ?? (legacy && assignee?.type === 'user' ? assignee.id : null);
  const view = (actor: IssueActorRef): ActorView =>
    actors.get(`${actor.type}:${actor.id}`) ?? {
      ...actor,
      name: actor.type === 'agent' ? 'Deleted agent' : 'Former member',
      avatar: null,
      deleted: true,
    };
  return {
    creator: view(creator),
    assignee: assignee === null ? null : view(assignee),
    owner: ownerId === null ? null : view({ type: 'user', id: ownerId }),
    creatorId: creator.type === 'user' ? creator.id : null,
    assigneeId: assignee?.type === 'user' ? assignee.id : null,
    creatorAgentId: input.creatorAgentId,
    assigneeAgentId: input.assigneeAgentId,
    ownerId,
  };
}

export async function canonicalIssueReads<T extends IssueActorColumns>(
  executor: Executor,
  rows: readonly T[],
): Promise<CanonicalIssueRead<T>[]> {
  if (rows.length === 0) return [];
  const refs = rows.flatMap((row) => {
    const view = issueActorView(row);
    return [view.creator, view.assignee, view.owner].filter(
      (actor): actor is ActorView => actor !== null,
    );
  });
  const userIds = [...new Set(refs.filter((ref) => ref.type === 'user').map((ref) => ref.id))];
  const agentIds = [...new Set(refs.filter((ref) => ref.type === 'agent').map((ref) => ref.id))];
  const [users, agents] = await Promise.all([
    userIds.length === 0
      ? []
      : executor.select().from(schema.user).where(inArray(schema.user.id, userIds)),
    agentIds.length === 0
      ? []
      : executor
          .select()
          .from(schema.agentIdentity)
          .where(inArray(schema.agentIdentity.id, agentIds)),
  ]);
  const actors = new Map<string, ActorView>();
  for (const user of users)
    actors.set(`user:${user.id}`, {
      type: 'user',
      id: user.id,
      name: user.name,
      avatar: user.image,
      deleted: false,
    });
  for (const agent of agents)
    actors.set(`agent:${agent.id}`, {
      type: 'agent',
      id: agent.id,
      name: agent.name,
      avatar: agent.avatar,
      deleted: agent.deletedAt !== null,
    });
  return rows.map((row) => ({ ...row, ...issueActorView(row, actors) }));
}
