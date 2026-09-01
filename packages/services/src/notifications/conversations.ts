import { isStatusChangeNotification, PULL_REQUEST_NOTIFICATION_TYPES } from '@orbit/shared';

export type NotificationConversationCategory = 'activity' | 'status';

export interface NotificationConversationIdentity {
  readonly conversationKey: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly category: NotificationConversationCategory;
}

export interface NotificationConversationSource {
  readonly subjectType: string;
  readonly subjectKey: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface GithubPullRequestConversationSubject {
  readonly id: string;
  readonly repositoryId: string | number;
  readonly number: number;
}

export interface NotificationConversationInput {
  readonly notificationId: string;
  readonly type: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly url?: string;
  readonly source?: NotificationConversationSource;
  readonly githubPullRequest?: GithubPullRequestConversationSubject;
  readonly issueId?: string;
  readonly documentId?: string;
  readonly projectId?: string;
  readonly domainConversationKey?: string;
}

export interface ConversationLatestEventInput {
  readonly id: string;
  readonly type: string;
  readonly actorName: string;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly externalUrl: string | null;
  readonly occurredAt: Date;
  readonly ingestedAt: Date;
  readonly ingestionSeq: number;
  readonly surfaceInInbox: boolean;
}

export interface NotificationConversationAggregate extends NotificationConversationIdentity {
  readonly latestEventId: string | null;
  readonly latestType: string | null;
  readonly latestActorName: string | null;
  readonly latestTitle: string | null;
  readonly latestBody: string | null;
  readonly latestUrl: string | null;
  readonly latestExternalUrl: string | null;
  readonly latestOccurredAt: Date | null;
  readonly eventCount: number;
  readonly unreadEventCount: number;
  readonly unreadMentionCount: number;
  readonly manualUnread: boolean;
  readonly lastMentionAt: Date | null;
  readonly readAt: Date | null;
  readonly snoozedUntil: Date | null;
  readonly dismissedAt: Date | null;
  readonly accessHiddenAt: Date | null;
  readonly snoozeGeneration: number;
  readonly accessGeneration: number;
  readonly lastActivitySeq: number;
  readonly lastActivityAt: Date | null;
}

export interface ConversationCounterValues {
  readonly unreadCount: number;
  readonly unreadActivityCount: number;
  readonly unreadMentionCount: number;
}

export type ConversationIdentity = NotificationConversationIdentity;
export type ConversationAggregate = NotificationConversationAggregate;
export type ConversationLiveEvent = ConversationLatestEventInput;
export type ConversationCounter = ConversationCounterValues;

const pullRequestNotificationTypes = new Set<string>(PULL_REQUEST_NOTIFICATION_TYPES);
const githubPullRequestKeyPattern = /^github-pr:([^:\s]+):([1-9]\d*)$/;
const issueKeyPattern = /^orbit-issue:([^:\s]+):(activity|status)$/;
const documentKeyPattern = /^orbit-doc:([^:\s]+):activity$/;
const projectKeyPattern = /^orbit-project:([^:\s]+):activity$/;
const stableDomainKeyPattern = /^[a-z][a-z0-9_-]*:[^\s:]+(?::[^\s:]+)*$/;

function conversationSegment(value: string | number, name: string): string {
  const segment = String(value).trim();
  if (segment.length === 0 || segment.includes(':') || /\s/.test(segment)) {
    throw new TypeError(`${name} is not a stable conversation key segment.`);
  }
  return segment;
}

function optionalConversationSegment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return conversationSegment(value, 'Subject id');
  } catch {
    return null;
  }
}

export function githubPullRequestConversationKey(
  repositoryId: string | number,
  number: number,
): string {
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError('Pull request number must be a positive safe integer.');
  }
  return `github-pr:${conversationSegment(repositoryId, 'Repository id')}:${number}`;
}

export function issueConversationKey(
  issueId: string,
  category: NotificationConversationCategory,
): string {
  return `orbit-issue:${conversationSegment(issueId, 'Issue id')}:${category}`;
}

export function documentConversationKey(documentId: string): string {
  return `orbit-doc:${conversationSegment(documentId, 'Document id')}:activity`;
}

export function projectConversationKey(projectId: string): string {
  return `orbit-project:${conversationSegment(projectId, 'Project id')}:activity`;
}

export function legacyNotificationConversationKey(notificationId: string): string {
  return `legacy-notification:${conversationSegment(notificationId, 'Notification id')}`;
}

function categoryFor(type: string): NotificationConversationCategory {
  return isStatusChangeNotification(type) ? 'status' : 'activity';
}

function fallbackIdentity(input: NotificationConversationInput): NotificationConversationIdentity {
  return {
    conversationKey: legacyNotificationConversationKey(input.notificationId),
    subjectType: 'legacy_notification',
    subjectId: conversationSegment(input.notificationId, 'Notification id'),
    category: categoryFor(input.type),
  };
}

function sourceGithubIdentity(
  input: NotificationConversationInput,
): NotificationConversationIdentity | null {
  const source = input.source;
  if (source?.subjectType !== 'github_pull_request') return null;
  const match = githubPullRequestKeyPattern.exec(source.subjectKey);
  if (match === null) return null;
  const repositoryId = match[1];
  const numberValue = match[2];
  if (repositoryId === undefined || numberValue === undefined) return null;
  const number = Number(numberValue);
  if (!Number.isSafeInteger(number)) return null;
  const hint = input.githubPullRequest;
  if (
    hint !== undefined &&
    (String(hint.repositoryId) !== repositoryId || hint.number !== number)
  ) {
    return null;
  }
  const payloadId = optionalConversationSegment(source.payload?.['pullRequestId']);
  const entityId =
    input.entityType === 'github_pull_request' ? optionalConversationSegment(input.entityId) : null;
  const subjectId = optionalConversationSegment(hint?.id) ?? payloadId ?? entityId;
  if (subjectId === null) return null;
  return {
    conversationKey: githubPullRequestConversationKey(repositoryId, number),
    subjectType: 'github_pull_request',
    subjectId,
    category: 'activity',
  };
}

function hintedGithubIdentity(
  input: NotificationConversationInput,
): NotificationConversationIdentity | null {
  const pullRequest = input.githubPullRequest;
  if (pullRequest === undefined) return null;
  try {
    return {
      conversationKey: githubPullRequestConversationKey(
        pullRequest.repositoryId,
        pullRequest.number,
      ),
      subjectType: 'github_pull_request',
      subjectId: conversationSegment(pullRequest.id, 'Pull request id'),
      category: 'activity',
    };
  } catch {
    return null;
  }
}

function sourceIssueIdentity(
  input: NotificationConversationInput,
): NotificationConversationIdentity | null {
  if (input.source?.subjectType !== 'issue') return null;
  const match = issueKeyPattern.exec(input.source.subjectKey);
  const issueId = match?.[1];
  if (issueId === undefined) return null;
  const category = categoryFor(input.type);
  return {
    conversationKey: issueConversationKey(issueId, category),
    subjectType: 'issue',
    subjectId: issueId,
    category,
  };
}

function sourceDocumentIdentity(
  input: NotificationConversationInput,
): NotificationConversationIdentity | null {
  if (input.source?.subjectType !== 'doc') return null;
  const match = documentKeyPattern.exec(input.source.subjectKey);
  const documentId = match?.[1];
  if (documentId === undefined) return null;
  return {
    conversationKey: documentConversationKey(documentId),
    subjectType: 'doc',
    subjectId: documentId,
    category: 'activity',
  };
}

function sourceProjectIdentity(
  input: NotificationConversationInput,
): NotificationConversationIdentity | null {
  if (input.source?.subjectType !== 'project') return null;
  const match = projectKeyPattern.exec(input.source.subjectKey);
  const projectId = match?.[1];
  if (projectId === undefined) return null;
  return {
    conversationKey: projectConversationKey(projectId),
    subjectType: 'project',
    subjectId: projectId,
    category: 'activity',
  };
}

function documentIdFromUrl(url: string | undefined): string | null {
  if (url === undefined) return null;
  const match = /^\/docs\/([^/?#]+)(?:[?#]|$)/.exec(url);
  const encoded = match?.[1];
  if (encoded === undefined) return null;
  try {
    return optionalConversationSegment(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

function issueIdentity(
  input: NotificationConversationInput,
): NotificationConversationIdentity | null {
  const directIssueId =
    input.entityType === 'issue' || input.entityType === 'task' ? input.entityId : input.issueId;
  const issueId = optionalConversationSegment(directIssueId);
  if (issueId === null) return null;
  const category = categoryFor(input.type);
  return {
    conversationKey: issueConversationKey(issueId, category),
    subjectType: 'issue',
    subjectId: issueId,
    category,
  };
}

function documentIdentity(
  input: NotificationConversationInput,
): NotificationConversationIdentity | null {
  const directDocumentId = input.entityType === 'doc' ? input.entityId : input.documentId;
  const documentId =
    optionalConversationSegment(directDocumentId) ??
    (input.entityType === 'doc_comment' ? documentIdFromUrl(input.url) : null);
  if (documentId === null) return null;
  return {
    conversationKey: documentConversationKey(documentId),
    subjectType: 'doc',
    subjectId: documentId,
    category: 'activity',
  };
}

function projectIdentity(
  input: NotificationConversationInput,
): NotificationConversationIdentity | null {
  const directProjectId = input.entityType === 'project' ? input.entityId : input.projectId;
  const projectId = optionalConversationSegment(directProjectId);
  if (projectId === null) return null;
  return {
    conversationKey: projectConversationKey(projectId),
    subjectType: 'project',
    subjectId: projectId,
    category: 'activity',
  };
}

function stableDomainIdentity(
  input: NotificationConversationInput,
): NotificationConversationIdentity | null {
  const sourceSubjectType = input.source?.subjectType;
  let subjectType: 'invitation' | 'membership' | null = null;
  if (sourceSubjectType === 'invitation' || sourceSubjectType === 'membership') {
    subjectType = sourceSubjectType;
  } else if (input.entityType === 'invitation' || input.type === 'invite_accepted') {
    subjectType = 'invitation';
  } else if (input.entityType === 'membership' || input.type === 'member_joined') {
    subjectType = 'membership';
  }
  if (subjectType === null) return null;
  const conversationKey = input.domainConversationKey ?? input.source?.subjectKey;
  if (conversationKey === undefined || !stableDomainKeyPattern.test(conversationKey)) return null;
  if (!conversationKey.startsWith(`orbit-${subjectType}:`)) return null;
  const subjectId = optionalConversationSegment(input.entityId);
  if (subjectId === null) return null;
  return { conversationKey, subjectType, subjectId, category: 'activity' };
}

export function resolveNotificationConversation(
  input: NotificationConversationInput,
): NotificationConversationIdentity {
  const sourceGithub = sourceGithubIdentity(input);
  const hintedGithub = hintedGithubIdentity(input);
  if (pullRequestNotificationTypes.has(input.type)) {
    return sourceGithub ?? hintedGithub ?? fallbackIdentity(input);
  }
  return (
    sourceGithub ??
    hintedGithub ??
    sourceIssueIdentity(input) ??
    sourceDocumentIdentity(input) ??
    sourceProjectIdentity(input) ??
    issueIdentity(input) ??
    documentIdentity(input) ??
    projectIdentity(input) ??
    stableDomainIdentity(input) ??
    fallbackIdentity(input)
  );
}

export function createConversationAggregate(
  identity: NotificationConversationIdentity,
): NotificationConversationAggregate {
  return {
    ...identity,
    latestEventId: null,
    latestType: null,
    latestActorName: null,
    latestTitle: null,
    latestBody: null,
    latestUrl: null,
    latestExternalUrl: null,
    latestOccurredAt: null,
    eventCount: 0,
    unreadEventCount: 0,
    unreadMentionCount: 0,
    manualUnread: false,
    lastMentionAt: null,
    readAt: null,
    snoozedUntil: null,
    dismissedAt: null,
    accessHiddenAt: null,
    snoozeGeneration: 0,
    accessGeneration: 0,
    lastActivitySeq: 0,
    lastActivityAt: null,
  };
}

function eventIsMention(event: ConversationLatestEventInput): boolean {
  return event.type === 'mention';
}

export function applyLiveConversationEvent(
  aggregate: NotificationConversationAggregate,
  event: ConversationLatestEventInput,
): NotificationConversationAggregate {
  if (!event.surfaceInInbox) return aggregate;
  if (event.ingestionSeq <= aggregate.lastActivitySeq) {
    return { ...aggregate, eventCount: aggregate.eventCount + 1 };
  }
  const mention = eventIsMention(event);
  return {
    ...aggregate,
    latestEventId: event.id,
    latestType: event.type,
    latestActorName: event.actorName,
    latestTitle: event.title,
    latestBody: event.body,
    latestUrl: event.url,
    latestExternalUrl: event.externalUrl,
    latestOccurredAt: event.occurredAt,
    eventCount: aggregate.eventCount + 1,
    unreadEventCount: aggregate.unreadEventCount + 1,
    unreadMentionCount: aggregate.unreadMentionCount + (mention ? 1 : 0),
    manualUnread: false,
    lastMentionAt: mention ? event.ingestedAt : aggregate.lastMentionAt,
    snoozedUntil: null,
    dismissedAt: null,
    snoozeGeneration: aggregate.snoozeGeneration + 1,
    lastActivitySeq: event.ingestionSeq,
    lastActivityAt: event.ingestedAt,
  };
}

export function applyConversationRead(
  aggregate: NotificationConversationAggregate,
  read: boolean,
  at: Date,
): NotificationConversationAggregate {
  if (!read) {
    return {
      ...aggregate,
      manualUnread: aggregate.unreadEventCount === 0,
    };
  }
  return {
    ...aggregate,
    unreadEventCount: 0,
    unreadMentionCount: 0,
    manualUnread: false,
    readAt: at,
  };
}

export function applyConversationSnooze(
  aggregate: NotificationConversationAggregate,
  snoozedUntil: Date | null,
): NotificationConversationAggregate {
  return {
    ...aggregate,
    snoozedUntil,
    snoozeGeneration: aggregate.snoozeGeneration + 1,
  };
}

export function applyConversationDismissal(
  aggregate: NotificationConversationAggregate,
  dismissedAt: Date | null,
): NotificationConversationAggregate {
  return {
    ...aggregate,
    dismissedAt,
    snoozeGeneration: aggregate.snoozeGeneration + 1,
  };
}

function equalDates(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

export function applyConversationAccess(
  aggregate: NotificationConversationAggregate,
  accessHiddenAt: Date | null,
): NotificationConversationAggregate {
  if (equalDates(aggregate.accessHiddenAt, accessHiddenAt)) return aggregate;
  return {
    ...aggregate,
    accessHiddenAt,
    accessGeneration: aggregate.accessGeneration + 1,
  };
}

function conversationIsVisible(aggregate: NotificationConversationAggregate, at: Date): boolean {
  if (aggregate.dismissedAt !== null || aggregate.accessHiddenAt !== null) return false;
  return aggregate.snoozedUntil === null || aggregate.snoozedUntil.getTime() <= at.getTime();
}

export function conversationCounterContribution(
  aggregate: NotificationConversationAggregate,
  at: Date,
): ConversationCounterValues {
  const unread = aggregate.unreadEventCount > 0 || aggregate.manualUnread;
  if (!(unread && conversationIsVisible(aggregate, at))) {
    return { unreadCount: 0, unreadActivityCount: 0, unreadMentionCount: 0 };
  }
  return {
    unreadCount: 1,
    unreadActivityCount: aggregate.category === 'activity' ? 1 : 0,
    unreadMentionCount: aggregate.unreadMentionCount > 0 ? 1 : 0,
  };
}

export function conversationCounterDelta(
  before: NotificationConversationAggregate,
  after: NotificationConversationAggregate,
  at: Date,
): ConversationCounterValues {
  const previous = conversationCounterContribution(before, at);
  const next = conversationCounterContribution(after, at);
  return {
    unreadCount: next.unreadCount - previous.unreadCount,
    unreadActivityCount: next.unreadActivityCount - previous.unreadActivityCount,
    unreadMentionCount: next.unreadMentionCount - previous.unreadMentionCount,
  };
}

export function applyConversationCounterDelta(
  current: ConversationCounterValues,
  delta: ConversationCounterValues,
): ConversationCounterValues {
  const next = {
    unreadCount: current.unreadCount + delta.unreadCount,
    unreadActivityCount: current.unreadActivityCount + delta.unreadActivityCount,
    unreadMentionCount: current.unreadMentionCount + delta.unreadMentionCount,
  };
  if (next.unreadCount < 0 || next.unreadActivityCount < 0 || next.unreadMentionCount < 0) {
    throw new RangeError('Conversation counters cannot become negative.');
  }
  return next;
}
