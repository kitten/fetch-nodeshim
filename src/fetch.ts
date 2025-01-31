import { Stream, Readable, pipeline } from 'node:stream';
import * as https from 'node:https';
import * as http from 'node:http';
import * as url from 'node:url';

import { extractBody } from './body';
import { createContentDecoder } from './encoding';
import { URL, Request, RequestInit, Response } from './webstd';

/** Maximum allowed redirects (matching Chromium's limit) */
const MAX_REDIRECTS = 20;

/** Convert Node.js raw headers array to Headers */
const headersOfRawHeaders = (rawHeaders: readonly string[]): Headers => {
  const headers = new Headers();
  for (let i = 0; i < rawHeaders.length; i += 2)
    headers.set(rawHeaders[i], rawHeaders[i + 1]);
  return headers;
};

/** Assign Headers to a Node.js OutgoingMessage (request) */
const assignOutgoingMessageHeaders = (
  outgoing: http.OutgoingMessage,
  headers: Headers
) => {
  if (typeof outgoing.setHeaders === 'function') {
    outgoing.setHeaders(headers);
  } else {
    for (const [key, value] of headers) outgoing.setHeader(key, value);
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
    method: methodToHttpOption(
      initFromRequest ? input.method : requestInit?.method
    ),
    signal,
  } satisfies http.RequestOptions;

  function _call(
    resolve: (response: Response | Promise<Response>) => void,
    reject: (reason?: any) => void
  ) {
    const method = requestOptions.method;
    const protocol = requestOptions.protocol === 'https:' ? https : http;
    const outgoing = protocol.request(requestOptions);

    outgoing.on('response', incoming => {
      incoming.setTimeout(0); // Forcefully disable timeout

      const init = {
        status: incoming.statusCode,
        statusText: incoming.statusMessage,
        headers: headersOfRawHeaders(incoming.rawHeaders),
      } satisfies ResponseInit;

      if (isRedirectCode(init.status)) {
        const location = init.headers.get('Location');
        const locationURL =
          location != null ? new URL(location, requestUrl) : null;
        if (redirect === 'error') {
          // TODO: do we need a special Error instance here?
          reject(
            new Error(
              'URI requested responds with a redirect, redirect mode is set to error'
            )
          );
          return;
        } else if (redirect === 'manual' && locationURL !== null) {
          init.headers.set('Location', locationURL.toString());
        } else if (redirect === 'follow' && locationURL !== null) {
          if (++redirects > MAX_REDIRECTS) {
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

      const destroy = (reason?: any) => {
        signal?.removeEventListener('abort', destroy);
        if (reason) {
          incoming.destroy(signal?.aborted ? signal.reason : reason);
          reject(signal?.aborted ? signal.reason : reason);
        }
      };

      signal?.addEventListener('abort', destroy);

      let body: Readable | null = incoming;
      const encoding = init.headers.get('Content-Encoding')?.toLowerCase();
      if (method === 'HEAD' || init.status === 204 || init.status === 304) {
        body = null;
      } else if (encoding != null) {
        init.headers.set('Content-Encoding', encoding);
        body = pipeline(body, createContentDecoder(encoding), destroy);
      }

      resolve(
        createResponse(body, init, {
          type: 'default',
          url: requestUrl.toString(),
          redirected: redirects > 0,
        })
      );
    });

    outgoing.on('error', reject);

    if (!requestHeaders.has('Accept')) requestHeaders.set('Accept', '*/*');
    if (requestBody.contentType)
      requestHeaders.set('Content-Type', requestBody.contentType);

    if (requestBody.body == null && (method === 'POST' || method === 'PUT')) {
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
      pipeline(body, outgoing, error => {
        if (error) reject(error);
      });
    }
  }

  return await new Promise(_call);
}

export { _fetch as fetch };
