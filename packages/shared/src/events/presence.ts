import { z } from 'zod';

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

export const PRESENCE_TTL_MS = 45_000;

export function isFresh(at: string, ttlMs: number, now = Date.now()): boolean {
  const stamped = Date.parse(at);
  return Number.isFinite(stamped) && now - stamped < ttlMs;
}
