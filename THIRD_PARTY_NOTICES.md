# Third-party notices and research references

ChatGPT Stream Recovery is MIT-licensed. The current ChatGPT 429 Guard implementation does not bundle third-party libraries at runtime.

During v0.8.2 hardening, the following MIT-licensed projects were reviewed as engineering references:

- **Triage** by Nasir Yar Khan — https://github.com/NASIRCISSISTIC/chatgpt-triage
- **ChatGPT Tool Suite** by ch040602 — https://github.com/ch040602/chatgpt-tool-suite-chrome-extension
- **chatgpt-lag-fixer** by blankTwo — https://github.com/blankTwo/chatgpt-lag-fixer
- **chatgpt-Long-conversation-optimization** by walter-la — https://github.com/walter-la/chatgpt-Long-conversation-optimization

Their source was used to study patterns such as rate-limit cooldowns, fail-open browser patches, long-conversation handling and testing strategy. The v0.8.2 429 Guard changes were independently implemented for this repository.

Repositories without an explicit compatible license may be studied for observable behavior and public documentation, but their source is not copied into this project. See `docs/upstream-tech-audit.md` for the recorded audit and exact commits reviewed.
