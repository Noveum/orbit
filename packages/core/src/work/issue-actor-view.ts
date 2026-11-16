import { and, eq, inArray, schema } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';
import { type IssueActor, issueSchema } from '@orbit/shared/validators';
import type { Executor } from '../internal.ts';

export interface IssueActorColumns {
  readonly organizationId?: string;
  readonly creatorId: string | null;
  readonly creatorUserId: string | null;
  readonly creatorAgentId: string | null;
  readonly assigneeId: string | null;
  readonly assigneeUserId: string | null;
  readonly assigneeAgentId: string | null;
  readonly ownerUserId: string | null;
}

export interface IssueActors {
  readonly creator: IssueActor;
  readonly assignee: IssueActor | null;
  readonly owner: IssueActor | null;
}

export type IssueActorRead<T extends IssueActorColumns> = T & IssueActors;

const issueEventActorColumnsSchema = issueSchema
  .pick({
    id: true,
    organizationId: true,
    creatorId: true,
    creatorUserId: true,
    creatorAgentId: true,
    assigneeId: true,
    assigneeUserId: true,
    assigneeAgentId: true,
    ownerUserId: true,
  })
  .required();

function actorRef(
  userId: string | null,
  agentId: string | null,
  legacyId: string | null,
): Pick<IssueActor, 'type' | 'id'> | null {
  if (agentId !== null) return { type: 'agent', id: agentId };
  const id = userId ?? legacyId;
  return id === null ? null : { type: 'user', id };
}

function issueRefs(row: IssueActorColumns) {
  const creator = actorRef(row.creatorUserId, row.creatorAgentId, row.creatorId);
  if (creator === null) throw new Error('An issue must have a creator actor.');
  return {
    creator,
    assignee: actorRef(row.assigneeUserId, row.assigneeAgentId, row.assigneeId),
    owner: row.ownerUserId === null ? null : { type: 'user' as const, id: row.ownerUserId },
  };
}

export async function attachIssueActors<T extends IssueActorColumns>(
  executor: Executor,
  organizationId: string,
  rows: readonly T[],
): Promise<IssueActorRead<T>[]> {
  if (rows.length === 0) return [];
  if (
    rows.some((row) => row.organizationId !== undefined && row.organizationId !== organizationId)
  ) {
    throw new Error('Issue actors require the issue organization.');
  }
  const references = rows.map(issueRefs);
  const all = references.flatMap(({ creator, assignee, owner }) =>
    [creator, assignee, owner].filter((ref) => ref !== null),
  );
  const userIds = [...new Set(all.filter((ref) => ref.type === 'user').map((ref) => ref.id))];
  const agentIds = [...new Set(all.filter((ref) => ref.type === 'agent').map((ref) => ref.id))];
  const [users, agents] = await Promise.all([
    userIds.length === 0
      ? []
      : executor
          .select({ id: schema.user.id, name: schema.user.name, avatar: schema.user.image })
          .from(schema.user)
          .where(inArray(schema.user.id, userIds)),
    agentIds.length === 0
      ? []
      : executor
          .select({
            id: schema.agentIdentity.id,
            name: schema.agentIdentity.name,
            avatar: schema.agentIdentity.avatar,
            deletedAt: schema.agentIdentity.deletedAt,
          })
          .from(schema.agentIdentity)
          .where(
            and(
              eq(schema.agentIdentity.organizationId, organizationId),
              inArray(schema.agentIdentity.id, agentIds),
            ),
          ),
  ]);
  const actors = new Map<string, IssueActor>();
  for (const user of users)
    actors.set(`user:${user.id}`, { ...user, type: 'user', deleted: false });
  for (const agent of agents) {
    actors.set(`agent:${agent.id}`, {
      type: 'agent',
      id: agent.id,
      name: agent.name,
      avatar: agent.avatar,
      deleted: agent.deletedAt !== null,
    });
  }
  const view = (ref: Pick<IssueActor, 'type' | 'id'>): IssueActor =>
    actors.get(`${ref.type}:${ref.id}`) ?? {
      ...ref,
      name: ref.type === 'agent' ? 'Deleted agent' : 'Deleted user',
      avatar: null,
      deleted: true,
    };
  return rows.map((row) => {
    const refs = issueRefs(row);
    return {
      ...row,
      creator: view(refs.creator),
      assignee: refs.assignee === null ? null : view(refs.assignee),
      owner: refs.owner === null ? null : view(refs.owner),
    };
  });
}

export async function attachIssueActionActors(
  executor: Executor,
  actions: readonly SyncAction[],
): Promise<SyncAction[]> {
  const byOrganization = new Map<
    string,
    { readonly index: number; readonly row: IssueActorColumns }[]
  >();
  for (const [index, action] of actions.entries()) {
    if (action.model !== 'issue' || action.action === 'delete') continue;
    if (action.data['organizationId'] === undefined) continue;
    const parsed = issueEventActorColumnsSchema.safeParse(action.data);
    if (!parsed.success) continue;
    const entries = byOrganization.get(action.organizationId) ?? [];
    entries.push({ index, row: parsed.data });
    byOrganization.set(action.organizationId, entries);
  }
  const actors = new Map<number, IssueActors>();
  await Promise.all(
    [...byOrganization].map(async ([organizationId, entries]) => {
      const rows = await attachIssueActors(
        executor,
        organizationId,
        entries.map((entry) => entry.row),
      );
      for (const [index, row] of rows.entries()) {
        const entry = entries[index];
        if (entry !== undefined) actors.set(entry.index, row);
      }
    }),
  );
  return actions.map((action, index) => {
    const view = actors.get(index);
    return view === undefined
      ? action
      : {
          ...action,
          data: {
            ...action.data,
            creator: view.creator,
            assignee: view.assignee,
            owner: view.owner,
          },
        };
  });
}
