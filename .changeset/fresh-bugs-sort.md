---
'fetch-nodeshim': patch
---

Fix `fetch(new Request(...), init)` case, where `init` should take precedence over the request
