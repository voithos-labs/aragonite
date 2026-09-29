# Feature: Virtual rendering, a change inside a container holding the top is corrected once

The sibling of `vr-nested-growth`, for changes that aren't an image arriving:
a window resize that re-wraps everything, typing that re-wraps a block, and a
keyboard edit that adds a block. Each one lands in several height tables at
once (the block's own list, the container's, the root's), and they all join
the one round the editor opened on the first of them, so the page moves by
the change once.

Driven on `/test/editor` over the same windowed document as `vr-nested-growth`,
a container at root index 30 and the viewport's top 5px into its child 6.
Scroll writes are counted by watching the editor's own `scrollTop`.

Miss-analysis: every red row the slice wrote first grew an image, the one
change that already arrived as a single round, so nothing drove a rebuild or
an edit's re-measure with a container holding the top, and a window resize
went from one scroll write to seventeen with the block you were reading
unmounted.

## Happy paths

- the window narrows from 1000px to 640px with a 40-paragraph blockquote
  holding the top: its child 6 stays within 1px of where it was, with at most
  two scroll writes, the rebuild's and the estimate error of the blocks the new
  width mounts (red before the fix: 171px off; red on the second cut: 44px off)
- the same with a 40-item list: item 6's first block stays within 1px, at most
  two writes (red before the fix: 307px off; red on the second cut: the block
  scrolled out)
- typing a line's worth of words into child 1 of a 40-paragraph blockquote,
  the caret there and above the top: child 6 stays within 1px, one scroll write
  (red before the fix and on the second cut: 179px off, the growth corrected
  twice)
- typing into the second block of item 1 of a 10-item list, above the top: the
  editor writes the scroll once, by the block's growth (red before the fix: no
  write; red on the second cut: three writes). The browser also moves the page
  by itself here before the correction, so this row counts the editor's writes
  rather than reading a block's position

## Edge cases

- Enter at the start of child 6 of a 10-paragraph blockquote, the caret there:
  the empty half keeps the block's place under its id and the text moves down
  one block, so child 6 stays within 1px, everything below moves by the new
  block, and nothing scrolls (green before the fix and on the second cut; kept
  as a pin, since a key edit lands where the caret is and a caret above the top
  is revealed first)

## Error cases

- no page errors surface during the load, the change or the corrections
