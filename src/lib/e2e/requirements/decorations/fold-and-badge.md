# Feature: decoration fixtures — fold (replace) + block-badge (block)

Two fixture plugins that pin the remaining decoration types end-to-end on
public doors only. `fold` scans prose leaves for `[>…<]` delimiters and covers
each range with a clickable `…` replace island (interactive DOM inside an
island is native); `block-badge` puts a class and a badge widget on every
heading host. Scenarios run on `/test/plugins?seed=fold` / `?seed=fold-table` /
`?seed=badge`.

## Happy paths

- a delimited range renders as one `…` island; the hidden bytes leave the DOM
  text but never leave `getSource()`
- clicking the `…` island opens the fold: the island unmounts and the full text
  (delimiters included) is visible again, source unchanged
- heading blocks carry the badge class and a badge widget as the host's first
  child; non-heading blocks carry neither

## User interactions

- typing in the block next to a folded range commits around the island: the
  typed bytes land and the folded bytes survive in `getSource()`

## Edge cases

- a badge survives a block windowing out and back in on a multi-MB fixture
- islands-in-cells: a fold range inside a table cell renders one `…` island —
  the cell surface applies island decorations like the prose path — the covered
  bytes leave the DOM text but never leave `getSource()`, and the source seam
  raises no cells-unsupported dev-warn
- an edge press selects the cell fold island whole and a second deletes its
  covered range; the fixture's fixed-offset source then provides a range the
  shortened cell no longer holds, which the engine skips and reports on the
  `decorations` channel, so the spec declares that tag
