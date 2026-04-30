# GitHub PR — Prod vs Tests

A Chrome extension that splits a PR's diff stats into three categories so reviewers can see the real change size:

- **raw** — additions to production code
- **tests** — additions to test files
- **removals** — deletions across both

`raw + tests` matches GitHub's `+additions`. `removals` matches GitHub's `−deletions`.

## Why

Coverage gates (CodeCurve, Codecov, etc.) bloat PRs with test code. The "+1,213 / −456" header makes a 200-line refactor look enormous when most of it is tests. This shows what reviewers actually need to read.

## Install (unpacked)

1. Clone or download this repo.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** → pick the cloned folder.
5. Open any GitHub PR — a pill appears next to the existing diff number.

## Private repos

The extension calls `api.github.com`. For private repos, give it a token:

1. Create a classic PAT at https://github.com/settings/tokens with `repo` scope.
2. If your org enforces SAML SSO, click **Configure SSO** on the token and authorize the org.
3. Open the extension's options page (`chrome://extensions` → Details → Extension options) and paste the token.

Token is stored locally in `chrome.storage.sync`. It never leaves your machine.

## Configure test patterns

Defaults cover `*.test.*`, `*.spec.*`, `__tests__/`, `tests/`, `e2e/`, `*_test.py`, `test_*.py`, `__mocks__/`, `__snapshots__/`, `cypress/`, `playwright/`, `fixtures/`, etc.

Add custom regex patterns (one per line) on the options page to match your repo's conventions.

## License

MIT.
