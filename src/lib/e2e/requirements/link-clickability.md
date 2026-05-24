# Feature: Link clickability

Covers click behavior on rendered inline links and autolinks: modifier-click navigates, plain click stays in-editor for cursor placement.

## Happy paths

- Ctrl+click on an inline `[text](url)` link opens the URL in a new tab.
- Ctrl+click on a bare-URL autolink (promoted from `<span>` to `<a>`) opens the URL in a new tab.
- Ctrl+click on an email autolink invokes `window.open` with the `mailto:` URL.

## User interactions

- Plain click (no modifier) on a link does not navigate — the click is intercepted so the caret can be placed inside the link text.
