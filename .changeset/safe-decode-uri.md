---
"@pracht/core": patch
---

Handle malformed percent-encoding in route matching by catching `decodeURIComponent` failures and treating them as non-matches instead of throwing uncaught `URIError` exceptions.
