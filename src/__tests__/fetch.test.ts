// Source: https://github.com/remix-run/web-std-io/blob/7a8596e/packages/fetch/test/main.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import FormDataPolyfill from 'form-data';
import { ReadableStream } from 'node:stream/web';
import stream from 'node:stream';
import vm from 'node:vm';

import TestServer from './utils/server.js';
import { fetch } from '../fetch';

const { Uint8Array: VMUint8Array } = vm.runInNewContext('this');

async function streamToPromise<T>(
  stream: ReadableStream<T>,
  dataHandler: (data: T) => void
) {
  for await (const chunk of stream) {
    dataHandler(chunk);
  }
}

async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const chunks: T[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe(fetch, () => {
  const local = new TestServer();
  let baseURL: string;

  beforeEach(async () => {
    await local.start();
    baseURL = `http://${local.hostname}:${local.port}/`;
  });

  afterEach(async () => {
    await local.stop();
  });

  it('should reject with error if url is protocol relative', async () => {
    // [Type Error: Invalid URL]
    await expect(() =>
      fetch('//example.com/')
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[TypeError: Invalid URL]`);
  });

  it('should reject with error if url is relative path', async () => {
    // [Type Error: Invalid URL]
    await expect(() =>
      fetch('/some/path')
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[TypeError: Invalid URL]`);
  });

  it('should reject with error if protocol is unsupported', async () => {
    // URL scheme 'ftp' is not supported
    await expect(
      fetch('ftp://example.com/')
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[TypeError: URL scheme "ftp:" is not supported.]`
    );
  });

  it('should reject with error on network failure', async () => {
    await expect(() => fetch('http://localhost:50000/')).rejects.toThrow();
  }, 1_000);

  it('should resolve into response', async () => {
    const response = await fetch(new URL('hello', baseURL));
    expect(response.url).toBe(`${baseURL}hello`);
    expect(response).toBeInstanceOf(Response);
    expect(response).toMatchObject({
      headers: expect.any(Headers),
      body: expect.any(ReadableStream),
      bodyUsed: false,
      ok: true,
      status: 200,
      statusText: 'OK',
    });
  });

  it('should support https request', async () => {
    const response = await fetch('https://github.com/', { method: 'HEAD' });
    expect(response.status).toBe(200);
  }, 5000);

  describe('response methods', () => {
    it('should accept plain text response', async () => {
      const response = await fetch(new URL('plain', baseURL));
      expect(response.headers.get('content-type')).toBe('text/plain');
      const text = await response.text();
      expect(response.bodyUsed).toBe(true);
      expect(text).toBe('text');
    });

    it('should accept html response (like plain text)', async () => {
      const response = await fetch(new URL('html', baseURL));
      expect(response.headers.get('content-type')).toBe('text/html');
      const text = await response.text();
      expect(response.bodyUsed).toBe(true);
      expect(text).toBe('<html></html>');
    });

    it('should accept json response', async () => {
      const response = await fetch(new URL('json', baseURL));
      expect(response.headers.get('content-type')).toBe('application/json');
      const text = await response.json();
      expect(response.bodyUsed).toBe(true);
      expect(text).toEqual({ name: 'value' });
    });
  });

  describe('request headers', () => {
    it('should send request with custom headers', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        headers: { 'x-custom-header': 'abc' },
      });
      expect(await response.json()).toMatchObject({
        headers: expect.objectContaining({ 'x-custom-header': 'abc' }),
      });
    });

    it('should prefer init headers when Request is passed', async () => {
      const request = new Request(new URL('inspect', baseURL), {
        headers: { 'x-custom-header': 'abc' },
      });
      const response = await fetch(request, {
        headers: { 'x-custom-header': 'def' },
      });
      expect(await response.json()).toMatchObject({
        headers: expect.objectContaining({ 'x-custom-header': 'def' }),
      });
    });

    it('should send request with custom User-Agent', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        headers: { 'user-agent': 'faked' },
      });
      expect(await response.json()).toMatchObject({
        headers: expect.objectContaining({ 'user-agent': 'faked' }),
      });
    });

    it('should set default Accept header', async () => {
      const response = await fetch(new URL('inspect', baseURL));
      expect(await response.json()).toMatchObject({
        headers: expect.objectContaining({ accept: '*/*' }),
      });
    });

    it('should send custom Accept header', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        headers: { accept: 'application/json' },
      });
      expect(await response.json()).toMatchObject({
        headers: expect.objectContaining({ accept: 'application/json' }),
      });
    });

    it('should accept headers instance', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        headers: new Headers({ 'x-custom-header': 'abc' }),
      });
      expect(await response.json()).toMatchObject({
        headers: expect.objectContaining({ 'x-custom-header': 'abc' }),
      });
    });

    it('should accept custom "host" header', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        headers: { host: 'example.com' },
      });
      expect(await response.json()).toMatchObject({
        headers: expect.objectContaining({ host: 'example.com' }),
      });
    });

    it('should accept custom "HoSt" header', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        headers: { HoSt: 'example.com' },
      });
      expect(await response.json()).toMatchObject({
        headers: expect.objectContaining({ host: 'example.com' }),
      });
    });
  });

  describe('redirects', () => {
    it.each([[301], [302], [303], [307], [308]])(
      'should follow redirect code %d',
      async status => {
        const response = await fetch(new URL(`redirect/${status}`, baseURL));
        expect(response.headers.get('X-Inspect')).toBe('inspect');
      }
    );

    it('should follow redirect chain', async () => {
      const response = await fetch(new URL('redirect/chain', baseURL));
      expect(response.headers.get('X-Inspect')).toBe('inspect');
    });

    it.each([
      ['POST', 301, 'GET'],
      ['PUT', 301, 'PUT'],
      ['POST', 302, 'GET'],
      ['PATCH', 302, 'PATCH'],
      ['PUT', 303, 'GET'],
      ['PATCH', 307, 'PATCH'],
    ])(
      'should follow %s request redirect code %d with %s',
      async (inputMethod, code, outputMethod) => {
        const response = await fetch(new URL(`redirect/${code}`, baseURL), {
          method: inputMethod,
          body: 'a=1',
        });
        expect(response.headers.get('X-Inspect')).toBe('inspect');
        expect(response.url).toBe(`${baseURL}inspect`);
        expect(await response.json()).toMatchObject({
          method: outputMethod,
          body: outputMethod === 'GET' ? '' : 'a=1',
        });
      }
    );

    it('should not follow non-GET redirect if body is a readable stream', async () => {
      await expect(() =>
        fetch(new URL('redirect/307', baseURL), {
          method: 'POST',
          body: stream.Readable.from('tada'),
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: Cannot follow redirect with a streamed body]`
      );
    });

    it('should not follow non HTTP(s) redirect', async () => {
      await expect(() =>
        fetch(new URL('redirect/301/file', baseURL))
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: URL scheme must be a HTTP(S) scheme]`
      );
    });

    it('should support redirect mode, manual flag', async () => {
      const response = await fetch(new URL('redirect/301', baseURL), {
        redirect: 'manual',
      });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe(`${baseURL}inspect`);
    });

    it('should support redirect mode, manual flag, broken Location header', async () => {
      const response = await fetch(new URL('redirect/bad-location', baseURL), {
        redirect: 'manual',
      });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe(
        `${baseURL}redirect/%C3%A2%C2%98%C2%83`
      );
    });

    it('should support redirect mode, error flag', async () => {
      await expect(() =>
        fetch(new URL('redirect/301', baseURL), {
          redirect: 'error',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: URI requested responds with a redirect, redirect mode is set to error]`
      );
    });

    it('should support redirect mode, manual flag when there is no redirect', async () => {
      const response = await fetch(new URL('hello', baseURL), {
        redirect: 'manual',
      });
      expect(response.status).toBe(200);
      expect(response.headers.has('location')).toBe(false);
    });

    it('should follow redirect code 301 and keep existing headers', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        headers: new Headers({ 'x-custom-header': 'abc' }),
      });
      expect(await response.json()).toMatchObject({
        headers: expect.objectContaining({
          'x-custom-header': 'abc',
        }),
      });
    });

    it.each([['follow'], ['manual']] as const)(
      'should treat broken redirect as ordinary response (%s)',
      async redirect => {
        const response = await fetch(new URL('redirect/no-location', baseURL), {
          redirect,
        });
        expect(response.status).toBe(301);
        expect(response.headers.has('location')).toBe(false);
      }
    );

    it('should throw a TypeError on an invalid redirect option', async () => {
      await expect(() =>
        fetch(new URL('redirect/no-location', baseURL), {
          // @ts-ignore: Intentionally invalid
          redirect: 'foobar',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[TypeError: Request constructor: foobar is not an accepted type. Expected one of follow, manual, error.]`
      );
    });

    it('should set redirected property on response when redirect', async () => {
      const response = await fetch(new URL('redirect/301', baseURL));
      expect(response.redirected).toBe(true);
    });

    it('should not set redirected property on response without redirect', async () => {
      const response = await fetch(new URL('hello', baseURL));
      expect(response.redirected).toBe(false);
    });

    it('should follow redirect after empty chunked transfer-encoding', async () => {
      const response = await fetch(new URL('redirect/chunked', baseURL));
      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle client-error response', async () => {
      const response = await fetch(new URL('error/400', baseURL));
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.status).toBe(400);
      expect(response.statusText).toBe('Bad Request');
      expect(response.ok).toBe(false);
      expect(await response.text()).toBe('client error');
    });

    it('should handle server-error response', async () => {
      const response = await fetch(new URL('error/500', baseURL));
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.status).toBe(500);
      expect(response.statusText).toBe('Internal Server Error');
      expect(response.ok).toBe(false);
      expect(await response.text()).toBe('server error');
    });

    it('should handle network-error response', async () => {
      await expect(() =>
        fetch(new URL('error/reset', baseURL))
      ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: socket hang up]`);
    });

    it('should handle premature close properly', async () => {
      const response = await fetch(new URL('redirect/301/rn', baseURL));
      expect(response.status).toBe(403);
    });

    it('should handle network-error partial response', async () => {
      const response = await fetch(new URL('error/premature', baseURL));
      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
      await expect(() =>
        response.text()
      ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: aborted]`);
    });

    it('should handle network-error in chunked response', async () => {
      const response = await fetch(new URL('error/premature/chunked', baseURL));
      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
      await expect(() =>
        collectStream(response.body!)
      ).rejects.toMatchInlineSnapshot(`[Error: aborted]`);
    });

    it('should handle network-error in chunked response in consumeBody', async () => {
      const response = await fetch(new URL('error/premature/chunked', baseURL));
      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
      await expect(() =>
        response.text()
      ).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: aborted]`);
    });
  });

  describe('responses', () => {
    it('should handle chunked response with more than 1 chunk in the final packet', async () => {
      const response = await fetch(new URL('chunked/multiple-ending', baseURL));
      expect(response.ok).toBe(true);
      expect(await response.text()).toBe('foobar');
    });

    it('should handle chunked response with final chunk and EOM in separate packets', async () => {
      const response = await fetch(new URL('chunked/split-ending', baseURL));
      expect(response.ok).toBe(true);
      expect(await response.text()).toBe('foobar');
    });

    it('should reject invalid json response', async () => {
      const response = await fetch(new URL('error/json', baseURL));
      expect(response.headers.get('content-type')).toBe('application/json');
      await expect(() => response.json()).rejects.toThrow(/Unexpected token/);
    });

    it('should reject decoding body twice', async () => {
      const response = await fetch(new URL('plain', baseURL));
      expect(response.headers.get('Content-Type')).toBe('text/plain');
      await response.text();
      expect(response.bodyUsed).toBe(true);
      await expect(() => response.text()).rejects.toThrow(/Body is unusable/);
    });

    it('should handle response with no status text', async () => {
      const response = await fetch(new URL('no-status-text', baseURL));
      expect(response.statusText).toBe('');
    });

    it('should allow piping response body as stream', async () => {
      const response = await fetch(new URL('hello', baseURL));
      const onResult = vi.fn(data => {
        expect(Buffer.from(data).toString()).toBe('world');
      });
      await streamToPromise(response.body!, onResult);
      expect(onResult).toHaveBeenCalledOnce();
    });

    it('should allow cloning response body to two streams', async () => {
      const response = await fetch(new URL('hello', baseURL));
      const clone = response.clone();
      const onResult = vi.fn(data => {
        expect(Buffer.from(data).toString()).toBe('world');
      });
      await Promise.all([
        streamToPromise(response.body!, onResult),
        streamToPromise(clone.body!, onResult),
      ]);
      expect(onResult).toHaveBeenCalledTimes(2);
    });

    describe('no content', () => {
      it('should handle no content response', async () => {
        const response = await fetch(new URL('no-content', baseURL));
        expect(response.status).toBe(204);
        expect(response.statusText).toBe('No Content');
        expect(response.ok).toBe(true);
        expect(await response.text()).toBe('');
      });

      it('should reject when trying to parse no content response as json', async () => {
        const response = await fetch(new URL('no-content', baseURL));
        expect(response.status).toBe(204);
        expect(response.statusText).toBe('No Content');
        expect(response.ok).toBe(true);
        await expect(() =>
          response.json()
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          `[SyntaxError: Unexpected end of JSON input]`
        );
      });

      it('should handle no content response with gzip encoding', async () => {
        const response = await fetch(new URL('no-content/gzip', baseURL));
        expect(response.status).toBe(204);
        expect(response.statusText).toBe('No Content');
        expect(response.headers.get('Content-Encoding')).toBe('gzip');
        expect(response.ok).toBe(true);
        expect(await response.text()).toBe('');
      });

      it('should handle 304 response', async () => {
        const response = await fetch(new URL('not-modified', baseURL));
        expect(response.status).toBe(304);
        expect(response.statusText).toBe('Not Modified');
        expect(response.ok).toBe(false);
        expect(await response.text()).toBe('');
      });

      it('should handle 304 response with gzip encoding', async () => {
        const response = await fetch(new URL('not-modified/gzip', baseURL));
        expect(response.status).toBe(304);
        expect(response.statusText).toBe('Not Modified');
        expect(response.headers.get('Content-Encoding')).toBe('gzip');
        expect(response.ok).toBe(false);
        expect(await response.text()).toBe('');
      });
    });
  });

  describe('content encoding', () => {
    it('should decompress gzip response', async () => {
      const response = await fetch(new URL('gzip', baseURL));
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-encoding')).toBe('gzip');
      expect(await response.text()).toBe('hello world');
    });

    it('should decompress slightly invalid gzip response', async () => {
      const response = await fetch(new URL('gzip-truncated', baseURL));
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-encoding')).toBe('gzip');
      expect(await response.text()).toBe('hello world');
    });

    it('should make capitalised Content-Encoding lowercase', async () => {
      const response = await fetch(new URL('gzip-capital', baseURL));
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-encoding')).toBe('gzip');
      expect(await response.text()).toBe('hello world');
    });

    it('should decompress deflate response', async () => {
      const response = await fetch(new URL('deflate', baseURL));
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-encoding')).toBe('deflate');
      expect(await response.text()).toBe('hello world');
    });

    it('should decompress deflate raw response from old apache server', async () => {
      const response = await fetch(new URL('deflate-raw', baseURL));
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-encoding')).toBe('deflate');
      expect(await response.text()).toBe('hello world');
    });

    it('should decompress brotli response', async () => {
      const response = await fetch(new URL('brotli', baseURL));
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-encoding')).toBe('br');
      expect(await response.text()).toBe('hello world');
    });

    it('should skip decompression if unsupported', async () => {
      const response = await fetch(new URL('sdch', baseURL));
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-encoding')).toBe('sdch');
      expect(await response.text()).toBe('fake sdch string');
    });

    it('should reject if response compression is invalid', async () => {
      const response = await fetch(
        new URL('invalid-content-encoding', baseURL)
      );
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-encoding')).toBe('gzip');
      await expect(() =>
        response.text()
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: incorrect header check]`
      );
    });

    it('should handle errors on invalid body stream even if it is not used', async () => {
      const response = await fetch(
        new URL('invalid-content-encoding', baseURL)
      );
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-encoding')).toBe('gzip');
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    it('should reject when invalid body stream is used later', async () => {
      const response = await fetch(
        new URL('invalid-content-encoding', baseURL)
      );
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(response.headers.get('content-encoding')).toBe('gzip');
      await new Promise(resolve => setTimeout(resolve, 20));
      await expect(() =>
        response.text()
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Error: incorrect header check]`
      );
    });
  });

  describe('AbortController', () => {
    let controller: AbortController;

    beforeEach(() => {
      controller = new AbortController();
    });

    it('should support request cancellation with signal', async () => {
      const response$ = fetch(new URL('timeout', baseURL), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          body: JSON.stringify({ hello: 'world' }),
        },
      });
      setTimeout(() => controller.abort(), 100);
      await expect(response$).rejects.toThrowErrorMatchingInlineSnapshot(
        `[AbortError: The operation was aborted]`
      );
    });

    it('should support multiple request cancellation with signal', async () => {
      const fetches = [
        fetch(new URL('timeout', baseURL), { signal: controller.signal }),
        fetch(new URL('timeout', baseURL), {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            body: JSON.stringify({ hello: 'world' }),
          },
        }),
      ];
      setTimeout(() => controller.abort(), 100);
      await expect(fetches[0]).rejects.toThrowErrorMatchingInlineSnapshot(
        `[AbortError: The operation was aborted]`
      );
      await expect(fetches[1]).rejects.toThrowErrorMatchingInlineSnapshot(
        `[AbortError: The operation was aborted]`
      );
    });

    it('should reject immediately if signal has already been aborted', async () => {
      controller.abort();
      await expect(() => {
        return fetch(new URL('timeout', baseURL), {
          signal: controller.signal,
        });
      }).rejects.toThrowErrorMatchingInlineSnapshot(
        `[AbortError: The operation was aborted]`
      );
    });

    it('should allow redirects to be aborted', async () => {
      const request = new Request(new URL('redirect/slow', baseURL), {
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 20);
      await expect(() =>
        fetch(request)
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[AbortError: The operation was aborted]`
      );
    });

    it('should allow redirected response body to be aborted', async () => {
      const response = await fetch(new URL('redirect/slow-stream', baseURL), {
        signal: controller.signal,
      });
      expect(response.headers.get('content-type')).toBe('text/plain');
      const text$ = response.text();
      controller.abort();
      await expect(text$).rejects.toThrowErrorMatchingInlineSnapshot(
        `[AbortError: This operation was aborted]`
      );
    });

    it('should reject response body when aborted before stream completes', async () => {
      const response = await fetch(new URL('slow', baseURL), {
        signal: controller.signal,
      });
      const text$ = response.text();
      controller.abort();
      await expect(text$).rejects.toThrowErrorMatchingInlineSnapshot(
        `[AbortError: This operation was aborted]`
      );
    });

    it('should reject response body methods immediately with AbortError when aborted before stream is disturbed', async () => {
      const response$ = fetch(new URL('slow', baseURL), {
        signal: controller.signal,
      });
      controller.abort();
      await expect(response$).rejects.toThrowErrorMatchingInlineSnapshot(
        `[AbortError: The operation was aborted]`
      );
    });

    it('should emit error event to response body with an AbortError when aborted before underlying stream is closed', async () => {
      const response = await fetch(new URL('slow', baseURL), {
        signal: controller.signal,
      });
      const done$ = expect(() =>
        response.arrayBuffer()
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[AbortError: This operation was aborted]`
      );
      controller.abort();
      await done$;
    });

    it('should cancel request body of type Stream with AbortError when aborted', async () => {
      const body = new stream.Readable({ objectMode: true });
      body._read = () => {};
      const response$ = fetch(new URL('slow', baseURL), {
        signal: controller.signal,
        method: 'POST',
        body,
      });
      const bodyError$ = new Promise(resolve => {
        body.on('error', error => {
          expect(error).toMatchInlineSnapshot(
            `[AbortError: The operation was aborted]`
          );
          resolve(null);
        });
      });
      controller.abort();
      await bodyError$;
      await expect(response$).rejects.toMatchInlineSnapshot(
        `[AbortError: The operation was aborted]`
      );
    });

    it('should throw a TypeError if a signal is not of type AbortSignal or EventTarget', async () => {
      const url = new URL('inspect', baseURL);
      await Promise.all([
        expect(() =>
          fetch(url, { signal: {} as any })
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          `[TypeError: The "signal" argument must be an instance of AbortSignal. Received an instance of Object]`
        ),
        expect(() =>
          fetch(url, { signal: Object.create(null) as any })
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          `[TypeError: The "signal" argument must be an instance of AbortSignal. Received [Object: null prototype] {}]`
        ),
      ]);
    });

    it('should gracefully handle a nullish signal', async () => {
      const url = new URL('inspect', baseURL);
      await Promise.all([
        expect(fetch(url, { signal: null })).resolves.toMatchObject({
          ok: true,
        }),
        expect(fetch(url, { signal: undefined })).resolves.toMatchObject({
          ok: true,
        }),
      ]);
    });
  });

  describe('request body', () => {
    it('should allow POST request with empty body', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).not.toHaveProperty('headers.content-type');
      expect(inspect).toMatchObject({
        method: 'POST',
        headers: {
          'content-length': '0',
        },
      });
    });

    it('should allow POST request with string body', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: 'a=1',
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'a=1',
        headers: {
          'content-type': 'text/plain;charset=UTF-8',
          'content-length': '3',
        },
      });
    });

    it('should allow POST request with Buffer body', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: Buffer.from('a=1', 'utf8'),
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).not.toHaveProperty('headers.content-type');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'a=1',
        headers: {
          'content-length': '3',
        },
      });
    });

    it('should allow POST request with ArrayBuffer body', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: new TextEncoder().encode('Hello, world!\n').buffer,
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).not.toHaveProperty('headers.content-type');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'Hello, world!\n',
        headers: {
          'content-length': '14',
        },
      });
    });

    it('should allow POST request with ArrayBuffer body from a VM context', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: new VMUint8Array(Buffer.from('Hello, world!\n')).buffer,
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).not.toHaveProperty('headers.content-type');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'Hello, world!\n',
        headers: {
          'content-length': '14',
        },
      });
    });

    it('should allow POST request with ArrayBufferView (Uint8Array) body', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: new TextEncoder().encode('Hello, world!\n'),
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).not.toHaveProperty('headers.content-type');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'Hello, world!\n',
        headers: {
          'content-length': '14',
        },
      });
    });

    it('should allow POST request with ArrayBufferView (DataView) body', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: new DataView(new TextEncoder().encode('Hello, world!\n').buffer),
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).not.toHaveProperty('headers.content-type');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'Hello, world!\n',
        headers: {
          'content-length': '14',
        },
      });
    });

    it('should allow POST request with ArrayBufferView (Uint8Array) body from a VM context', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: new VMUint8Array(new TextEncoder().encode('Hello, world!\n')),
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).not.toHaveProperty('headers.content-type');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'Hello, world!\n',
        headers: {
          'content-length': '14',
        },
      });
    });

    it('should allow POST request with ArrayBufferView (Uint8Array, offset, length) body', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: new TextEncoder().encode('Hello, world!\n').subarray(7, 13),
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).not.toHaveProperty('headers.content-type');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'world!',
        headers: {
          'content-length': '6',
        },
      });
    });

    it('should allow POST request with blob body without type', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: new Blob(['a=1']),
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).not.toHaveProperty('headers.content-type');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'a=1',
        headers: {
          'content-length': '3',
        },
      });
    });

    it('should allow POST request with blob body with type', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: new Blob(['a=1'], {
          type: 'text/plain;charset=utf-8',
        }),
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'a=1',
        headers: {
          'content-type': 'text/plain;charset=utf-8',
          'content-length': '3',
        },
      });
    });

    it('should preserve blob body on roundtrip', async () => {
      const body = new Blob(['a=1']);
      let response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body,
      });
      expect(await response.json()).toMatchObject({ body: 'a=1' });
      response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: new Blob(['a=1']),
      });
      expect(await response.json()).toMatchObject({ body: 'a=1' });
    });

    it('should allow POST request with readable stream as body', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: stream.Readable.from('a=1'),
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.content-type');
      expect(inspect).not.toHaveProperty('headers.content-length');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'a=1',
        headers: {
          'transfer-encoding': 'chunked',
        },
      });
    });

    it('should allow POST request with FormData as body', async () => {
      const form = new FormData();
      form.append('a', '1');

      const response = await fetch(new URL('multipart', baseURL), {
        method: 'POST',
        body: form,
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'a=1',
        headers: {
          'content-type': expect.stringMatching(
            /^multipart\/form-data; boundary=/
          ),
          'content-length': '109',
        },
      });
    });

    it('should allow POST request with form-data using stream as body', async () => {
      const form = new FormDataPolyfill();
      form.append('my_field', stream.Readable.from('dummy'));

      const response = await fetch(new URL('multipart', baseURL), {
        method: 'POST',
        body: form,
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.content-length');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'my_field=undefined',
        headers: {
          'transfer-encoding': 'chunked',
          'content-type': expect.stringMatching(
            /^multipart\/form-data; boundary=/
          ),
        },
      });
    });

    it('should allow POST request with URLSearchParams as body', async () => {
      const params = new URLSearchParams();
      params.set('key1', 'value1');
      params.set('key2', 'value2');

      const response = await fetch(new URL('multipart', baseURL), {
        method: 'POST',
        body: params,
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'key1=value1key2=value2',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'content-length': '23',
        },
      });
    });

    it('should allow POST request with extended URLSearchParams as body', async () => {
      class CustomSearchParameters extends URLSearchParams {}
      const params = new CustomSearchParameters();
      params.set('key1', 'value1');
      params.set('key2', 'value2');

      const response = await fetch(new URL('multipart', baseURL), {
        method: 'POST',
        body: params,
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'key1=value1key2=value2',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'content-length': '23',
        },
      });
    });

    it('should allow POST request with invalid body', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: { a: 1 } as any,
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: '[object Object]',
        headers: {
          'content-type': 'text/plain;charset=UTF-8',
          'content-length': expect.any(String),
        },
      });
    });

    it('should overwrite Content-Length if possible', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'POST',
        body: new Blob(['a=1']),
        headers: {
          'Content-Length': '1000',
        },
      });
      const inspect = await response.json();
      expect(inspect).not.toHaveProperty('headers.transfer-encoding');
      expect(inspect).not.toHaveProperty('headers.content-type');
      expect(inspect).toMatchObject({
        method: 'POST',
        body: 'a=1',
        headers: {
          'content-length': '3',
        },
      });
    });

    it.each([['PUT'], ['DELETE'], ['PATCH']])(
      'should allow %s request',
      async method => {
        const response = await fetch(new URL('inspect', baseURL), {
          method,
          body: 'a=1',
        });
        const inspect = await response.json();
        expect(inspect).toMatchObject({
          method,
          body: 'a=1',
        });
      }
    );

    it('should allow HEAD requests', async () => {
      const response = await fetch(new URL('inspect', baseURL), {
        method: 'HEAD',
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
    });

    it('should allow HEAD requests with Content-Encoding header', async () => {
      const response = await fetch(new URL('error/404', baseURL), {
        method: 'HEAD',
      });
      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Encoding')).toBe('gzip');
      expect(await response.text()).toBe('');
    });

    it('should allow OPTIONS request', async () => {
      const response = await fetch(new URL('options', baseURL), {
        method: 'OPTIONS',
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('Allow')).toBe('GET, HEAD, OPTIONS');
      expect(await response.text()).toBe('hello world');
    });

    it('should support fetch with Request instance', async () => {
      const request = new Request(new URL('hello', baseURL));
      const response = await fetch(request);
      expect(response.url).toBe(request.url);
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
    });
  });

  describe('request URL', () => {
    it('should keep `?` sign in URL when no params are given', async () => {
      const response = await fetch(new URL('question?', baseURL));
      expect(response.url).toBe(`${baseURL}question?`);
    });

    it('if params are given, do not modify anything', async () => {
      const response = await fetch(new URL('question?a=1', baseURL));
      expect(response.url).toBe(`${baseURL}question?a=1`);
    });

    it('should preserve the hash (#) symbol', async () => {
      const response = await fetch(new URL('question?#', baseURL));
      expect(response.url).toBe(`${baseURL}question?#`);
    });

    it('should encode URLs as UTF-8', async () => {
      const url = new URL('möbius', baseURL);
      const res = await fetch(url);
      expect(res.url).to.equal(`${baseURL}m%C3%B6bius`);
    });
  });
});
