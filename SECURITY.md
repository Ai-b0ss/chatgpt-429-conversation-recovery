# Security and privacy

ChatGPT 429 Guard is a browser extension that changes a narrow part of ChatGPT conversation-read retry behavior. It does not bypass authentication, account limits, or OpenAI rate limits.

## Extension permissions

The release requests only:

- `storage` — bounded local diagnostic counters/events;
- `webRequest` — passive status/error observation;
- host access to `https://chatgpt.com/*`.

It does not request cookie, download, native-messaging, identity, browser-management, or all-sites access. The code contains no external telemetry endpoint.

## Data handling

The extension does not store conversation text, response bodies, cookies, authorization headers, full request URLs, or conversation IDs. Diagnostics stay in the browser unless the user explicitly copies them.

## Supply-chain controls

- GitHub Actions run only on GitHub-hosted `ubuntu-latest` runners, never on the maintainer's PC.
- Workflow permissions are explicitly read-only.
- GitHub Actions are pinned to full commit SHAs.
- Checkout does not persist the workflow GitHub token.
- Repository secrets and Actions variables are not used.
- GitHub secret scanning and push protection are enabled.
- Dependabot security updates are enabled.
- Release ZIPs are built from committed Git objects and ship with SHA-256 checksums.

## Installing safely

Install only from this repository's Releases page or build directly from the public source. Verify the published SHA-256 if the archive came through another channel.

Like any extension that runs code on a website, a maliciously modified build could be dangerous. Do not install repacked copies from third-party file hosts.

## Reporting security issues

Do not put cookies, authorization headers, account tokens, private conversation URLs, conversation IDs, or conversation contents in public issues. For a suspected security issue, open a minimal issue without sensitive details and ask for a private contact channel.
