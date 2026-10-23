import type { IssueActor } from '@orbit/shared/validators';
import type { Issue, Member } from './schemas.ts';

export type IssueActorRole = 'creator' | 'assignee' | 'owner';

export function humanIssueActor(id: string, member?: Member): IssueActor {
  return {
    type: 'user',
    id,
    name: member?.id === id ? member.name : 'Unknown user',
    avatar: member?.id === id ? member.image : null,
    deleted: false,
  };
}

export function resolveIssueActor(
  issue: Issue,
  role: IssueActorRole,
  member?: Member,
): IssueActor | null {
  const actor = issue[role];
  if (actor !== undefined) return actor;
  const agentId = { creator: issue.creatorAgentId, assignee: issue.assigneeAgentId, owner: null }[
    role
  ];
  if (agentId !== undefined && agentId !== null) {
    return { type: 'agent', id: agentId, name: 'Unknown agent', avatar: null, deleted: false };
  }
  const userId = {
    creator: issue.creatorUserId === undefined ? issue.creatorId : issue.creatorUserId,
    assignee: issue.assigneeUserId === undefined ? issue.assigneeId : issue.assigneeUserId,
    owner: issue.ownerUserId,
  }[role];
  return userId === undefined || userId === null ? null : humanIssueActor(userId, member);
}
