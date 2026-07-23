import { z } from 'zod';
import { ACTOR_TYPES } from '../constants/index.ts';

export const SYNC_MODELS = [
  'organization',
  'issue',
  'issue_relation',
  'comment',
  'reaction',
  'attachment',
  'project',
  'milestone',
  'cycle',
  'team',
  'workflow_state',
  'label',
  'doc',
  'notification',
  'member',
  'view',
] as const;

export type SyncModel = (typeof SYNC_MODELS)[number];

export const SYNC_ACTIONS = ['insert', 'update', 'delete', 'archive', 'unarchive'] as const;
export type SyncActionKind = (typeof SYNC_ACTIONS)[number];

export const actorSchema = z.object({
  type: z.enum(ACTOR_TYPES),
  id: z.string().min(1),
  name: z.string().min(1).optional(),
});

export type Actor = z.infer<typeof actorSchema>;

export const ORIGIN_CLIENT_ID_HEADER = 'x-orbit-client-id';

export const originClientIdSchema = z.string().min(1).max(64);

export const syncActionSchema = z.object({
  syncId: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  action: z.enum(SYNC_ACTIONS),
  model: z.enum(SYNC_MODELS),
  modelId: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  actor: actorSchema,
  at: z.string().datetime(),
  originClientId: originClientIdSchema.optional(),
});

export type SyncAction = z.infer<typeof syncActionSchema>;

export const presenceKindSchema = z.enum(['viewing', 'typing', 'idle']);
export type PresenceKind = z.infer<typeof presenceKindSchema>;

export const presenceMessageSchema = z.object({
  organizationId: z.string().min(1),
  scope: z.string().min(1),
  kind: presenceKindSchema,
  userId: z.string().min(1),
  name: z.string().min(1),
  image: z.string().nullable(),
  at: z.string().datetime(),
});

export type PresenceMessage = z.infer<typeof presenceMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), scopes: z.array(z.string().min(1)).max(64) }),
  z.object({ type: z.literal('unsubscribe'), scopes: z.array(z.string().min(1)).max(64) }),
  z.object({ type: z.literal('ping') }),
  z.object({
    type: z.literal('presence'),
    scope: z.string().min(1),
    kind: presenceKindSchema,
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    connectionId: z.string().min(1),
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    scopes: z.array(z.string()),
  }),
  z.object({ type: z.literal('delta'), actions: z.array(syncActionSchema).min(1) }),
  z.object({ type: z.literal('presence'), messages: z.array(presenceMessageSchema).min(1) }),
  z.object({ type: z.literal('pong'), at: z.string().datetime() }),
  z.object({ type: z.literal('subscribed'), scopes: z.array(z.string()) }),
  z.object({ type: z.literal('error'), message: z.string(), code: z.string() }),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const scopes = {
  organization: (organizationId: string): string => `org:${organizationId}`,
  team: (teamId: string): string => `team:${teamId}`,
  project: (projectId: string): string => `project:${projectId}`,
  issue: (issueId: string): string => `issue:${issueId}`,
  doc: (docId: string): string => `doc:${docId}`,
  user: (userId: string): string => `user:${userId}`,
} as const;

export const UNAUTHORIZED_CLOSE_CODE = 4001;
export const ORGANIZATION_FORBIDDEN_CLOSE_CODE = 4003;

export const connectionOrganizationIdSchema = z.string().min(1).max(128);

export const REDIS_DELTA_CHANNEL = 'orbit:delta';
export const REDIS_PRESENCE_CHANNEL = 'orbit:presence';

export const DELTA_BATCH_WINDOW_MS = 50;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 75_000;
