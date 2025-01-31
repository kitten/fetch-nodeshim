/// <reference types="@types/node" />

import * as buffer from 'node:buffer';

type Or<T, U> = void extends T ? U : T;

export type BodyInit =
  | ArrayBuffer
  | AsyncIterable<Uint8Array>
  | Blob
  | FormData
  | Iterable<Uint8Array>
  | NodeJS.ArrayBufferView
  | URLSearchParams
  | null
  | string;

// See: https://nodejs.org/docs/latest-v20.x/api/globals.html#class-file
// The `File` global was only added in Node.js 20
const _File: Or<typeof File, typeof buffer.File> = buffer.File;
if (typeof globalThis.File === 'undefined') {
  globalThis.File = _File;
}

declare global {
  interface File extends _File {}
  var File: typeof File;

  // NOTE: In case undici was used, but its types aren't applied, this needs to be added
  interface RequestInit {
    duplex?: 'half';
  }
}

// There be dragons here.
// This is complex because of overlapping definitions in lib.dom, @types/node, and undici-types
// Some types define and overload constructor interfaces with type interfaces
// Here, we have to account for global differences and split the overloads apart

interface _RequestInit extends Or<RequestInit, globalThis.RequestInit> {}
interface _ResponseInit extends Or<ResponseInit, globalThis.ResponseInit> {}

interface _URLSearchParams
  extends Or<URLSearchParams, globalThis.URLSearchParams> {}
interface URLSearchParamsClass
  extends Or<typeof URLSearchParams, typeof globalThis.URLSearchParams> {}
const _URLSearchParams: URLSearchParamsClass = URLSearchParams as any;

interface _URL extends Or<URL, globalThis.URL> {}
interface URLClass extends Or<typeof URL, typeof globalThis.URL> {}
const _URL: URLClass = URL;

interface _Request extends Or<Request, globalThis.Request> {}
interface RequestClass extends Or<typeof Request, typeof globalThis.Request> {}
const _Request: RequestClass = Request;

interface _Response extends Or<Response, globalThis.Response> {}
interface ResponseClass
  extends Or<typeof Response, typeof globalThis.Response> {}
const _Response: ResponseClass = Response;

interface _Headers extends Or<Headers, globalThis.Headers> {}
interface HeadersClass extends Or<typeof Headers, typeof globalThis.Headers> {}
const _Headers: HeadersClass = Headers;

interface _FormData extends Or<FormData, globalThis.FormData> {}
interface FormDataClass
  extends Or<typeof FormData, typeof globalThis.FormData> {}
const _FormData: FormDataClass = FormData;

export {
  type _RequestInit as RequestInit,
  type _ResponseInit as ResponseInit,
  _File as File,
  _URL as URL,
  _URLSearchParams as URLSearchParams,
  _Request as Request,
  _Response as Response,
  _Headers as Headers,
  _FormData as FormData,
};
