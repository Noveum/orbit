import { fromNodeSocket } from '@orbit/realtime-server';
import { experimental_upgradeWebSocket } from '@vercel/functions';
import type { RawData, WebSocket } from 'ws';
import { realtimeHub } from '@/lib/realtime/hub.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(): Promise<Response> {
  const hub = await realtimeHub();

  return await experimental_upgradeWebSocket((socket: WebSocket) => {
    const session = hub.accept(fromNodeSocket(socket));
    socket.on('message', (data: RawData) => {
      session.message(data.toString());
    });
    socket.on('pong', () => {
      session.pong();
    });
    socket.on('close', () => {
      session.closed();
    });
  });
}
