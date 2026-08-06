import { describe, expect, it } from 'bun:test';
import {
  REALTIME_TICKET_TTL_MS,
  type RealtimeTicketPayload,
  signRealtimeTicket,
  verifyRealtimeTicket,
} from '../../src/events/ticket.ts';

const SECRET = 'secret-value-that-is-long-enough';
const NOW = 1_800_000_000_000;

function payload(overrides: Partial<RealtimeTicketPayload> = {}): RealtimeTicketPayload {
  return {
    userId: 'user_1',
    organizationId: 'org_1',
    sessionId: 'session_1',
    exp: NOW + REALTIME_TICKET_TTL_MS,
    ...overrides,
  };
}

describe('realtime ticket', () => {
  it('round trips a signed payload', () => {
    const ticket = signRealtimeTicket(payload(), SECRET);
    expect(verifyRealtimeTicket(ticket, SECRET, NOW)).toEqual(payload());
  });

  it('rejects a ticket signed with a different secret', () => {
    const ticket = signRealtimeTicket(payload(), SECRET);
    expect(verifyRealtimeTicket(ticket, 'another-secret-entirely', NOW)).toBeNull();
  });

  it('rejects a ticket whose payload was tampered with after signing', () => {
    const ticket = signRealtimeTicket(payload(), SECRET);
    const forgedBody = Buffer.from(
      JSON.stringify(payload({ organizationId: 'org_evil' })),
    ).toString('base64url');
    const tampered = `${forgedBody}.${ticket.slice(ticket.indexOf('.') + 1)}`;
    expect(verifyRealtimeTicket(tampered, SECRET, NOW)).toBeNull();
  });

  it('rejects a ticket whose signature was tampered with', () => {
    const ticket = signRealtimeTicket(payload(), SECRET);
    const flipped = `${ticket.slice(0, -1)}${ticket.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyRealtimeTicket(flipped, SECRET, NOW)).toBeNull();
  });

  it('rejects a ticket that has expired', () => {
    const ticket = signRealtimeTicket(payload({ exp: NOW - 1 }), SECRET);
    expect(verifyRealtimeTicket(ticket, SECRET, NOW)).toBeNull();
  });

  it('accepts a ticket right up to its expiry boundary', () => {
    const ticket = signRealtimeTicket(payload({ exp: NOW + 1 }), SECRET);
    expect(verifyRealtimeTicket(ticket, SECRET, NOW)).not.toBeNull();
    expect(verifyRealtimeTicket(ticket, SECRET, NOW + 1)).toBeNull();
  });

  it('rejects a structurally broken ticket', () => {
    expect(verifyRealtimeTicket('', SECRET, NOW)).toBeNull();
    expect(verifyRealtimeTicket('nodot', SECRET, NOW)).toBeNull();
    expect(verifyRealtimeTicket('.onlysignature', SECRET, NOW)).toBeNull();
    expect(verifyRealtimeTicket('onlybody.', SECRET, NOW)).toBeNull();
  });

  it('rejects a ticket whose body is valid base64 but not a valid payload', () => {
    const body = Buffer.from(JSON.stringify({ userId: 'user_1' })).toString('base64url');
    const secret = SECRET;
    const forged = signRealtimeTicket(payload(), secret);
    const signature = forged.slice(forged.indexOf('.') + 1);
    expect(verifyRealtimeTicket(`${body}.${signature}`, secret, NOW)).toBeNull();
  });
});
