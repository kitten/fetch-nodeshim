---
'fetch-nodeshim': patch
---

Reject GET and HEAD requests with a body before sending, including bodies inherited from a Request when overriding its method.
