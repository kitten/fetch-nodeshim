---
'fetch-nodeshim': patch
---

Prevent outright error when `--no-experimental-fetch` is set, which causes `Request`, `Response`, `FormData`, and `Headers` to not be available globally.
