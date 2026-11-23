import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Socket } from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { Server as ProxyServer } from 'proxy-chain';
import { fetch } from '../fetch';

describe('fetch timeouts with real sockets', () => {
  let server: http.Server;
  let url: string;
  const clientSockets = new Set<Socket>();
  const originalAgent = http.globalAgent;

  beforeEach(async () => {
    http.globalAgent = new http.Agent({ keepAlive: true });
    vi.stubEnv('HTTP_PROXY', '');
    vi.stubEnv('HTTPS_PROXY', '');
    vi.stubEnv('http_proxy', '');
    vi.stubEnv('https_proxy', '');
    vi.stubEnv('NO_PROXY', '');
    vi.stubEnv('no_proxy', '');
    server = http.createServer((_req, res) => {
      const timer = setTimeout(() => res.end('ok'), 150);
      res.on('close', () => clearTimeout(timer));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${(server.address() as any).port}`;

    // Exercise real inactivity timers without waiting 30/300 seconds per case.
    const socketSetTimeout = Socket.prototype.setTimeout;
    vi.spyOn(Socket.prototype, 'setTimeout').mockImplementation(function (
      this: Socket,
      timeout,
      callback
    ) {
      clientSockets.add(this);
      return socketSetTimeout.call(
        this,
        timeout === 30_000 ? 50 : timeout === 300_000 ? 500 : timeout,
        callback
      );
    });
  });

  afterEach(async () => {
    http.globalAgent.destroy();
    http.globalAgent = originalAgent;
    for (const socket of clientSockets) socket.destroy();
    clientSockets.clear();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([false, true])(
    'allows slow headers, signal=%s, on fresh and reused connections',
    async signal => {
      const sockets: Socket[] = [];
      server.on('request', req => sockets.push(req.socket));
      for (let i = 0; i < 2; i++) {
        const response = await fetch(url, {
          signal: signal ? new AbortController().signal : undefined,
        });
        expect(await response.text()).toBe('ok');
      }
      expect(sockets[0]).toBe(sockets[1]);
    }
  );

  it('still times out a connected server that never responds', async () => {
    server.removeAllListeners('request');
    server.on('request', () => {});
    await expect(fetch(url)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  });

  it('preserves explicit timeout overrides', async () => {
    await expect(fetch(url, { connectTimeout: 50 })).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
    expect(await (await fetch(url, { connectTimeout: 0 })).text()).toBe('ok');
  });

  it('honors abort signals while waiting for headers', async () => {
    await expect(
      fetch(url, { signal: AbortSignal.timeout(50) })
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('disables the timeout when headers arrive', async () => {
    server.removeAllListeners('request');
    server.on('request', (_req, res) => {
      res.writeHead(200);
      res.flushHeaders();
      const timer = setTimeout(() => res.end('ok'), 150);
      res.on('close', () => clearTimeout(timer));
    });
    const response = await fetch(url, { connectTimeout: 50 });
    expect(await response.text()).toBe('ok');
  });

  it('allows slow headers through an HTTP proxy', async () => {
    const proxy = new ProxyServer({ port: 0 });
    await new Promise<void>(resolve => proxy.listen(() => resolve()));
    vi.stubEnv('HTTP_PROXY', `http://127.0.0.1:${proxy.port}`);
    try {
      expect(await (await fetch(url)).text()).toBe('ok');
    } finally {
      await new Promise<void>(resolve => proxy.close(true, () => resolve()));
    }
  });
});
