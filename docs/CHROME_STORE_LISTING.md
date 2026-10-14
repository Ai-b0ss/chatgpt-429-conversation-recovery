# Chrome Web Store Listing & Submission Guide

This document contains the exact store metadata, detailed descriptions (in English and Russian), privacy justifications, and submission checklist required for publishing **ChatGPT Conversation Availability Guard** to the Chrome Web Store.

---

## 1. Store Metadata

### Title
- **English:** `ChatGPT Conversation Availability Guard` (44 / 45 characters)
- **Russian:** `ChatGPT Conversation Availability Guard`

### Short Description
- **English:**
  `Recovers ChatGPT conversations from HTTP 429 and transient gateway errors, preventing "This chat is unavailable" crashes.` (124 / 132 characters)
- **Russian:**
  `Восстанавливает загрузку чатов ChatGPT при ошибках 429 и 5xx, предотвращая сбой «Этот чат недоступен».` (104 / 132 characters)

### Category
- `Productivity` / `Developer Tools`

### Language Support
- English (United States) - Default
- Russian

---

## 2. Store Descriptions

### Detailed Description (English)

```markdown
Tired of seeing “This chat is unavailable” or “Unable to load conversation” after switching tabs or asking long questions?

ChatGPT Conversation Availability Guard is an open-source, privacy-first browser extension designed to protect ChatGPT conversations from crashing during temporary server rate limits (HTTP 429) and transient Cloudflare/gateway timeouts (HTTP 502/503/504).

### The Problem
When OpenAI's backend experiences traffic spikes or temporary rate-limiting, conversation read requests (GET /backend-api/conversation/...) can fail with an HTTP 429 or 504. Under normal browser operation, ChatGPT’s frontend immediately renders a permanent error screen: “This chat is unavailable”, forcing you to refresh repeatedly or lose your flow. In many cases, repeated rapid reloads trigger a client-side retry storm, worsening the rate limit.

### How It Protects You
• Seamless Transparent Recovery: When a safe conversation-read fails due to a transient 429 or 5xx error, the Guard holds the read open, waits for the server’s Retry-After backoff (or a smart jittered window), and retries transparently.
• React 18 Concurrency & Multiplexing: Handles simultaneous component re-renders and StrictMode mounts cleanly. An abort in one background component won't cancel the active recovery for the chat you are looking at.
• Cross-Tab Coordination: Uses browser Web Locks and shared cooldowns to ensure that opening multiple chats doesn't cause a herd effect or trigger fresh rate limits.
• In-App Status Notification: If OpenAI takes longer than 3 seconds to recover, a clean, subtle toast informs you that recovery is in progress—no infinite frozen tabs.
• Zero Modification to Writes: We NEVER replay POST requests, message generation, or prompt submissions. Only safe, idempotent conversation reads are protected.

### Privacy & Security Guarantee
We believe your conversations belong to you:
• 100% Client-Side: The extension runs entirely in your browser. No external telemetry, no analytics servers, and no tracking scripts.
• Zero Data Extraction: The extension never reads, stores, or transmits prompt contents, conversation titles, session tokens, cookies, or conversation IDs.
• Safe Diagnostics: The built-in popup displays local retry metrics and status without exposing sensitive personal identifiers.
• Open Source: Fully auditable MIT-licensed codebase available on GitHub.

Disclaimer: This is an independent open-source project and is not affiliated with, endorsed by, or sponsored by OpenAI.
```

### Detailed Description (Russian)

```markdown
Надоело сталкиваться с ошибкой «Этот чат недоступен» или «Не удалось загрузить этот разговор ChatGPT» при переключении между вкладками или после долгой работы?

ChatGPT Conversation Availability Guard — это открытое (open-source) и полностью конфиденциальное расширение, защищающее загрузку диалогов ChatGPT от сбоев при временных лимитах запросов (HTTP 429) и шлюзовых ошибках Cloudflare (502, 503, 504).

### В чем проблема?
При пиковых нагрузках на серверы OpenAI или при частых запросах чтение диалога (GET /backend-api/conversation/...) может вернуть HTTP 429 или 504. Интерфейс ChatGPT моментально реагирует на это фатальным экраном «Этот чат недоступен». Частые ручные перезагрузки страницы лишь усугубляют ситуацию, вызывая шторм повторных запросов (retry storm).

### Как расширение защищает ваши чаты:
• Прозрачное восстановление: При возникновении временной ошибки 429 или 5xx расширение не отдает ошибку React-интерфейсу, а удерживает запрос, выдерживает корректный backoff с учетом заголовка Retry-After и аккуратно повторяет попытку.
• Совместимость с React 18: Полная поддержка AbortSignal Multiplexing. Если один внутренний компонент интерфейса отменяет подписку, фоновое чтение для отображаемого чата не прерывается.
• Межвкладочная координация: Использование Web Locks исключает одновременную бомбардировку сервера из нескольких вкладок одного браузера.
• Информативные уведомления: Если восстановление занимает более 3 секунд, в углу интерфейса появляется аккуратное уведомление о статусе восстановления — никаких «зависших» экранов в неизвестности.
• Безопасность данных: Расширение защищает ТОЛЬКО безопасные GET-запросы на чтение. Запросы на отправку сообщений (POST), генерацию текста или загрузку файлов никогда не повторяются автоматически.

### Полная приватность и безопасность:
• Работает только локально: Никаких внешних серверов, телеметрии или трекеров.
• Полная конфиденциальность: Расширение не читает и не сохраняет текст диалогов, токены, cookies, заголовки авторизации и ID бесед.
• Открытый исходный код: Лицензия MIT, код открыт для аудита на GitHub.

Примечание: Проект является независимым и не аффилирован с компанией OpenAI.
```

---

## 3. Chrome Web Store Justifications (Reviewer FAQ)

When submitting to the Chrome Web Store Developer Dashboard, Google requires explicit explanations for permissions used. Use the following pre-approved wording:

### Single Purpose Description
> "Protects ChatGPT web application users from conversation loading crashes caused by transient HTTP 429 rate-limiting and 5xx gateway errors by safely coordinating read-request retries and cross-tab cooldowns."

### Permission Justifications

1. **`webRequest` Permission:**
   - **Why needed:** Used exclusively to passively observe HTTP 429/5xx status codes on ChatGPT network responses. This allows the extension to log privacy-safe diagnostic telemetry and coordinate backoff timing across tabs even when requests are initiated by service workers or background scripts.
   - **Safety note:** No network traffic is modified or blocked via `webRequest`. No request bodies, response bodies, cookies, or headers are accessed or captured.

2. **`storage` Permission:**
   - **Why needed:** Used solely with `chrome.storage.local` to persist rate-limit cooldown timestamps and local anonymized retry counters across page refreshes and browser tabs.
   - **Safety note:** Only numeric timestamps and counters are stored. Never contains personal data, URLs, or conversational text.

3. **Host Permissions (`https://chatgpt.com/*`):**
   - **Why needed:** The extension's content scripts must inject into `https://chatgpt.com/*` to wrap client-side `fetch` calls for idempotent conversation reads and display in-DOM recovery notifications.
   - **Narrow Scope:** Host permissions are strictly restricted to `https://chatgpt.com/*`. The extension has no access to any other website or domain.

---

## 4. Visual Assets Checklist

Prepare the following image assets before submitting to CWS:

- [x] **Store Icon:** `extension/icons/icon-128.png` (128x128 PNG, transparent background)
- [ ] **Small Promo Tile:** 440x280 PNG (shows shield icon with "ChatGPT Conversation Availability Guard - Prevent 'Chat unavailable' errors")
- [ ] **Screenshot 1 (1280x800):** ChatGPT interface with the Guard active in the popup, showing recovered 429 count.
- [ ] **Screenshot 2 (1280x800):** Recovery in action showing the subtle toast notice ("Recovering conversation...").
- [ ] **Screenshot 3 (1280x800):** The popup safe diagnostics export window, demonstrating zero private data collection.
