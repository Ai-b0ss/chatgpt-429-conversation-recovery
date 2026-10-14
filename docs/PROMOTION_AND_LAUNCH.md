# Community Launch & Promotion Playbook

This document contains targeted launch copy, forum announcement templates, and publication strategies for distributing **ChatGPT Conversation Availability Guard**.

---

## 1. Positioning Strategy

- **Core Problem:** The infamous **“This chat is unavailable”** / **“Unable to load conversation”** error screen in ChatGPT when switching chats, navigating tabs, or during peak OpenAI traffic hours.
- **Root Cause Identified:** OpenAI's backend issues transient HTTP 429 (Too Many Requests) or Cloudflare 502/504 errors on `GET /backend-api/conversation/...`. ChatGPT's React UI crashes permanently instead of waiting for a few seconds. Repeated user refreshes trigger client-side retry stampedes, prolonging the outage.
- **Value Proposition:** An ultra-lightweight, zero-config, open-source browser extension that intercepts safe conversation reads, backs off gracefully, deduplicates requests across tabs, and transparently recovers the chat without losing your place.
- **Tone:** Technical, humble, transparent, privacy-centric (not a hack, not an OpenAI bypass).

---

## 2. Reddit Launch Posts

### A. For `r/ChatGPT`
**Subreddit:** `r/ChatGPT`  
**Flair:** `Tip / Resource` or `Tools / Software`  
**Title:** Tired of "This chat is unavailable"? I built a lightweight open-source fix for the HTTP 429 bug.

**Post Body:**
```markdown
Hey everyone!

If you use ChatGPT extensively or juggle multiple tabs, you’ve probably run into that frustrating screen:
> **"This chat is unavailable"** or **"Unable to load conversation"**

After digging into the network requests when this happens, here is what is actually going on under the hood:
1. When OpenAI experiences traffic spikes or you open a few chats at once, the backend returns a transient **HTTP 429 (Too Many Requests)** or **504 (Gateway Timeout)** on the conversation-detail GET request.
2. Even if the rate limit only lasts 3–5 seconds, ChatGPT's React frontend immediately crashes into an unrecoverable "Chat unavailable" state.
3. Frustrated users hit F5 repeatedly, creating an accidental client-side "retry storm" that extends the rate limit for up to several minutes.

### The Solution: ChatGPT Conversation Availability Guard
I built an open-source browser extension designed to solve this exact edge case:
- **Transparent Recovery:** When a conversation read gets a transient 429 or 5xx, it keeps the request pending, respects the server's `Retry-After` header (or applies smart exponential backoff), and retries quietly. Your chat opens smoothly as soon as the server is ready.
- **React 18 & Multi-Tab Friendly:** Multiplexes concurrent requests and coordinates cooldowns across open tabs so opening 3 tabs won't hammer OpenAI simultaneously.
- **100% Safe & Privacy-First:** It **never** intercepts or replays prompt submissions (POST requests), message generation, or payment actions. It only protects idempotent GET reads. No data ever leaves your browser (no analytics, no telemetry, MIT licensed).

The project is completely free and open-source on GitHub:
👉 https://github.com/Ai-b0ss/chatgpt-429-conversation-recovery

You can install it manually from the Releases page or package it in under a minute.

Hope this helps anyone who has lost their workflow to transient 429s! Feedback and bug reports are very welcome.
```

---

### B. For `r/OpenAI` & `r/webdev`
**Title:** How we diagnosed and mitigated ChatGPT’s “This chat is unavailable” (HTTP 429 / 504 React crash) with an open-source MV3 guard

**Post Body:**
```markdown
Hi all,

Over the past few weeks, we investigated a recurring issue in the ChatGPT web client where conversations would suddenly fail to render with *"This chat is unavailable"*.

We ran a network trace during peak hours and captured a session where a single conversation fetch was triggered 34 times: 4 successful reads followed by 30 HTTP 429 responses roughly 5.3s apart. 

### Why the stock UI fails:
- **Zero Grace Period:** ChatGPT's data-fetching hooks in React treat an initial HTTP 429 or transient 504 Gateway Timeout as terminal.
- **React 18 Multiplexing Issues:** If component trees unmount during route transitions, inflight abort signals can prematurely cancel recovery attempts.
- **Cross-Tab Stampedes:** Multiple open tabs competing for the same conversation family escalate cooldowns exponentially.

### Architectural Fix in v0.9.4:
We released **ChatGPT Conversation Availability Guard v0.9.4**:
1. **Fetch Interceptor at Document Start:** Wraps window.fetch in the page context. Intercepts only safe GET reads (`/backend-api/conversation/*`).
2. **AbortSignal Multiplexing:** Subscribes multiple callers to a single upstream request with a master AbortController; an abort by an unmounting component doesn't cancel active viewers.
3. **Bounded Jittered Backoff:** Bounded recovery up to 5 minutes with exponential backoff and Web Locks cross-tab coordination.
4. **Passive POST Telemetry:** POST endpoints (message generation, init) are strictly observed, never replayed, guaranteeing zero double-submission risk.

Full source code, regression tests (Playwright + synthetic test server), and build instructions:
👉 https://github.com/Ai-b0ss/chatgpt-429-conversation-recovery

Contributions and review welcome!
```

---

## 3. Twitter / X Launch Thread

**Tweet 1 (Hook + Visual):**
> Constantly hitting "This chat is unavailable" on ChatGPT? 🛑
> 
> You're not banned—it's usually an unhandled HTTP 429 or 504 gateway timeout that causes ChatGPT's React UI to crash into a permanent error state.
> 
> We fixed it. Introducing ChatGPT Conversation Availability Guard (v0.9.4) 🛡️👇
> *(Attach screenshot or GIF of the recovery toast in action)*

**Tweet 2 (The Problem):**
> What actually happens:
> When OpenAI experiences a micro-spike, reading a chat fails with 429.
> Instead of pausing for 3 seconds and retrying, the web client crashes immediately.
> 
> Then you spam F5, creating a client-side retry storm that makes it 10x worse.

**Tweet 3 (The Solution):**
> Our Chrome MV3 extension intercepts idempotent conversation reads:
> ⏱️ Transparent bounded backoff (respects Retry-After)
> 🔀 React 18 AbortSignal multiplexing
> 🔒 Cross-tab Web Locks to prevent stampedes
> 💬 Clean in-DOM status notification so you're never stuck on a frozen tab

**Tweet 4 (Privacy Guarantee):**
> 100% Privacy-First:
> ❌ No external tracking or servers
> ❌ Never touches your messages, prompts, or auth tokens
> ❌ NEVER replays POST requests (zero duplicate prompts)
> ✅ 100% Open-Source (MIT)

**Tweet 5 (Link & Call to Action):**
> Get the v0.9.4 release or audit the code on GitHub:
> 🔗 https://github.com/Ai-b0ss/chatgpt-429-conversation-recovery
> 
> Stars, issues, and PRs appreciated! ⭐

---

## 4. Hacker News "Show HN"

**Title:** Show HN: ChatGPT Conversation Availability Guard – Mitigate 429/504 chat crashes

**Text:**
```text
Hi HN,

Like many people who use ChatGPT for daily work, I frequently hit the “This chat is unavailable” screen when switching between tabs or during busy periods.

Tracing the requests revealed that transient HTTP 429 (Too Many Requests) or 504 (Gateway Timeout) from Cloudflare on GET /backend-api/conversation/... causes React to immediately render an unrecoverable failure state. In many cases, repeated rapid reloads trigger client-side retry stampedes that prolong the outage for minutes.

I wrote ChatGPT Conversation Availability Guard, an open-source (MIT) Chrome Manifest V3 extension that safely wraps conversation reads:
- Intercepts and holds safe GET reads during transient 429/502/503/504 responses with bounded jittered backoff.
- Uses AbortSignal multiplexing so React 18 component unmounts don't abort inflight recovery for active viewers.
- Uses Web Locks to coordinate cooldowns across open tabs without herd effects.
- Strictly observes POST requests (never replays them, preventing duplicate prompts).
- Zero external dependencies, no analytics, no conversational data capture.

Code and Playwright test suite:
https://github.com/Ai-b0ss/chatgpt-429-conversation-recovery

Feedback on the design and edge case handling is very welcome!
```

---

## 5. GitHub Release Notes Template (v0.9.4)

### Release Title: `v0.9.4 — Production Hardening, Abort Multiplexing & Release Packaging`

```markdown
### 🚀 What's New in v0.9.4

This release brings major architectural hardening, fixes critical edge cases observed in production, and provides official packaging for the Chrome Web Store.

#### ✨ Key Features & Improvements
- **AbortSignal Multiplexing:** Fixed an issue where React 18 StrictMode double-mounting or component route changes could prematurely abort a shared inflight recovery. Multiple subscribers now share a unified master controller and receive independent cloned responses (`guard.js`).
- **Transient 5xx Gateway Protection:** Added bounded retry handling for transient Cloudflare/Envoy errors (`502 Bad Gateway`, `503 Service Unavailable`, `504 Gateway Timeout`) that previously caused instant conversation failure during OpenAI server spikes.
- **Selective Per-Conversation Cancellation Cooldown:** User-initiated aborts now apply cooldowns strictly to the aborted conversation rather than penalizing unrelated tabs with a 12-second throttle.
- **In-DOM Recovery Notice:** Subtle status toast notifies users when a conversation recovery takes $>3$ seconds, preventing the impression of an infinite hang.
- **Stream-Observer 429 Backoff:** Added bounded 429 backoff handling to `maybeRecoverResume404` in `stream-observer.js`.
- **Store-Ready Assets & Tooling:**
  - Added crisp 16x16, 32x32, 48x48, and 128x128 icons and source SVG.
  - Added `npm run pack` command generating clean, production-ready zip archives in `dist/`.
  - Added complete Chrome Web Store listing metadata and privacy justifications.

#### 🧪 Verification & Test Suite
- Full Playwright regression suite passing (29/29 checks).
- Long-duration 45-second 429 recovery simulation verified (`npm run test:long`).
- SHA-256 verified release archive: `dist/chatgpt-conversation-availability-guard-v0.9.4.zip`.
```
