# Harness: the fixture sees uncaught errors

The fixture fails any spec that provokes an uncaught error, so specs assert none of their own. A
thrown error or rejection arrives as a Playwright `pageerror`. Chromium reports some failures, a
ResizeObserver loop among them, only to `window.onerror`; the fixture relays those too. A spec
claims either kind by its message in `expectPageErrors`.

## Happy paths

- an uncaught thrown error fails the spec at teardown, with no assertion in the spec
- an onerror-only error nobody claims fails the spec at teardown
- a claimed onerror-only error passes, and the claimed message must fire
- a claimed uncaught thrown error passes
