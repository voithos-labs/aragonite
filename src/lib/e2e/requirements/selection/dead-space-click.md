# Feature: clicks in the editor's dead space place a caret

The editor's own padding beside a block, and the empty area below the last block,
are the editor's surface too. A click there used to move focus to the root and
place no caret at all — a click that visibly did nothing. Standard editor
behaviour (CodeMirror, Obsidian) is to land the caret on the nearest text.

Dead space is the root AND the block lists inside it: a host that widens or pads
the block list moves the whole visible side gutter onto the list, so a gesture
claiming only root-targeted clicks leaves that band inert.

## Happy paths

- Click below the last block: the caret lands at the end of the last block's content,
  and the next typed character appends there.
- Click in the right margin beside a line: the caret lands at the end of THAT line,
  not at the end of the block.
- Click below a document ending in a list: the caret lands at the end of the last item.
- Click below a table: the caret lands at the end of the geometrically nearest cell of
  the last row. The end-of-document gesture aims at the block box's trailing corner,
  so that is the last row's last cell.
- Click beside a table: y picks the row and x picks the column, so a click level with a
  middle row lands in that row — not in the table's last cell.
- Click in the block list's own padding under a host layout that pads it
  (`?paddedList=on`): the caret lands at the end of that line, same as the root's padding.
- Click beside a line that ends at an atomic widget (an image-only paragraph): the caret
  lands on the widget's trailing edge and the synthetic caret paints there — the same
  answer a click INSIDE the block at that point gives. The probe point is clamped into the
  block's box, so the surface answers it as it answers a click; the landing offset was
  always right, it was the visual representation that was missing.

## Edge cases

- A drag-select that ends in the margin keeps its selection — the click does not
  collapse it to a caret.
- Shift+click in the margin is left alone (it belongs to selection extension, not to
  caret placement).
- A document ending in a thematic break declines: a rule holds no character position,
  so the click must not hand it the whole-block focus that a click ON the rule means.
- A kind that addresses its own internals but declares no caret landing still declines,
  and declines before ending any live range — a rejected click must leave the selection
  exactly as it found it.
- A drag-select released in a padded list's gutter keeps its selection: the press half
  of the gesture discriminates, since the release reports the list either way.
- The band scan is root-wide, so a click in a NESTED list's gutter resolves the nearest
  line document-wide rather than within that container. Geometrically that is the line
  the click is level with, so the answer is the same one; no separate rule.
- A landing down the deep door (a table cell) is handed the same point, but the cell
  surface paints no synthetic indicator of its own, so only the caret moves. The routing
  is unit-pinned (`test/selection/dead-space-caret-routing.test.ts`), not asserted here.
- The point the surface answers is clamped to the block's box edge, so it opens a
  reveal-capable island's source only when the island itself reaches that edge — the same
  answer a click on the island gives, since both ask the same point-in-rect question.

## Miss-analysis

- The host-padded-list band went unclaimed because every fixture used the demo's default
  layout, where the whole gutter belongs to the root — the suite never exercised a host
  that restyles `.block-list`, though host layouts are a documented consumer surface.
- The widget-edge landing had no visual representation because every test here asserted
  the landed OFFSET (type a character, read the source), which was never wrong. Nothing
  asked whether the caret could be seen, and at an element-level position beside an atomic
  island only the synthetic indicator answers that.
