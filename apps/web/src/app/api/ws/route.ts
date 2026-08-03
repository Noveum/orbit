import { fromNodeSocket, type RealtimeSession } from '@orbit/realtime-server';
import { experimental_upgradeWebSocket } from '@vercel/functions';
import type { RawData, WebSocket } from 'ws';
import { realtimeHub } from '@/lib/realtime/hub.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HUB_UNAVAILABLE_CLOSE_CODE = 1011;
const TOO_MUCH_BEFORE_READY_CLOSE_CODE = 1008;
const MAX_BUFFERED_FRAMES = 32;

function attach(socket: WebSocket): void {
  const buffered: string[] = [];
  let session: RealtimeSession | null = null;
  let closed = false;

  socket.on('message', (data: RawData) => {
    const raw = data.toString();
    if (session !== null) {
      session.message(raw);
      return;
    }
    if (buffered.length >= MAX_BUFFERED_FRAMES) {
      socket.close(TOO_MUCH_BEFORE_READY_CLOSE_CODE, 'too_many_frames_before_ready');
      return;
    }
    buffered.push(raw);
  });
  socket.on('pong', () => {
    session?.pong();
  });
  socket.on('close', () => {
    closed = true;
    buffered.length = 0;
    session?.closed();
  });

  realtimeHub()
    .then((hub) => {
      if (closed) return;
      const accepted = hub.accept(fromNodeSocket(socket));
      session = accepted;
      for (const raw of buffered) accepted.message(raw);
      buffered.length = 0;
    })
    .catch(() => {
      socket.close(HUB_UNAVAILABLE_CLOSE_CODE, 'realtime_unavailable');
    });
}

export async function GET(): Promise<Response> {
  return await experimental_upgradeWebSocket(attach);
}
