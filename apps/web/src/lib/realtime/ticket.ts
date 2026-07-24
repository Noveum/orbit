import { z } from 'zod';

const ticketResponseSchema = z.object({ ticket: z.string().min(1) });

export async function fetchRealtimeTicket(organizationId: string): Promise<string> {
  const response = await fetch('/api/realtime/ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationId }),
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Could not mint a realtime ticket.');
  return ticketResponseSchema.parse(await response.json()).ticket;
}
