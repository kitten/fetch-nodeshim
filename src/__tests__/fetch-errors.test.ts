import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';

import TestServer from './utils/server.js';
import { fetch } from '../fetch';

describe('fetch error handling', () => {
  const server = new TestServer();

  beforeEach(() => server.start());
  afterEach(() => server.stop());

  describe('incoming stream errors', () => {
    it('should propagate error when connection resets mid-body', async () => {
      const url = server.mock((_req, res) => {
        res.writeHead(200, { 'Content-Length': '1000' });
        res.write('partial');
        setTimeout(() => res.destroy(), 10);
      });

      const response = await fetch(url);
      expect(response.ok).toBe(true);
      await expect(response.text()).rejects.toThrow();
    });

    it('should not cause unhandled errors on incoming stream', async () => {
      const errors: Error[] = [];
      const handler = (e: Error) => errors.push(e);
      process.on('uncaughtException', handler);

      const url = server.mock((_req, res) => {
        res.writeHead(200, { 'Transfer-Encoding': 'chunked' });
        res.write('data');
        setTimeout(() => res.destroy(), 10);
      });

      const response = await fetch(url);
      try {
        await response.text();
      } catch {}
      await new Promise(r => setTimeout(r, 50));

      process.off('uncaughtException', handler);
      expect(errors).toHaveLength(0);
    });
  });

  describe('request body pipeline errors', () => {
    it('should reject when request body stream errors', async () => {
      const body = new Readable({
        read() {
          this.push('data');
          setTimeout(() => this.destroy(new Error('stream error')), 10);
        },
      });

      const url = server.mock((req, res) => {
        req.on('data', () => {});
        req.on('end', () => res.end('ok'));
        req.on('error', () => {});
      });

      await expect(fetch(url, { method: 'POST', body })).rejects.toThrow(
        'stream error'
      );
    });
  });

  describe('decompression errors', () => {
    it('should propagate gzip decompression errors', async () => {
      const url = server.mock((_req, res) => {
        res.writeHead(200, { 'Content-Encoding': 'gzip' });
        res.end('not gzip');
      });

      const response = await fetch(url);
      expect(response.ok).toBe(true);
      await expect(response.text()).rejects.toThrow();
    });

    it('should propagate brotli decompression errors', async () => {
      const url = server.mock((_req, res) => {
        res.writeHead(200, { 'Content-Encoding': 'br' });
        res.end('not brotli');
      });

      const response = await fetch(url);
      await expect(response.text()).rejects.toThrow();
    });
  });

  describe('abort handling', () => {
    it('should abort during response streaming', async () => {
      const controller = new AbortController();

      const url = server.mock((_req, res) => {
        res.writeHead(200, { 'Transfer-Encoding': 'chunked' });
        const id = setInterval(() => res.write('x'), 10);
        res.on('close', () => clearInterval(id));
      });

      const response = await fetch(url, { signal: controller.signal });
      setTimeout(() => controller.abort(), 30);
      await expect(response.text()).rejects.toThrow();
    });
  });
});
