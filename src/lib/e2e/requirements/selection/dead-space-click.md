# Feature: clicks in the editor's dead space place a caret

The editor's own padding beside a block, and the empty area below the last block,
are part of the editor too. A click there must not move focus to the root and
place no caret, which reads to the user as a click that did nothing. Standard
editor behaviour (CodeMirror, Obsidian) is to land the caret on the nearest text.

Dead space is the root and the block lists inside it: a host that widens or pads
the block list moves the whole visible side gutter onto the list, so a handler
that takes only root-targeted clicks leaves that strip dead.

## Happy paths

- Click below the last block: the caret lands at the end of the last block's content,
  and the next typed character appends there.
- Click in the right margin beside a line: the caret lands at the end of that line,
  not at the end of the block.
- Click below a document ending in a list: the caret lands at the end of the last item.
- "Below" starts under the trailing row: the strip directly beneath the last block belongs
  to the "add a line below" row, whose click appends a paragraph instead (its own contract,
  not this file's), and the dead-space rule holds for everything under it.
- Click in the block list's own padding under a host layout that pads it
  (`?paddedList=on`): the caret lands at the end of that line, same as the root's padding.
- Click beside a line that ends at an atomic widget (an image-only paragraph): the caret
  lands on the widget's trailing edge and the editor's own caret paints there, the same
  answer a click inside the block at that point gives. The point is clamped into the
  block's box, so the block answers it as it answers a click, and the painted caret is
  asserted as well as the landing offset.

## Edge cases

- A drag-select that ends in the margin keeps its selection: the click does not
  collapse it to a caret.
- Shift+click in the margin is left alone (it belongs to selection extension, not to
  caret placement).
- A document ending in a thematic break declines: a rule holds no character position,
  so the click must not hand it the whole-block focus that a click on the rule means.
- A click on a block with no character positions (the rule, a folded equation's face)
  focuses that block: the editor takes such a press for its own drag, so a release that
  did not move resolves to the landing the browser's default would have given (the
  divider then answers Alt+Arrow, the equation opens).
- The same for every block with no character positions: a table, a rendered equation, a
  diagram. Prose has a line for a click beside it to land on (Google Docs lands the caret
  on that line, and so does this editor); these do not, so a click that was not on the
  block focuses nothing, whether it is below the table, beside it in the editor's padding,
  or in the host's own padding around it. The click still resets a live range, as every
  margin click does, and nothing lands on the nearest cell, which would focus a table the
  user never clicked.
- A kind that addresses its own internals but declares no caret landing still declines,
  and declines before ending any live range: a rejected click must leave the selection
  exactly as it found it.
- A drag-select released in a padded list's gutter keeps its selection: the press half
  of the gesture is what tells them apart, since the release reports the list either way.
- The scan for the nearest strip covers the whole root, so a click in a nested list's
  gutter resolves the nearest line across the document rather than within that container.
  Geometrically that is the line the click is level with, so the answer is the same one
  and there is no separate rule.
- A landing further down (a table cell) is handed the same point, but a cell paints no
  caret of its own, so only the caret position moves. The routing is pinned in a unit
  test (`test/selection/dead-space-caret-routing.test.ts`), not asserted here.
- The point the block answers is clamped to its box edge, so it opens a reveal-capable
  widget's source only when the widget itself reaches that edge: the same answer a click
  on the widget gives, since both ask the same point-in-rectangle question.

## Miss-analysis

- No handler took clicks in a host-padded list's strip because every fixture used the
  demo's default layout, where the whole gutter belongs to the root: the suite never
  exercised a host that restyles `.block-list`, though host layouts are a documented
  consumer feature.
- The widget-edge landing painted no caret because every test here asserted the landing
  offset (type a character, read the source), which was never wrong. Nothing asked whether
  the caret could be seen, and at an element-level position beside an atomic widget only
  the caret the editor draws answers that.
