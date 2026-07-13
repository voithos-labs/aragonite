# Feature: generic directive leaf render + edit

A `::name info` line (exactly two colons) has no first-class plugin kind, so it
falls back to the generic `directiveLeaf`: a single editable line whose `::name`
fence renders as a dimmed marker and whose info is ordinary editable text. Editing
the info round-trips byte-for-byte; the leaf is single-line and not-mergeable.

## Happy paths

- `::toc info` renders as a `directiveLeaf` block (not a container, not a raw fallback): a dimmed `::toc` marker is shown and the ` info` remainder sits in the same editable line.

## User interactions

- Type at the end of the info (real keyboard): the leaf's raw updates and the source round-trips the edit byte-for-byte; the document root stays a single block.
- Enter at the end of the info: a paragraph sibling is added below the leaf (document root grows to two blocks, the second a `paragraph`); the leaf keeps its single line — no in-leaf break.

## Error cases

- The leaf is not-mergeable: Backspace at the start of a leaf sitting below a paragraph moves focus but does not concatenate the two blocks — the document root stays two blocks and the source is unchanged.
