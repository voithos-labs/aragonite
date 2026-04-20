# Feature: typing inside a nested list item — Ctrl+Z reverts exact keystrokes

## Happy paths
- Focus a paragraph inside a list item, type 5 chars, wait for debounce, Ctrl+Z: the 5 chars revert; source returns to pre-typing state exactly.

## Edge cases
- Two nested-item typings separated by focus change between items: each list item owns its own batch.
- Typing inside a blockquote-in-list (2-level container nesting): same semantics.

## Regression notes
- Exercises `beginContainerEditDebounced` path; distinct from top-level typing debouncer.
