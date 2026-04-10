---
"@pracht/adapter-node": minor
"@pracht/vite-plugin": patch
---

Add trusted proxy aware request URL construction

The Node adapter now defaults to deriving the request URL from the socket
(TLS state for protocol, Host header for host) instead of blindly trusting
X-Forwarded-Proto. A new `trustProxy` option opts into honoring forwarded
headers (Forwarded RFC 7239, X-Forwarded-Proto, X-Forwarded-Host) when
the server sits behind a trusted reverse proxy.

The dev SSR middleware no longer reads X-Forwarded-Proto at all, preventing
host-header poisoning during development.
