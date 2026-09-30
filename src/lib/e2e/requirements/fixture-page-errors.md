# Harness: the fixture sees window.onerror

Chromium reports some failures, a ResizeObserver loop among them, only to `window.onerror`, never
as a Playwright `pageerror`. The fixture relays those to its console watch, so they fail the spec
that provoked them unless the spec claims them in `expectPageErrors`.

## Happy paths

- an onerror-only error nobody claims fails the spec at teardown
- a claimed onerror-only error passes, and the claimed message must fire
