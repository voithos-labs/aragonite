# Feature: Block decorations

A `block` decoration dresses a whole block host: the source-supplied class and attrs land on
the `[data-block-path]` div, and an optional `badge` widget mounts as the host's first child
(before the block component), non-editable, wrapped in `.decoration-badge`. The host stays a
fully functional editing surface — decorations are view-only chrome, never content.

## Happy paths

- A block decoration with a class and attrs puts both on the block's host div
- A `buildDom` badge renders inside a `.decoration-badge[contenteditable="false"]` wrapper
  that is the host's first child, before the block component

## Edge cases

- Invalidating the source with a changed class and attrs removes the old ones and applies
  the new (the applied-keys cleanup path)
- Disposing the source removes its class, attrs, and badge
- A decorated block still edits normally: typing lands in the source, and Enter splits the
  block — the badge (first host child) must not capture focus or caret placement
