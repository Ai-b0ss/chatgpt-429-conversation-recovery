# 429 recovery design

## Problem

Some ChatGPT conversation-recovery paths can repeatedly refetch the same conversation after a failed stream or reload. If the backend responds with HTTP 429, repeated polling can keep adding pressure instead of allowing the rate limit to cool down.

In one captured failure we observed 30 consecutive 429 responses for the same conversation read, with roughly 5.3 seconds between attempts.

## Policy

The guard does not attempt to evade or bypass server-side limits. It changes only client retry behavior:

1. identical in-flight conversation reads are coalesced;
2. competing reads for the same conversation are serialized across tabs;
3. a 429 creates both a request-specific cooldown and a conversation-family cooldown, so another protected chat/tab does not immediately add pressure to the same rate-limit family;
4. after 429, retries wait using a bounded local backoff and any longer server `Retry-After` value; delta-seconds and HTTP-date are accepted, with a one-hour cap and a small grace buffer;
5. cooldown state survives a page reload;
6. after repeated 429s, the guard stops retrying internally and returns the final server response;
7. unrelated requests pass through unchanged.

## Protected surfaces

Only GET conversation reads and the conversation list are actively protected. Stream-status, init, resume and other related requests may be observed for diagnostics but are not throttled by this variant.

## Privacy

Diagnostic events contain event type, surface, status, timing and tab metadata. They do not contain conversation text, response bodies, cookies, complete request URLs or conversation IDs.

## Failure model

The extension is intentionally conservative. If ChatGPT changes its internal endpoints or moves a request outside the page fetch path, the guard may stop protecting that path rather than guessing and modifying unrelated traffic.
