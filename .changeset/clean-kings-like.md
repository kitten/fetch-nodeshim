---
'fetch-nodeshim': patch
---

Limit state in which `incoming.socket` is unrefed and instead `.ref()` it when the body is being read, and `.unref()` it again when reading stops.
