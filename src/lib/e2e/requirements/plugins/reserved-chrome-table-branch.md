# Feature: Reserved-child-0 Chrome Wall × Table Branch

The `:::callout` callout reserves child index 0 as an editable `callout-title` leaf. This file
proves that a range delete still stops at it when one endpoint of the range is a table cell,
since the table branch is dispatched before the title branch. The checks read behavior: the tree
and the selection read by path through `window.__test`, not visuals.

## Gate 6: chrome wall × table branch (must pass)

A range with a table endpoint goes to the table branch before the title branch, so the rule has
to hold there too: a covered title is emptied, a title at an endpoint is truncated where it is,
and a container the range covers entirely is deleted as one unit.

- substrate: a table in the callout body parses as a real child, so the callout is a title plus a table
- in between, from prose into a body table cell: the title is emptied in place to an empty callout-title, the table snaps to whole rows as it always does, nothing is lifted into the opener line, and undo restores the title at the child level
- the range starts in the title, mid-title into a body table cell: the title is truncated by a raw write, so its node and kind survive and nothing is replaced by a reparse, the caret stays in the title, and undo restores at the child level
- the range ends in the title, from a table above into mid-title: the title keeps the tail the range missed, in its own leaf, and the table the range starts in snaps to whole rows
- table to table across the title: the title strictly in between is emptied rather than deleted as a node, which the shared deletion collection already covers
- the whole subtree covered by a range involving a table: the container is removed as one splice with its children intact, and undo restores the title and the body together
- the state audits cover table state too: a delete that snaps to whole rows commits the endpoint table as its own block list, so its row ids and references stay in step with its children

## User interactions

- pointer drags (cell to cell, prose to cell), Delete and Ctrl+Z are real gestures; the assertions read the tree and the selection by path, never the shape of the DOM
