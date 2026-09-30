# Feature: generic directive leaf render + edit

A `::name info` line (exactly two colons) has no kind of its own, so it falls back to the
generic `directiveLeaf`: a single editable line whose `::name` fence renders as a dimmed marker
and whose info text is ordinary editable text. Editing the info round-trips byte for byte; the
leaf is one line and never merges with a neighbor.

## Happy paths

- `::toc info` renders as a `directiveLeaf` block, neither a container nor a fallback to raw text: a dimmed `::toc` marker is shown and the rest, ` info`, sits in the same editable line.

## User interactions

- Type at the end of the info (real keyboard): the leaf's raw text updates and the source round-trips the edit byte for byte; the document root stays a single block.
- Enter at the end of the info: a paragraph is added below the leaf, so the document root grows to two blocks with the second a `paragraph`, and the leaf keeps its single line rather than breaking inside itself.

## Error cases

- The leaf never merges: Backspace at the start of a leaf sitting below a paragraph moves focus but does not join the two blocks, so the document root stays two blocks and the source is unchanged.
