import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';
import { TLSSocket } from 'node:tls';
import * as http from 'node:http';
import * as https from 'node:https';
import { fetch } from '../fetch';

vi.mock('node:http', async importOriginal => ({
  ...(await importOriginal<typeof http>()),
  request: vi.fn(),
}));
vi.mock('node:https', async importOriginal => ({
  ...(await importOriginal<typeof https>()),
  request: vi.fn(),
}));
vi.mock('../agent', () => ({
  getHttpAgent: () => undefined,
  getHttpsAgent: () => undefined,
}));

describe('fetch timeout phases', () => {
  let request: EventEmitter & {
    destroyed: boolean;
    reusedSocket: boolean;
    setTimeout: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  let socket: Socket;

  beforeEach(() => {
    socket = new Socket();
    Object.defineProperty(socket, 'connecting', { value: true });
    request = Object.assign(new EventEmitter(), {
      destroyed: false,
      reusedSocket: false,
      setTimeout: vi.fn(),
      hasHeader: () => false,
      setHeader: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn((error: Error) => {
        if (request.destroyed) return;
        request.destroyed = true;
        request.emit('error', error);
        request.emit('close');
      }),
    });
    vi.mocked(http.request).mockReturnValue(request as any);
    vi.mocked(https.request).mockReturnValue(request as any);
  });

  afterEach(() => {
    request.emit('close');
    socket.destroy();
    vi.restoreAllMocks();
  });

  it.each([false, true])('extends connected requests, signal=%s', signal => {
    void fetch('http://example.test', {
      signal: signal ? new AbortController().signal : undefined,
    });
    request.emit('socket', socket);
    expect(request.setTimeout).not.toHaveBeenCalled();
    socket.emit('connect');
    expect(request.setTimeout).toHaveBeenCalledWith(300_000);
    expect(request.destroy).not.toHaveBeenCalled();
  });

  it('retains the initial socket timeout until TLS finishes', async () => {
    socket.destroy();
    socket = new TLSSocket(new Socket());
    const result = expect(fetch('https://example.test')).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
    request.emit('socket', socket);
    socket.emit('connect');
    expect(request.setTimeout).not.toHaveBeenCalled();
    expect(https.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeout: 30_000 })
    );
    request.emit('timeout');
    await result;
  });

  it('extends the timeout after the TLS handshake', () => {
    socket.destroy();
    socket = new TLSSocket(new Socket());
    void fetch('https://example.test');
    request.emit('socket', socket);
    socket.emit('secureConnect');
    expect(request.setTimeout).toHaveBeenCalledWith(300_000);
  });

  it.each(['http:', 'https:'])(
    'extends reused %s sockets immediately',
    protocol => {
      request.reusedSocket = true;
      if (protocol === 'https:') {
        socket.destroy();
        socket = new TLSSocket(new Socket());
      }
      void fetch(`${protocol}//example.test`);
      request.emit('socket', socket);
      expect(request.setTimeout).toHaveBeenCalledWith(300_000);
    }
  );

  it.each([100, 0])('preserves explicit connectTimeout=%s', timeout => {
    void fetch('http://example.test', { connectTimeout: timeout });
    expect(http.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeout })
    );
    request.emit('socket', socket);
    socket.emit('connect');
    expect(request.setTimeout).not.toHaveBeenCalled();
  });

  it('rejects when the connected socket times out', async () => {
    const result = expect(fetch('http://example.test')).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
    request.emit('socket', socket);
    request.emit('timeout');
    await result;
  });
});
