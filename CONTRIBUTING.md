# Contributing and testing

Bug reports and reproducible measurements are welcome.

For HTTP 429 / “Too Many Requests” / «Этот чат недоступен» reports, use the 429 issue template and include the popup's **Copy safe diagnostics** output.

Do not include conversation text, private chat URLs, cookies, authorization headers, account tokens, or conversation IDs.

Pull requests should keep fixes isolated by failure mode. A 429 fix should not change unrelated message sending, uploads, model requests, or other ChatGPT traffic without separate evidence and tests.

Before opening a PR:

```bash
npm ci
npx playwright install chromium
npm test
```

The automated workflow runs on GitHub-hosted infrastructure with read-only repository permissions.
