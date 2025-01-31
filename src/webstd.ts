import * as buffer from 'node:buffer';

type Or<T, U> = void extends T ? U : T;

export type HeadersInit =
  | string[][]
  | Record<string, string | ReadonlyArray<string>>
  | _Headers;

export type FormDataEntryValue = string | _File;

export type RequestInfo = string | _URL | _Request;

interface _Iterable<T, TReturn = any, TNext = any>
  extends Or<
    Iterable<T, TReturn, TNext>,
    globalThis.Iterable<T, TReturn, TNext>
  > {}
interface _AsyncIterable<T, TReturn = any, TNext = any>
  extends Or<
    AsyncIterable<T, TReturn, TNext>,
    globalThis.AsyncIterable<T, TReturn, TNext>
  > {}
interface _ReadableStream<T = any>
  extends Or<ReadableStream<T>, globalThis.ReadableStream<T>> {}

// NOTE: AsyncIterable<Uint8Array> is left out
export type BodyInit =
  | ArrayBuffer
  | _Blob
  | NodeJS.ArrayBufferView
  | _URLSearchParams
  | _ReadableStream
  | _AsyncIterable<Uint8Array>
  | _FormData
  | _Iterable<Uint8Array>
  | null
  | string;

// See: https://nodejs.org/docs/latest-v20.x/api/globals.html#class-file
// The `File` global was only added in Node.js 20
interface _File extends _Blob, Or<File, globalThis.File> {
  readonly name: string;
  readonly lastModified: number;
}
interface _File extends Or<globalThis.File, buffer.File> {}
interface FileClass extends Or<typeof globalThis.File, typeof buffer.File> {}
const _File: FileClass = globalThis.File || buffer.File;
if (typeof globalThis.File === 'undefined') {
  globalThis.File = _File;
}

declare global {
  var File: _File;
}

// There be dragons here.
// This is complex because of overlapping definitions in lib.dom, @types/node, and undici-types
// Some types define and overload constructor interfaces with type interfaces
// Here, we have to account for global differences and split the overloads apart

interface _RequestInit extends Or<RequestInit, globalThis.RequestInit> {
  duplex?: 'half';
}
interface _ResponseInit extends Or<ResponseInit, globalThis.ResponseInit> {}

interface _Blob extends Or<Blob, globalThis.Blob> {}
interface BlobClass extends Or<typeof Blob, typeof globalThis.Blob> {}
const _Blob: BlobClass = Blob;

interface _URLSearchParams
  extends Or<URLSearchParams, globalThis.URLSearchParams> {}
interface URLSearchParamsClass
  extends Or<typeof URLSearchParams, typeof globalThis.URLSearchParams> {}
const _URLSearchParams: URLSearchParamsClass = URLSearchParams as any;

interface _URL extends Or<URL, globalThis.URL> {}
interface URLClass extends Or<typeof URL, typeof globalThis.URL> {}
const _URL: URLClass = URL;

interface _Request extends Or<Request, globalThis.Request> {}
interface RequestClass extends Or<typeof Request, typeof globalThis.Request> {
  new (
    input: RequestInfo,
    init?: _RequestInit | Or<RequestInit, globalThis.RequestInit>
  ): _Request;
}
const _Request: RequestClass = Request;

interface _Response extends Or<Response, globalThis.Response> {}
interface ResponseClass
  extends Or<typeof Response, typeof globalThis.Response> {
  new (body?: BodyInit, init?: _ResponseInit): _Response;
}
const _Response: ResponseClass = Response;

interface _Headers extends Or<Headers, globalThis.Headers> {}
interface HeadersClass extends Or<typeof Headers, typeof globalThis.Headers> {
  new (init?: HeadersInit): _Headers;
}
const _Headers: HeadersClass = Headers;

interface _FormData
  extends Or<
    FormData & _Iterable<[string, FormDataEntryValue]>,
    globalThis.FormData
  > {}
interface FormDataClass
  extends Or<typeof FormData, typeof globalThis.FormData> {}
const _FormData: FormDataClass = FormData;

export {
  type _RequestInit as RequestInit,
  type _ResponseInit as ResponseInit,
  _Blob as Blob,
  _File as File,
  _URL as URL,
  _URLSearchParams as URLSearchParams,
  _Request as Request,
  _Response as Response,
  _Headers as Headers,
  _FormData as FormData,
};
