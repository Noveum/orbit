import { z } from 'zod';
import { presenceKindSchema, presenceMessageSchema } from './presence.ts';
import { syncActionSchema } from './sync.ts';

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
