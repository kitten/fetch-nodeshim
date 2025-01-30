import { PassThrough, Transform, TransformCallback } from 'node:stream';
import * as zlib from 'node:zlib';

/** @see https://www.rfc-editor.org/rfc/rfc9112.html#section-7.2 */
type Encoding = 'gzip' | 'x-gzip' | 'deflate' | 'x-deflate' | 'br' | {};

/** @see https://github.com/nodejs/undici/pull/2650 */
class InflateStream extends Transform {
  _opts?: zlib.ZlibOptions;
  _inflate?: Transform;

  constructor(opts?: zlib.ZlibOptions) {
    super();
    this._opts = opts;
  }

  _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback
  ) {
    if (!this._inflate) {
      if (chunk.length === 0) {
        callback();
        return;
      }
      this._inflate =
        (chunk[0] & 0x0f) === 0x08
          ? zlib.createInflate(this._opts)
          : zlib.createInflateRaw(this._opts);
      this._inflate.on('data', this.push.bind(this));
      this._inflate.on('end', () => this.push(null));
      this._inflate.on('error', err => this.destroy(err));
    }
    this._inflate.write(chunk, encoding, callback);
  }

  _final(callback: TransformCallback) {
    if (this._inflate) {
      this._inflate.end();
      this._inflate = undefined;
    }
    callback();
  }
}

export const createContentDecoder = (encoding: Encoding | {}) => {
  // See: https://github.com/nodejs/undici/blob/008187b/lib/web/fetch/index.js#L2138-L2160
  switch (encoding) {
    case 'br':
      return zlib.createBrotliDecompress({
        flush: zlib.constants.BROTLI_OPERATION_FLUSH,
        finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
      });
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip({
        flush: zlib.constants.Z_SYNC_FLUSH,
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      });
    case 'deflate':
    case 'x-deflate':
      return new InflateStream({
        flush: zlib.constants.Z_SYNC_FLUSH,
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      });
    default:
      return new PassThrough();
  }
};
