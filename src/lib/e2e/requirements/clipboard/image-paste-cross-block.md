# Feature: image paste over a cross-block selection

An image paste replaces a multi-block selection, like every other paste route. The
range is deleted and the markdown the host hook returned is inserted at the collapsed
caret. Placement inside a single block is its own concern — `image-paste.md`, which
also carries the Playwright synthetic-paste exception these specs inherit.

The arm delegates to the cross-block seam rather than to the surface that received the
event, because that delete collapses start-wins: the receiving block is the one merged
away whenever the caret sat in the focus block (what a mouse drag does). The seam
addresses the survivor by path.

## Happy paths

- Caret at the end of the first paragraph, selection extended two blocks down, image
  pasted: the covered blocks are gone, the markdown stands at the collapse point, and
  the document is one block.
- A selection anchored in a table cell is replaced too — the covered body row goes.

## User interactions

- One Ctrl+Z restores the whole selection AND removes the markdown: the delete and the
  insertion are one undo entry, not two.
- Typing after the paste continues from the end of the inserted markdown.

## Edge cases

- The cross-block mode is cleared by the replacement, so the next gesture acts on fresh
  offsets rather than a range whose endpoints shifted by the inserted length.
- A multi-block selection made _while_ the import is still in flight is the one that
  gets replaced — the branch reads the selection live, because the seam it delegates to
  resolves endpoints by path at call time. This is a deliberate asymmetry with the
  intra-block branch, which honours the caret held when the paste fired.
- Mirror of the above: a cross-block selection collapsed before the import lands falls
  through to the intra-block path and inserts at the caret captured at paste time.
  Pinned by `test/blocks/editable-surface-image-paste.test.ts`.
- The hook still decides first: an import that returns `null` for every image destroys
  nothing — the selection is only replaced once there is markdown to insert. The
  rejects half of that guarantee shares the same code path and is pinned against a
  single-block caret in `image-paste.md`.

## Route parity

- The document produced by an image paste over a cross-block selection is
  byte-identical to pasting the same string as ordinary text over the same selection.
  This is the pin that says the arm _inherits_ the cross-block route rather than
  placing anything itself.
