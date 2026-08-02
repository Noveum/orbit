import { experimental_upgradeWebSocket } from '@vercel/functions';
import type { RawData, WebSocket } from 'ws';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ProbeReport {
  readonly bun: string | null;
  readonly node: string | null;
  readonly wsPackage: string;
  readonly upgradeHook: string;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function wsPackageStatus(): Promise<string> {
  try {
    const loaded = await import('ws');
    return typeof loaded.WebSocketServer === 'function' ? 'loaded' : 'missing WebSocketServer';
  } catch (error: unknown) {
    return describe(error);
  }
}

function isUpgrade(request: Request): boolean {
  return (request.headers.get('upgrade') ?? '').toLowerCase() === 'websocket';
}

export async function GET(request: Request): Promise<Response> {
  if (isUpgrade(request)) {
    return await experimental_upgradeWebSocket((socket: WebSocket) => {
      socket.on('message', (data: RawData) => {
        socket.send(data.toString());
      });
    });
  }

  let upgradeHook = 'reached the upgrade without an error';
  try {
    await experimental_upgradeWebSocket(() => undefined);
  } catch (error: unknown) {
    upgradeHook = describe(error);
  }

  const report: ProbeReport = {
    bun: process.versions['bun'] ?? null,
    node: process.versions['node'] ?? null,
    wsPackage: await wsPackageStatus(),
    upgradeHook,
  };

  return Response.json(report);
}
