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

## Pinned below the browser

These press the plain-prose keys over a range across two blocks, without a page:

- Enter splits at the merge target and Shift+Enter writes a hard break there: each deletes the
  range first and runs at the collapsed caret. Ctrl+2 makes both blocks level-2 headings and
  Ctrl+0 strips them, deleting nothing and keeping the range
  (`test/selection/cross-block/range-command-keys.test.ts`,
  `test/selection/cross-block/keydown-command-candidates.test.ts`).
- Ctrl+B marks each block's own span, deletes nothing, and the range survives the press, which is
  what keeps it off shifted indices; a delete there is the `****` regression (#107)
  (`test/selection/cross-block/keydown-command-candidates.test.ts`).
- Tab over two paragraphs deletes nothing and keeps the range
  (`test/selection/cross-block/range-indent.test.ts`).

## Scenarios

### 1. A line break with a table-start cross-block selection lands where text would

Drag from a mid-row table cell out to a heading below so the table is the
start of the cross-block range; press Enter. The range deletes (the covered
body rows are removed) and the break lands where text typed over the range
would: an empty paragraph under the header row the removal kept, never a row
of the table and never dropped at the table wrapper. The grid stays
well-formed and the next keystroke writes in that paragraph.

### 2. A command key over a whole table, row or column removes it first

Drag over a whole body row, a whole column, or every cell of the table, then press
Enter. The row, column or table goes the way it goes on Backspace, and the key runs at the
caret that's left, so each ends exactly as Backspace and then the key would. One Ctrl+Z puts
the document back as it was. Ctrl+2 over the same grid changes nothing and the selection
stays: a cell takes no heading. Tab over the same grid changes
nothing, since a table has nothing to indent. Miss-analysis: every scenario above drew prose
or a range leaving a table, so nothing pressed a command key over a grid held whole, where
the key cleared the cells and ran in the first one instead.

### 3. After a range longer than the screen, the caret's block is in view

Put the caret in the first of 160 one-line paragraphs, press Shift+ArrowDown 40 times, then press
Shift+Enter. It writes in place, so the key places no caret of its own, and the block holding the
caret is on screen afterwards. Miss-analysis: every range in this file fit on one
screen, so nothing noticed a key that writes in place leave its caret hundreds of pixels above the viewport
once the removal stopped landing its caret.

### 4. Enter over blocks held whole runs where the caret lands

Put a heading, two rules and a paragraph in a row, select both rules whole, and press Enter.
The rules go, the caret lands at the end of the heading above them, and Enter splits the
heading there, so a new empty paragraph sits between the heading and the paragraph. The key
is read in the heading's keymap, the block it runs in. Miss-analysis: no scenario took blocks
whole between neighbours of different kinds, so nothing held the block a key is claimed by to
the one its removal lands in.
