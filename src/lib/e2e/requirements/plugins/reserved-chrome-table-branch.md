# Feature: Reserved-child-0 title-row wall × table branch

The `:::callout` callout holds its opener line at child index 0, an editable leaf of kind `directiveOpenerLine`. This file
proves that a range delete still stops at it when one endpoint of the range is a table cell,
since the table branch is dispatched before the title branch. The checks read behavior: the tree
and the selection read by path through `window.__test`, not visuals.

## Gate 6: the title-row wall × table branch (must pass)

A range with a table endpoint goes to the table branch before the title branch, so the rule has
to hold there too: a covered title is emptied, a title at an endpoint is truncated where it is,
and a container the range covers entirely is deleted as one unit.

- in between, from prose into the table's header cell: the range enters the table by its first row, so the table goes whole, and the opening it enters stays whole, title and all (a range entering a container from outside keeps its opening); nothing is lifted into the opener line, and undo restores the title at the child level
- the range starts in the title, mid-title into the header cell: the title is truncated by a raw write, so its node and kind survive and nothing is replaced by a reparse, the table goes whole, the caret stays in the title, and undo restores at the child level
- the range ends in the title, from a table's last row above into mid-title: the title keeps the tail the range missed, in its own leaf, and the table the range starts in goes whole, since the range leaves it by its last row
- table to table across the title, from the outer table's last row into the inner one's header: both tables go whole and the opening between them stays, never deleted as a node
- the whole subtree covered by a range involving a table: the container is removed as one splice with its children intact, the table the range starts in by its last row goes whole too, and undo restores the title and the body together
- the state audits cover table state too: a delete that snaps to whole rows commits the endpoint table as its own block list, so its row ids and references stay in step with its children

## User interactions

- pointer drags (cell to cell, prose to cell), Delete and Ctrl+Z are real gestures; the assertions read the tree and the selection by path, never the shape of the DOM
