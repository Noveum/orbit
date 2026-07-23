import { z } from 'zod';
import { actorSchema } from './actor.ts';

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
  'git_link',
] as const;

export type SyncModel = (typeof SYNC_MODELS)[number];

export const SYNC_ACTIONS = ['insert', 'update', 'delete', 'archive', 'unarchive'] as const;
export type SyncActionKind = (typeof SYNC_ACTIONS)[number];

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
