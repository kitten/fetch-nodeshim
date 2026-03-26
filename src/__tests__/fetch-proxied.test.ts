import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { Server as ProxyServer } from 'proxy-chain';

import TestServer from './utils/server.js';
import { fetch } from '../fetch';

async function startHttpProxy() {
  const server = new ProxyServer();
  const port = await new Promise(resolve => {
    server.listen(() => {
      resolve(server.port);
    });
  });

  return {
    url: `http://localhost:${port}`,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close(true, err => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

const proxy = await startHttpProxy();
const local = new TestServer();
let baseURL: string;

beforeEach(async () => {
  await local.start();
  baseURL = `http://${local.hostname}:${local.port}/`;
});

afterEach(async () => {
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  await local.stop();
});

afterAll(async () => {
  await proxy.close();
});

const testCI = process.env.CI ? it : it.skip;

describe('fetch via HTTP proxy', () => {
  it('performs an HTTP request when HTTP_PROXY is set (tunnel via CONNECT to HTTP)', async () => {
    process.env.HTTP_PROXY = proxy.url;
    const response = await fetch(new URL('inspect', baseURL));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      body: '',
      headers: expect.objectContaining({
        connection: 'keep-alive',
      }),
      rawHeaders: expect.objectContaining({
        Connection: 'keep-alive',
      }),
      inspect: true,
      method: 'GET',
      url: '/inspect',
    });
  });

  testCI(
    'performs an HTTPs request when HTTPS_PROXY is set (tunnel via CONNECT to HTTPs)',
    async () => {
      process.env.HTTPS_PROXY = proxy.url;
      const response = await fetch('https://api.expo.dev');
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('OK');
    }
  );
});
