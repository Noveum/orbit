import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fromNodeSocket, type RealtimeHub } from '@orbit/realtime-server';
import { WebSocketServer } from 'ws';

interface NodeRealtimeOptions {
  readonly origin: string;
  readonly port?: number;
  readonly host?: string;
}

export async function createNodeRealtimeServer(hub: RealtimeHub, options: NodeRealtimeOptions) {
  const originUrl = new URL(options.origin);
  if (!['http:', 'https:'].includes(originUrl.protocol)) {
    throw new Error('The realtime origin must use HTTP or HTTPS.');
  }
  const allowedOrigin = originUrl.origin;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65_536 });
  const server = createServer((request, response) => {
    const ready = hub.stats().redis === 'ready';
    const health = request.method === 'GET' && request.url === '/health';
    const healthCode = ready ? 200 : 503;
    const healthStatus = ready ? 'ok' : 'unavailable';
    response.writeHead(health ? healthCode : 404, {
      'content-type': 'application/json',
    });
    response.end(JSON.stringify({ status: health ? healthStatus : 'not_found' }));
  });

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => socket.destroy());
    if (request.method !== 'GET' || request.url !== '/api/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    if (request.headers.origin !== allowedOrigin) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    if (hub.stats().redis !== 'ready') {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (connection) => {
      const session = hub.accept(fromNodeSocket(connection));
      connection.on('message', (data, binary) => {
        if (binary) connection.close(1003, 'text_frames_required');
        else session.message(data.toString());
      });
      connection.on('pong', () => session.pong());
      connection.on('close', () => session.closed());
      connection.on('error', () => connection.terminate());
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    sockets.close();
    await hub.close();
    throw error;
  }

  return {
    port: (server.address() as AddressInfo).port,
    async close(): Promise<void> {
      for (const socket of sockets.clients) socket.terminate();
      await Promise.all([
        hub.close(),
        new Promise<void>((resolve) => sockets.close(() => resolve())),
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
          server.closeAllConnections();
        }),
      ]);
    },
  };
}
