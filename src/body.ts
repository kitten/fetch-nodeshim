import { Readable } from 'node:stream';
import { isAnyArrayBuffer } from 'node:util/types';
import { randomBytes } from 'node:crypto';
import { Blob, FormData, URLSearchParams } from './webstd';

export type BodyInit =
  | Exclude<RequestInit['body'], undefined | null>
  | FormDataPolyfill
  | Readable;

export interface BodyState {
  contentLength: number | null;
  contentType: string | null;
  body: Readable | ReadableStream | Uint8Array | null;
}

interface FormDataPolyfill extends Readable {
  getBoundary(): string;
  getLengthSync(): number;
  hasKnownLength(): number;
}

const CRLF = '\r\n';
const CRLF_LENGTH = 2;
const BOUNDARY = '-'.repeat(2);

const isReadable = (object: any): object is Readable =>
  Readable.isReadable(object);

const isIterable = (
  object: any
): object is AsyncIterable<any> | Iterable<any> =>
  typeof object[Symbol.asyncIterator] === 'function' ||
  typeof object[Symbol.iterator] === 'function';

const isMultipartFormDataStream = (object: any): object is FormDataPolyfill =>
  typeof object.getBoundary === 'function' &&
  typeof object.hasKnownLength === 'function' &&
  typeof object.getLengthSync === 'function' &&
  Readable.isReadable(object);

const isFormData = (object: any): object is FormData =>
  typeof object === 'object' &&
  typeof object.append === 'function' &&
  typeof object.set === 'function' &&
  typeof object.get === 'function' &&
  typeof object.getAll === 'function' &&
  typeof object.delete === 'function' &&
  typeof object.keys === 'function' &&
  typeof object.values === 'function' &&
  typeof object.entries === 'function' &&
  typeof object.constructor === 'function' &&
  object[Symbol.toStringTag] === 'FormData';

const isURLSearchParameters = (object: any): object is URLSearchParams =>
  typeof object === 'object' &&
  typeof object.append === 'function' &&
  typeof object.delete === 'function' &&
  typeof object.get === 'function' &&
  typeof object.getAll === 'function' &&
  typeof object.has === 'function' &&
  typeof object.set === 'function' &&
  typeof object.sort === 'function' &&
  object[Symbol.toStringTag] === 'URLSearchParams';

const isReadableStream = (object: any): object is ReadableStream =>
  typeof object === 'object' &&
  typeof object.getReader === 'function' &&
  typeof object.cancel === 'function' &&
  typeof object.tee === 'function';

const isBlob = (object: any): object is Blob => {
  if (
    typeof object === 'object' &&
    typeof object.arrayBuffer === 'function' &&
    typeof object.type === 'string' &&
    typeof object.stream === 'function' &&
    typeof object.constructor === 'function'
  ) {
    const tag = object[Symbol.toStringTag];
    return tag.startsWith('Blob') || tag.startsWith('File');
  } else {
    return false;
  }
};

const makeFormBoundary = (): string =>
  `formdata-${randomBytes(8).toString('hex')}`;

const getFormHeader = (
  boundary: string,
  name: string,
  field: File | Blob | string
): string => {
  let header = `${BOUNDARY}${boundary}${CRLF}`;
  header += `Content-Disposition: form-data; name="${name}"`;
  if (isBlob(field)) {
    header += `; filename="${(field as File).name ?? 'blob'}"${CRLF}`;
    header += `Content-Type: ${field.type || 'application/octet-stream'}`;
  }
  return `${header}${CRLF}${CRLF}`;
};

const getFormFooter = (boundary: string) =>
  `${BOUNDARY}${boundary}${BOUNDARY}${CRLF}${CRLF}`;

export const getFormDataLength = (form: FormData, boundary: string) => {
  let length = Buffer.byteLength(getFormFooter(boundary));
  for (const [name, value] of form)
    length +=
      Buffer.byteLength(getFormHeader(boundary, name, value)) +
      (isBlob(value) ? value.size : Buffer.byteLength(`${value}`)) +
      CRLF_LENGTH;
  return length;
};

async function* generatorOfFormData(
  form: FormData,
  boundary: string
): AsyncGenerator<ArrayBufferLike> {
  const encoder = new TextEncoder();
  for (const [name, value] of form) {
    if (isBlob(value)) {
      yield encoder.encode(getFormHeader(boundary, name, value));
      yield* value.stream();
      yield encoder.encode(CRLF);
    } else {
      yield encoder.encode(getFormHeader(boundary, name, value) + value + CRLF);
    }
  }
  yield encoder.encode(getFormFooter(boundary));
}

const encoder = new TextEncoder();

export const extractBody = (object: BodyInit | null): BodyState => {
  let type: string | null = null;
  let body: Readable | ReadableStream | Uint8Array | null;
  let size: number | null = null;
  if (object == null) {
    body = null;
    size = 0;
  } else if (typeof object === 'string') {
    const bytes = encoder.encode(`${object}`);
    type = 'text/plain;charset=UTF-8';
    size = bytes.byteLength;
    body = bytes;
  } else if (isURLSearchParameters(object)) {
    const bytes = encoder.encode(object.toString());
    body = bytes;
    size = bytes.byteLength;
    type = 'application/x-www-form-urlencoded;charset=UTF-8';
  } else if (isBlob(object)) {
    size = object.size;
    type = object.type || null;
    body = object.stream();
  } else if (object instanceof Uint8Array) {
    body = object;
    size = object.byteLength;
  } else if (isAnyArrayBuffer(object)) {
    const bytes = new Uint8Array(object);
    body = bytes;
    size = bytes.byteLength;
  } else if (ArrayBuffer.isView(object)) {
    const bytes = new Uint8Array(
      object.buffer,
      object.byteOffset,
      object.byteLength
    );
    body = bytes;
    size = bytes.byteLength;
  } else if (isReadableStream(object)) {
    body = object;
  } else if (isFormData(object)) {
    const boundary = makeFormBoundary();
    type = `multipart/form-data; boundary=${boundary}`;
    size = getFormDataLength(object, boundary);
    body = Readable.from(generatorOfFormData(object, boundary));
  } else if (isMultipartFormDataStream(object)) {
    type = `multipart/form-data; boundary=${object.getBoundary()}`;
    size = object.hasKnownLength() ? object.getLengthSync() : null;
    body = object as Readable;
  } else if (isReadable(object)) {
    body = object as Readable;
  } else if (isIterable(object)) {
    body = Readable.from(object);
  } else {
    const bytes = encoder.encode(`${object}`);
    type = 'text/plain;charset=UTF-8';
    body = bytes;
    size = bytes.byteLength;
  }
  return {
    contentLength: size,
    contentType: type,
    body,
  };
};
