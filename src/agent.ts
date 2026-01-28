import * as https from 'node:https';
import * as http from 'node:http';
import * as net from 'node:net';

declare module 'net' {
  export function _normalizeArgs(
    options: unknown
  ): asserts options is net.NetConnectOpts;
}

const getHttpProxyUrl = () => process.env.HTTP_PROXY ?? process.env.http_proxy;
const getHttpsProxyUrl = () =>
  process.env.HTTPS_PROXY ?? process.env.https_proxy;
const getNoProxy = () => process.env.NO_PROXY ?? process.env.no_proxy;

const createProxyPattern = (pattern: string): RegExp => {
  pattern = pattern.trim().replace(/\./g, '\\.').replace(/\*/g, '[\w.]+');
  if (!pattern.startsWith('.')) pattern = `^${pattern}`;
  if (!pattern.endsWith('.') || pattern.includes(':')) pattern += '$';
  return new RegExp(pattern, 'i');
};

const matchesNoProxy = (options: {
  host?: string | null;
  hostname?: string | null;
  port?: string | number | null;
  defaultPort?: string | number;
}): boolean => {
  const NO_PROXY = getNoProxy();
  if (NO_PROXY === '*' || NO_PROXY === '1' || NO_PROXY === 'true') {
    return true;
  } else if (NO_PROXY) {
    for (const noProxyPattern of NO_PROXY.split(',')) {
      const hostPattern = createProxyPattern(noProxyPattern);
      const hostname = options.hostname || options.host;
      const origin =
        hostname && `${hostname}:${options.port || options.defaultPort || 80}`;
      if (
        (hostname && hostPattern.test(hostname)) ||
        (origin && hostPattern.test(origin))
      ) {
        return true;
      }
    }
    return false;
  } else {
    return false;
  }
};

const defaultAgentOpts = {
  keepAlive: true,
  keepAliveMsecs: 1000,
};

let _httpAgentUrl: string | undefined;
let _httpAgent: http.Agent | undefined;

export const getHttpAgent = (
  options: http.RequestOptions
): http.RequestOptions['agent'] => {
  const HTTP_PROXY = getHttpProxyUrl();
  if (!HTTP_PROXY) {
    _httpAgent = undefined;
    return undefined;
  } else if (matchesNoProxy(options)) {
    return undefined;
  } else if (!_httpAgentUrl || _httpAgentUrl !== HTTP_PROXY) {
    _httpAgent = undefined;
    try {
      _httpAgentUrl = HTTP_PROXY;
      _httpAgent = new HttpProxyAgent(new URL(HTTP_PROXY), defaultAgentOpts);
    } catch (error: any) {
      const wrapped = new Error(
        `Invalid HTTP_PROXY URL: "${HTTP_PROXY}".\n` + error?.message || error
      );
      (wrapped as any).cause = error;
      throw wrapped;
    }
    return _httpAgent;
  } else {
    return _httpAgent;
  }
};

let _httpsAgentUrl: string | undefined;
let _httpsAgent: https.Agent | undefined;

export const getHttpsAgent = (
  options: https.RequestOptions
): https.RequestOptions['agent'] => {
  const HTTPS_PROXY = getHttpsProxyUrl() ?? getHttpProxyUrl();
  if (!HTTPS_PROXY) {
    _httpsAgent = undefined;
    return undefined;
  } else if (matchesNoProxy(options)) {
    return undefined;
  } else if (!_httpsAgentUrl || _httpsAgentUrl !== HTTPS_PROXY) {
    _httpsAgent = undefined;
    try {
      _httpsAgentUrl = HTTPS_PROXY;
      _httpsAgent = new HttpsProxyAgent(new URL(HTTPS_PROXY), defaultAgentOpts);
    } catch (error: any) {
      const wrapped = new Error(
        `Invalid HTTPS_PROXY URL: "${HTTPS_PROXY}".\n` + error?.message || error
      );
      (wrapped as any).cause = error;
      throw wrapped;
    }
    return _httpsAgent;
  } else {
    return _httpsAgent;
  }
};

const createRequestOptions = (
  proxy: URL,
  keepAlive: boolean,
  options: http.RequestOptions
) => {
  const proxyHeaders: Record<string, string> = {
    host: `${options.host}:${options.port}`,
    connection: keepAlive ? 'keep-alive' : 'close',
  };
  if (proxy.username || proxy.password) {
    const username = decodeURIComponent(proxy.username || '');
    const password = decodeURIComponent(proxy.password || '');
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    proxyHeaders['proxy-authorization'] = `Basic ${auth}`;
  }
  return {
    method: 'CONNECT',
    host: proxy.hostname,
    port: proxy.port,
    path: `${options.host}:${options.port}`,
    setHost: false,
    agent: false,
    proxyEnv: {},
    timeout: 8_000,
    headers: proxyHeaders,
    servername: proxy.protocol === 'https:' ? proxy.hostname : undefined,
  };
};

class HttpProxyAgent extends http.Agent {
  _keepAlive: boolean;
  _proxy: URL;

  constructor(proxy: URL, options: http.AgentOptions) {
    super(options);
    this._proxy = proxy;
    this._keepAlive = !!options.keepAlive;
  }

  createConnection(
    options: http.RequestOptions,
    callback: (err: Error | null, socket: net.Socket | null) => void
  ): void {
    const request = (this._proxy.protocol === 'http:' ? http : https).request(
      createRequestOptions(this._proxy, this._keepAlive, options)
    );

    request.once('connect', (response, socket, _head) => {
      request.removeAllListeners();
      socket.removeAllListeners();
      if (response.statusCode === 200) {
        callback(null, socket);
      } else {
        socket.destroy();
        callback(
          new Error(
            `HTTP Proxy Network Error: ${response.statusMessage || response.statusCode}`
          ),
          null
        );
      }
    });

    request.once('timeout', () => {
      request.destroy(new Error('HTTP Proxy timed out'));
    });

    request.once('error', error => {
      request.removeAllListeners();
      callback(error, null);
    });

    request.end();
  }
}

class HttpsProxyAgent extends https.Agent {
  _proxy: URL;
  _keepAlive: boolean;

  constructor(proxy: URL, options: https.AgentOptions) {
    super(options);
    this._proxy = proxy;
    this._keepAlive = !!options.keepAlive;
  }

  createConnection(
    options: https.RequestOptions,
    callback: (err: Error | null, socket: net.Socket | null) => void
  ): void {
    const request = (this._proxy.protocol === 'http:' ? http : https).request(
      createRequestOptions(this._proxy, this._keepAlive, options)
    );

    request.once('connect', (response, socket, _head) => {
      request.removeAllListeners();
      socket.removeAllListeners();
      if (response.statusCode === 200) {
        const netOpts = { ...options, socket };
        net._normalizeArgs(netOpts);
        // @ts-expect-error: This isn't properly defined in @types/node
        const secureSocket = super.createConnection(netOpts);
        callback(null, secureSocket);
      } else {
        socket.destroy();
        callback(
          new Error(
            `HTTP Proxy Network Error: ${response.statusMessage || response.statusCode}`
          ),
          null
        );
      }
    });

    request.once('timeout', () => {
      request.destroy(new Error('HTTP Proxy timed out'));
    });

    request.once('error', err => {
      request.removeAllListeners();
      callback(err, null);
    });

    request.end();
  }
}
