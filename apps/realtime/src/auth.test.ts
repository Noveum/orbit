import { describe, expect, it } from 'bun:test';
import {
  REALTIME_TICKET_TTL_MS,
  type RealtimeTicketPayload,
  signRealtimeTicket,
} from '@orbit/shared/events/ticket';
import { readTicketFrame } from './auth.ts';

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

function frame(ticket: string): string {
  return JSON.stringify({ type: 'auth', ticket });
}

describe('readTicketFrame', () => {
  it('returns the payload of a valid first frame', () => {
    const raw = frame(signRealtimeTicket(payload(), SECRET));
    expect(readTicketFrame(raw, SECRET, NOW)).toEqual(payload());
  });

  it('rejects a frame that is not valid json', () => {
    expect(readTicketFrame('not json', SECRET, NOW)).toBeNull();
  });

  it('rejects a frame that is not an auth message', () => {
    expect(readTicketFrame(JSON.stringify({ type: 'ping' }), SECRET, NOW)).toBeNull();
    expect(readTicketFrame(JSON.stringify({ type: 'auth' }), SECRET, NOW)).toBeNull();
  });

  it('rejects a forged ticket', () => {
    expect(readTicketFrame(frame('forged.ticket'), SECRET, NOW)).toBeNull();
  });

  it('rejects a ticket signed with the wrong secret', () => {
    const raw = frame(signRealtimeTicket(payload(), 'a-different-secret-value'));
    expect(readTicketFrame(raw, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired ticket', () => {
    const raw = frame(signRealtimeTicket(payload({ exp: NOW - 1 }), SECRET));
    expect(readTicketFrame(raw, SECRET, NOW)).toBeNull();
  });
});
