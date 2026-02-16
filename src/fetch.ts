import { Stream, Readable, pipeline } from 'node:stream';
import { Socket } from 'node:net';
import * as https from 'node:https';
import * as http from 'node:http';
import * as url from 'node:url';

import { extractBody } from './body';
import { createContentDecoder } from './encoding';
import { URL, Request, RequestInit, Response } from './webstd';
import { getHttpsAgent, getHttpAgent } from './agent';

/** Maximum allowed redirects (matching Chromium's limit) */
const MAX_REDIRECTS = 20;

const parseURL = (input: string, base?: string | URL): URL | null => {
  try {
    return new URL(input, base);
  } catch {
    return null;
  }
};

/** Convert Node.js raw headers array to Headers */
const headersOfRawHeaders = (rawHeaders: readonly string[]): Headers => {
  const headers = new Headers();
  for (let i = 0; i < rawHeaders.length; i += 2)
    headers.append(rawHeaders[i], rawHeaders[i + 1]);
  return headers;
};

/** Assign Headers to a Node.js OutgoingMessage (request) */
const assignOutgoingMessageHeaders = (
  outgoing: http.OutgoingMessage,
  headers: Headers
) => {
  // Preassemble array headers, mostly only for Set-Cookie
  // We're avoiding `getSetCookie` since support is unclear in Node 18
  const collection: Record<string, string | string[]> = {};
  for (const [key, value] of headers) {
    if (Array.isArray(collection[key])) {
      collection[key].push(value);
    } else if (collection[key] != undefined) {
      collection[key] = [collection[key], value];
    } else {
      collection[key] = value;
    }
  }
  // We don't use `setHeaders` due to a Bun bug (Fix: https://github.com/oven-sh/bun/pull/27050)
  for (const key in collection) {
    outgoing.setHeader(key, collection[key]);
  }
};

/** Normalize methods and disallow special methods */
const toRedirectOption = (
  redirect: string | undefined
): 'follow' | 'manual' | 'error' => {
  switch (redirect) {
    case 'follow':
    case 'manual':
    case 'error':
      return redirect;
    case undefined:
      return 'follow';
    default:
      throw new TypeError(
        `Request constructor: ${redirect} is not an accepted type. Expected one of follow, manual, error.`
      );
  }
};

/** Normalize methods and disallow special methods */
const methodToHttpOption = (method: string | undefined): string => {
  switch (method) {
    case 'CONNECT':
    case 'TRACE':
    case 'TRACK':
      throw new TypeError(
        `Failed to construct 'Request': '${method}' HTTP method is unsupported.`
      );
    default:
      return method ? method.toUpperCase() : 'GET';
  }
};

/** Convert URL to Node.js HTTP request options and disallow unsupported protocols */
const urlToHttpOptions = (input: URL) => {
  const _url = new URL(input);
  switch (_url.protocol) {
    // TODO: 'file:' and 'data:' support
    case 'http:':
    case 'https:':
      return url.urlToHttpOptions(_url);
    default:
      throw new TypeError(`URL scheme "${_url.protocol}" is not supported.`);
  }
};

/** Returns if `input` is a Request object */
const isRequest = (input: any): input is Request =>
  input != null && typeof input === 'object' && 'body' in input;

/** Returns if status `code` is a redirect code */
const isRedirectCode = (
  code: number | undefined
): code is 301 | 302 | 303 | 307 | 308 =>
  code === 301 || code === 302 || code === 303 || code === 307 || code === 308;

function createResponse(
  body: ConstructorParameters<typeof Response>[0] | null,
  init: ResponseInit,
  params: {
    url: string;
    redirected: boolean;
    type: 'basic' | 'cors' | 'default' | 'error' | 'opaque' | 'opaqueredirect';
  }
) {
  const response = new Response(body, init);
  Object.defineProperty(response, 'url', { value: params.url });
  if (params.type !== 'default')
    Object.defineProperty(response, 'type', { value: params.type });
  if (params.redirected)
    Object.defineProperty(response, 'redirected', { value: params.redirected });
  return response;
}

function attachRefLifetime(body: Readable, socket: Socket): void {
  const { _read } = body;
  body.on('close', () => {
    socket.unref();
  });
  body._read = function _readRef(...args: Parameters<Readable['_read']>) {
    body._read = _read;
    socket.ref();
    return _read.apply(this, args);
  };
}

async function _fetch(
  input: string | URL | Request,
  requestInit?: RequestInit
): Promise<Response> {
  const initFromRequest = isRequest(input);
  const initUrl = initFromRequest ? input.url : input;
  const initBody = initFromRequest ? input.body : requestInit?.body || null;
  const signal = initFromRequest
    ? input.signal
    : requestInit?.signal || undefined;
  const redirect = toRedirectOption(
    initFromRequest ? input.redirect : requestInit?.redirect
  );

  let requestUrl = new URL(initUrl);
  let requestBody = extractBody(initBody);
  let redirects = 0;

  const requestHeaders = new Headers(
    requestInit?.headers || (initFromRequest ? input.headers : undefined)
  );
  const requestOptions = {
    ...urlToHttpOptions(requestUrl),
    timeout: 5_000,
    method: methodToHttpOption(
      initFromRequest ? input.method : requestInit?.method
    ),
    signal,
  } satisfies http.RequestOptions;

  function _call(
    resolve: (response: Response | Promise<Response>) => void,
    reject: (reason?: any) => void
  ) {
    requestOptions.agent =
      requestOptions.protocol === 'https:'
        ? getHttpsAgent(requestOptions)
        : getHttpAgent(requestOptions);
    const method = requestOptions.method;
    const protocol = requestOptions.protocol === 'https:' ? https : http;
    const outgoing = protocol.request(requestOptions);

    let incoming: http.IncomingMessage | undefined;

    const destroy = (reason?: any) => {
      if (reason) {
        outgoing?.destroy(signal?.aborted ? signal.reason : reason);
        incoming?.destroy(signal?.aborted ? signal.reason : reason);
        reject(signal?.aborted ? signal.reason : reason);
      }
      signal?.removeEventListener('abort', destroy);
    };

    signal?.addEventListener('abort', destroy);

    outgoing.on('timeout', () => {
      if (!incoming) {
        const error = new Error('Request timed out') as NodeJS.ErrnoException;
        error.code = 'ETIMEDOUT';
        destroy(error);
      }
    });

    outgoing.on('response', _incoming => {
      if (signal?.aborted) {
        return;
      }

      incoming = _incoming;
      incoming.setTimeout(0); // Forcefully disable timeout
      incoming.socket.unref();
      incoming.on('error', destroy);

      const init = {
        status: incoming.statusCode,
        statusText: incoming.statusMessage,
        headers: headersOfRawHeaders(incoming.rawHeaders),
      } satisfies ResponseInit;

      if (isRedirectCode(init.status)) {
        const location = init.headers.get('Location');
        const locationURL =
          location != null ? parseURL(location, requestUrl) : null;
        if (redirect === 'error') {
          reject(
            new Error(
              'URI requested responds with a redirect, redirect mode is set to error'
            )
          );
          return;
        } else if (redirect === 'manual' && location) {
          init.headers.set('Location', locationURL?.href ?? location);
        } else if (redirect === 'follow') {
          if (locationURL === null) {
            reject(
              new Error('URI requested responds with an invalid redirect URL')
            );
            return;
          } else if (++redirects > MAX_REDIRECTS) {
            reject(new Error(`maximum redirect reached at: ${requestUrl}`));
            return;
          } else if (
            locationURL.protocol !== 'http:' &&
            locationURL.protocol !== 'https:'
          ) {
            // TODO: do we need a special Error instance here?
            reject(new Error('URL scheme must be a HTTP(S) scheme'));
            return;
          }

          if (
            init.status === 303 ||
            ((init.status === 301 || init.status === 302) && method === 'POST')
          ) {
            requestBody = extractBody(null);
            requestOptions.method = 'GET';
            requestHeaders.delete('Content-Length');
          } else if (
            requestBody.body != null &&
            requestBody.contentLength == null
          ) {
            reject(new Error('Cannot follow redirect with a streamed body'));
            return;
          } else {
            requestBody = extractBody(initBody);
          }

          Object.assign(
            requestOptions,
            urlToHttpOptions((requestUrl = locationURL))
          );
          return _call(resolve, reject);
        }
      }

      let body: Readable | null = incoming;
      const encoding = init.headers.get('Content-Encoding')?.toLowerCase();
      if (method === 'HEAD' || init.status === 204 || init.status === 304) {
        body = null;
      } else if (encoding != null) {
        init.headers.set('Content-Encoding', encoding);
        body = pipeline(body, createContentDecoder(encoding), destroy);
        outgoing.on('error', destroy);
      }

      // Re-ref the socket when the body starts being consumed to prevent
      // early process exit, then unref when done to allow normal exit.
      if (body != null) {
        attachRefLifetime(body, incoming.socket);
      }

      resolve(
        createResponse(body, init, {
          type: 'default',
          url: requestUrl.toString(),
          redirected: redirects > 0,
        })
      );
    });

    outgoing.on('error', destroy);

    if (!requestHeaders.has('Accept')) {
      requestHeaders.set('Accept', '*/*');
    }
    if (!requestHeaders.has('Content-Type') && requestBody.contentType) {
      requestHeaders.set('Content-Type', requestBody.contentType);
    }

    if (
      requestBody.body == null &&
      (method === 'POST' || method === 'PUT' || method === 'PATCH')
    ) {
      requestHeaders.set('Content-Length', '0');
    } else if (requestBody.body != null && requestBody.contentLength != null) {
      requestHeaders.set('Content-Length', `${requestBody.contentLength}`);
    }

    assignOutgoingMessageHeaders(outgoing, requestHeaders);

    if (requestBody.body == null) {
      outgoing.end();
    } else if (requestBody.body instanceof Uint8Array) {
      outgoing.write(requestBody.body);
      outgoing.end();
    } else {
      const body =
        requestBody.body instanceof Stream
          ? requestBody.body
          : Readable.fromWeb(requestBody.body);
      pipeline(body, outgoing, destroy);
    }
  }

  return await new Promise(_call);
}

export { _fetch as fetch };
