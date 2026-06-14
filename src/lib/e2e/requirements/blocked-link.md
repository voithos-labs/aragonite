# Feature: Blocked-scheme links

A rendered link or autolink whose (post-`resolveLinkUrl`) scheme is not allowlisted is neutralized at the render sink so it cannot execute or navigate.

## Error cases

- A link with a blocked scheme (`javascript:`, `data:`, `vbscript:`, `file:`) renders as an inert `span.md-link-blocked` (markers and text preserved), not an `<a>`.
- Ctrl+click on a blocked-scheme link does not navigate (no popup fires).
