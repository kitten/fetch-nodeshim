import type { HeadersLike } from './types';
import { HeadersInit } from './webstd';

const _implSymbol = Symbol('HeadersImpl');

type HeaderEntry = [name: string, value: string];

interface HeadersInternals {
  list: HeaderEntry[];
  canonical: Map<string, string>;
}

const validateName = (name: string): void => {
  // https://fetch.spec.whatwg.org/#concept-header-name
  // token = 1*tchar per RFC 7230
  if (!/^[!#$%&'*+\-.^_`|~\w]+$/.test(name)) {
    throw new TypeError(`Invalid header name: "${name}"`);
  }
};

const validateValue = (name: string, value: string): void => {
  // https://fetch.spec.whatwg.org/#concept-header-value
  // Reject NUL (\0) and bare CR/LF
  if (/[\0\r\n]/.test(value)) {
    throw new TypeError(`Invalid header value for "${name}"`);
  }
};

const normalizeValue = (name: string, value: string): string => {
  const normalized = `${value}`.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
  validateValue(name, normalized);
  return normalized;
};

type HeadersInput =
  | Headers
  | HeadersLike
  | string[][]
  | Record<string, string | ReadonlyArray<string>>
  | Iterable<[string, string]>;

const isHeadersImpl = (x: unknown): x is Headers =>
  typeof x === 'object' && x !== null && _implSymbol in x;

const addEntry = (
  list: HeaderEntry[],
  canonical: Map<string, string>,
  name: string,
  value: string
): void => {
  const lower = name.toLowerCase();
  if (!canonical.has(lower)) canonical.set(lower, name);
  list.push([name, value]);
};

const fillFromInit = (
  list: HeaderEntry[],
  canonical: Map<string, string>,
  init: HeadersInput
): void => {
  if (isHeadersImpl(init)) {
    const src = init[_implSymbol];
    for (const entry of src.list) list.push([entry[0], entry[1]]);
    for (const [lower, orig] of src.canonical) {
      if (!canonical.has(lower)) canonical.set(lower, orig);
    }
  } else if (Array.isArray(init)) {
    for (const pair of init) {
      if (pair.length !== 2)
        throw new TypeError(
          'Header init must be an iterable of [name, value] pairs'
        );
      validateName(pair[0]);
      const value = normalizeValue(pair[0], pair[1]);
      addEntry(list, canonical, pair[0], value);
    }
  } else if (Symbol.iterator in Object(init)) {
    for (const pair of init as Iterable<[string, string]>) {
      if (!Array.isArray(pair) || pair.length !== 2)
        throw new TypeError(
          'Header init must be an iterable of [name, value] pairs'
        );
      validateName(pair[0]);
      const value = normalizeValue(pair[0], pair[1]);
      addEntry(list, canonical, pair[0], value);
    }
  } else {
    const record = init as Record<string, string | ReadonlyArray<string>>;
    for (const name of Object.keys(record)) {
      validateName(name);
      const values = record[name];
      if (Array.isArray(values)) {
        for (const v of values) {
          const value = normalizeValue(name, v);
          addEntry(list, canonical, name, value);
        }
      } else {
        const value = normalizeValue(name, values as string);
        addEntry(list, canonical, name, value);
      }
    }
  }
};

// https://fetch.spec.whatwg.org/#concept-header-list-sort-and-combine
const sortAndCombine = (
  list: HeaderEntry[],
  canonical: Map<string, string>
): HeaderEntry[] => {
  const map = new Map<string, string[]>();
  const order: string[] = [];
  for (const [name, value] of list) {
    const lower = name.toLowerCase();
    let values = map.get(lower);
    if (!values) {
      map.set(lower, (values = []));
      order.push(lower);
    }
    values.push(value);
  }
  order.sort();
  const result: HeaderEntry[] = [];
  for (const lower of order) {
    const values = map.get(lower)!;
    const out = canonical.get(lower) ?? lower;
    if (lower === 'set-cookie') {
      for (const value of values) result.push([out, value]);
    } else {
      result.push([out, values.join(', ')]);
    }
  }
  return result;
};

export interface Headers extends HeadersLike {
  new (init?: HeadersInit): Headers;
}

export class Headers implements HeadersLike {
  [_implSymbol]: HeadersInternals;

  constructor(init?: HeadersInput) {
    const list: HeaderEntry[] = [];
    const canonical = new Map<string, string>();
    if (init != null) fillFromInit(list, canonical, init);
    this[_implSymbol] = { list, canonical };
  }

  append(name: string, value: string): void {
    const { list, canonical } = this[_implSymbol];
    validateName(name);
    value = normalizeValue(name, value);
    addEntry(list, canonical, name, value);
  }

  delete(name: string): void {
    const { list, canonical } = this[_implSymbol];
    validateName(name);
    const lower = name.toLowerCase();
    canonical.delete(lower);
    for (let idx = 0; idx < list.length; idx++) {
      if (list[idx][0] === lower) {
        list.splice(idx, 1);
        idx--;
      }
    }
  }

  get(name: string): string | null {
    validateName(name);
    const lower = name.toLowerCase();
    const values: string[] = [];
    for (const pair of this[_implSymbol].list)
      if (pair[0].toLowerCase() === lower) values.push(pair[1]);
    return values.length > 0 ? values.join(', ') : null;
  }

  has(name: string): boolean {
    validateName(name);
    return this[_implSymbol].canonical.has(name.toLowerCase());
  }

  set(name: string, value: string): void {
    const { list, canonical } = this[_implSymbol];
    validateName(name);
    value = normalizeValue(name, value);
    const lower = name.toLowerCase();
    if (!canonical.has(lower)) canonical.set(lower, name);
    const canonicalName = canonical.get(lower)!;
    let found = false;
    for (let i = 0; i < list.length; ) {
      if (list[i][0].toLowerCase() === lower) {
        if (!found) {
          list[i] = [canonicalName, value];
          found = true;
          i++;
        } else {
          list.splice(i, 1);
        }
      } else {
        i++;
      }
    }
    if (!found) list.push([canonicalName, value]);
  }

  getSetCookie(): string[] {
    const result: string[] = [];
    for (const [name, value] of this[_implSymbol].list) {
      if (name.toLowerCase() === 'set-cookie') result.push(value);
    }
    return result;
  }

  forEach(
    callback: (value: string, name: string, headers: Headers) => void,
    thisArg?: unknown
  ): void {
    const { list, canonical } = this[_implSymbol];
    for (const [name, value] of sortAndCombine(list, canonical)) {
      callback.call(thisArg, value, name, this);
    }
  }

  *keys(): IterableIterator<string> {
    const { list, canonical } = this[_implSymbol];
    const seen = new Set<string>();
    for (const pair of sortAndCombine(list, canonical)) {
      if (!seen.has(pair[0])) {
        seen.add(pair[0]);
        yield pair[0];
      }
    }
  }

  *values(): IterableIterator<string> {
    const { list, canonical } = this[_implSymbol];
    for (const pair of sortAndCombine(list, canonical)) {
      yield pair[1];
    }
  }

  *entries(): IterableIterator<[string, string]> {
    const { list, canonical } = this[_implSymbol];
    for (const pair of sortAndCombine(list, canonical)) {
      yield pair;
    }
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }
}

Headers[_implSymbol] = Headers;
if (
  typeof globalThis.Headers === 'function' &&
  !globalThis.Headers[_implSymbol]
) {
  Object.setPrototypeOf(Headers.prototype, globalThis.Headers.prototype);
}

if (globalThis.Headers !== Headers) {
  globalThis.Headers = Headers;
}
