---
'fetch-nodeshim': patch
---

Unref the incoming socket when the timeout is disabled, to prevent body streams that never start from keeping processes alive
