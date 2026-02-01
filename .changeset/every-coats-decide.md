---
'fetch-nodeshim': patch
---

Set `Content-Length: 0` when `response.body` is `null` for `PATCH` as well
