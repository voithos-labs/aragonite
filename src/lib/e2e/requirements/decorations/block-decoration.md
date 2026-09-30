# Feature: Block decorations

A `block` decoration applies to a whole block host: the class and attributes the source
supplies land on the `[data-block-path]` div, and an optional `badge` widget mounts as the
host's first child (before the block component), non-editable, wrapped in
`.decoration-badge`. The host stays fully editable, because decorations are view-only and
never content.

## Happy paths

- A block decoration with a class and attributes puts both on the block's host div
- A `buildDom` badge renders inside a `.decoration-badge[contenteditable="false"]` wrapper
  that is the host's first child, before the block component

## Edge cases

- Invalidating the source with a changed class and attributes removes the old ones and
  applies the new (the cleanup path that tracks which keys were applied)
- Disposing the source removes its class, attributes, and badge
- A decorated block still edits normally: typing lands in the source, and Enter splits the
  block. The badge, as the host's first child, must not capture focus or caret placement
- An attribute spelling one of the editor's own `data-` names is refused, because the host
  is an ancestor of every container the offset traversal walks and would answer lookups
  that traversal and the CSS make. The same decoration's other attributes still land, and
  the refusal reports itself on the `decorations` dev-warning channel rather than dropping
  the attribute silently
- A `data-content-empty` attribute reaching the host anyway paints no marker in live mode:
  the CSS override is scoped to the same container element the JavaScript check reads

## Miss-analysis

- The attribute write had no validation and no scenario named the hazard, so the mismatch
  it opens between the CSS and the JavaScript was invisible to the parity check that exists
  to catch exactly that
