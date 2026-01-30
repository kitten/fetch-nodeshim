# minifetch

## 0.4.1

### Patch Changes

- Add sane default timeout to `http.request`
  Submitted by [@kitten](https://github.com/kitten) (See [#12](https://github.com/kitten/fetch-nodeshim/pull/12))

## 0.4.0

### Minor Changes

- Add automatic configuration for `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` similar to the upcoming Node 24+ built-in support. Agents will automatically be created and used when these environment variables are set
  Submitted by [@kitten](https://github.com/kitten) (See [#8](https://github.com/kitten/fetch-nodeshim/pull/8))

### Patch Changes

- Prevent outright error when `--no-experimental-fetch` is set, which causes `Request`, `Response`, `FormData`, and `Headers` to not be available globally
  Submitted by [@kitten](https://github.com/kitten) (See [#11](https://github.com/kitten/fetch-nodeshim/pull/11))
- Update rollup config for reduced output and exclude sources from sourcemaps
  Submitted by [@kitten](https://github.com/kitten) (See [#9](https://github.com/kitten/fetch-nodeshim/pull/9))

## 0.3.0

### Minor Changes

- Add `Body` mixin as export
  Submitted by [@kitten](https://github.com/kitten) (See [#6](https://github.com/kitten/fetch-nodeshim/pull/6))

## 0.2.1

### Patch Changes

- Provenance Release
  Submitted by [@kitten](https://github.com/kitten) (See [#4](https://github.com/kitten/fetch-nodeshim/pull/4))

## 0.2.0

### Minor Changes

- Add web standard type/globals re-exports and polyfill `File` from `node:buffer`
  Submitted by [@kitten](https://github.com/kitten) (See [#1](https://github.com/kitten/fetch-nodeshim/pull/1))

### Patch Changes

- Add missing constructor type overloads and add missing `Blob` re-export
  Submitted by [@kitten](https://github.com/kitten) (See [#2](https://github.com/kitten/fetch-nodeshim/pull/2))

## 0.1.0

Initial Release.
