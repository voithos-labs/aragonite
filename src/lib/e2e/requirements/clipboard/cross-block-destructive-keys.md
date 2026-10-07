# Feature: cross-block destructive-key dispatch (A1)

Regression guard for the cross-block selection and destructive-key gap
(forge-review finding A1). The defect: `handleCrossBlockActive`
intercepted only Backspace/Delete/arrows/Escape/Ctrl+A, so Enter, Shift+Enter,
Tab, Ctrl+B/I, and Ctrl+0..6 fell through to the originating block's
`onKeyDown`, which applied the op to one block's raw while the cross-block
selection stayed painted over stale block indices.

The invariant asserted by these tests: when a cross-block selection is
active and the user presses a delete-then-dispatch key, the selection
collapses (range deleted), the caret goes to the merge target, and the
key's normal block-level behavior runs at the collapsed caret, producing
the same end state as (a) pressing Backspace and then (b) pressing the
key, in one undo unit.

## Scenarios

### 1. Enter splits at the merge target, not the originating block

Select from mid-first-paragraph to mid-second-paragraph; press Enter. The
range is deleted (as with Backspace), then Enter splits the merged block
at the collapsed caret, producing two blocks where the merged block would
have been.

### 2. Shift+Enter inserts a hard line break at the collapsed caret

Select from mid-first-paragraph to mid-second-paragraph; press Shift+Enter.
The range is deleted and a trailing `\` is inserted at the collapsed caret
inside the merged paragraph (GFM hard line break).

### 3. Ctrl+B marks each block's own span and does not delete the range

Select from mid-first-paragraph to mid-second-paragraph; press Ctrl+B. This
key is not a delete-then-dispatch key: the range is not deleted, and each
block the range touches is marked over its own span (the anchor block's
tail, the focus block's head) as one undo entry. The cross-block selection
survives the press, which is what keeps it off shifted indices; a delete
here is the `****` regression (#107) this file was written for.

### 4. Ctrl+0 strips heading prefix at the merge target

Load a document whose first block is a heading and second is a paragraph.
Select from mid-heading to mid-paragraph; press Ctrl+0. The range deletes
and Ctrl+0's "strip heading prefix" logic runs on the merged block.

### 5. Ctrl+2 sets heading level on the merged block

Load plain paragraphs. Select from mid-first to mid-second; press Ctrl+2.
The range deletes, the merged block becomes an H2 heading.

### 6. Tab over a paragraph selection deletes nothing

Plain paragraphs (no list). Select from mid-first to mid-second; press
Tab. Nothing happens: Tab isn't a delete-then-dispatch key. Over a selection
it indents the list items and code lines in it (`selection/range-indent.md`),
and two paragraphs have neither. The selection stays.

### 7. Selection collapses regardless of key outcome

For every delete-then-dispatch key, after the key press the editor is no
longer in cross-block mode (no `[data-cross-block]` attribute on the
editor root). This pins the Theme A symptom: the stale selection rendered
over mutated block indices.

### 8. Command key with a table-start cross-block selection reaches the cell

Drag from a mid-row table cell out to a paragraph below so the table is the
start of the cross-block range; press Enter. The range deletes (the covered
body rows are removed) and the dispatcher mounts the caret the delete left,
a cell deep in the table, so the cell's Enter command runs
(a row is inserted below) instead of being silently dropped at the table
wrapper. The grid stays well-formed and the next keystroke lands in a cell.

### 9. A command key over a whole table, row or column removes it first

Drag over a whole body row, a whole column, or every cell of the table, then press
Enter, or Ctrl+2 over the whole table. The row, column or table goes the way it goes on
Backspace, and the key runs at the caret that's left, so each ends exactly as Backspace and
then the key would. One Ctrl+Z puts the document back as it was. Ctrl+2 over a whole row or
column changes nothing and the selection stays: the caret would land in a cell, and a cell
binds no Ctrl+2, so the key isn't a command key there. Tab over the same grid changes
nothing, since a table has nothing to indent. Miss-analysis: every scenario above drew prose
or a range leaving a table, so nothing pressed a command key over a grid held whole, where
the key cleared the cells and ran in the first one instead.

### 10. After a range longer than the screen, the caret's block is in view

Put the caret in the first of 160 one-line paragraphs, press Shift+ArrowDown 40 times, then press
Shift+Enter. It writes in place, so the key places no caret of its own, and the block holding the
caret is on screen afterwards. Miss-analysis: every range in this file fit on one
screen, so nothing noticed a key that writes in place leave its caret hundreds of pixels above the viewport
once the removal stopped landing its caret.

### 11. Enter over blocks held whole runs where the caret lands

Put a heading, two rules and a paragraph in a row, select both rules whole, and press Enter.
The rules go, the caret lands at the end of the heading above them, and Enter splits the
heading there, so a new empty paragraph sits between the heading and the paragraph. The key
is read in the heading's keymap, the block it runs in. Miss-analysis: no scenario took blocks
whole between neighbours of different kinds, so nothing held the block a key is claimed by to
the one its removal lands in.
