import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const REALTIME_TICKET_TTL_MS = 60_000;

const identifier = z.string().min(1).max(128);

export const realtimeTicketPayloadSchema = z.object({
  userId: identifier,
  organizationId: identifier,
  sessionId: identifier,
  exp: z.number().int().positive(),
});

export type RealtimeTicketPayload = z.infer<typeof realtimeTicketPayloadSchema>;

export const realtimeTicketRequestSchema = z.object({
  organizationId: identifier.optional(),
});

export type RealtimeTicketRequest = z.infer<typeof realtimeTicketRequestSchema>;

function digest(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

export function signRealtimeTicket(payload: RealtimeTicketPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${digest(body, secret).toString('base64url')}`;
}

export function verifyRealtimeTicket(
  ticket: string,
  secret: string,
  now: number = Date.now(),
): RealtimeTicketPayload | null {
  const separator = ticket.indexOf('.');
  if (separator <= 0 || separator === ticket.length - 1) return null;
  const body = ticket.slice(0, separator);
  const provided = Buffer.from(ticket.slice(separator + 1), 'base64url');
  const expected = digest(body, secret);
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const result = realtimeTicketPayloadSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.exp <= now) return null;
  return result.data;
}
