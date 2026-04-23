# Feature: typing inside a nested list item — Ctrl+Z reverts exact keystrokes

## Happy paths

- Focus a paragraph inside a list item, type 5 chars, wait for debounce, Ctrl+Z: the 5 chars revert; source returns to pre-typing state exactly.

## Edge cases

- Two nested-item typings separated by focus change between items: each list item owns its own batch.
- Two nested-item typings with focus change between them happening before the 250ms debounce fires: each list item still owns its own batch (focus change is a batch boundary, independent of debounce timing).
- Typing inside a blockquote-in-list (2-level container nesting): same semantics.

## Regression notes

- Exercises `beginContainerEditDebounced` path; distinct from top-level typing debouncer.
- Sibling-leaf batch breaks key on the leaf block's id, not the outer container's index — without that, all leaves inside one container share a batch.
