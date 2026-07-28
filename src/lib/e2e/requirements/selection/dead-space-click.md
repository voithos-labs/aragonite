# Feature: clicks in the editor's dead space place a caret

The editor root's own padding beside a block, and the empty area below the last
block, are the editor's surface too. A click there used to move focus to the root
and place no caret at all — a click that visibly did nothing. Standard editor
behaviour (CodeMirror, Obsidian) is to land the caret on the nearest text.

## Happy paths

- Click below the last block: the caret lands at the end of the last block's content,
  and the next typed character appends there.
- Click in the right margin beside a line: the caret lands at the end of THAT line,
  not at the end of the block.
- Click below a document ending in a list: the caret lands at the end of the last item.

## Edge cases

- A drag-select that ends in the margin keeps its selection — the click does not
  collapse it to a caret.
- Shift+click in the margin is left alone (it belongs to selection extension, not to
  caret placement).
- A document ending in a thematic break declines: a rule holds no character position,
  so the click must not hand it the whole-block focus that a click ON the rule means.
- A document ending in a table also declines — a table addresses cells, not characters
  (see docs/issues.md). Not covered here: the browser's own click handling already
  places a caret in the nearest cell, so the decline is not separately observable.
