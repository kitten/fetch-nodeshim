---
'fetch-nodeshim': patch
---

Add configurable `connectTimeout` to override connection timeout. The default will now also be 30s if the request contains `text/html` in the `Accept` header
