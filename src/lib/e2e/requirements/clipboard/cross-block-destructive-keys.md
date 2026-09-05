# Feature: cross-block destructive-key dispatch (A1)

Regression guard for the cross-block selection + destructive-key gap
(forge-review finding A1). Before this fix, `handleCrossBlockActive`
intercepted only Backspace/Delete/arrows/Escape/Ctrl+A; Enter, Shift+Enter,
Tab, Ctrl+B/I, and Ctrl+0..6 fell through to the originating block's
onKeyDown, which applied the op to one single-block raw while the
cross-block selection visually persisted over stale block indices.

The invariant asserted by these tests: when a cross-block selection is
active and the user presses a delete-then-dispatch key, the selection
collapses (range deleted), the caret lands at the merge target, and the
key's normal block-level behavior runs at the collapsed caret — producing
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
key is NOT a delete-then-dispatch key: the range is not deleted, and each
block the range touches is marked over its own span — the anchor block's
tail, the focus block's head — as one undo entry. The cross-block selection
survives the press, which is what keeps it off shifted indices; a delete
here is the `****` regression (#107) this file was written for.

### 4. Ctrl+0 strips heading prefix at the merge target

Load a document whose first block is a heading and second is a paragraph.
Select from mid-heading to mid-paragraph; press Ctrl+0. The range deletes
and Ctrl+0's "strip heading prefix" logic runs on the merged block.

### 5. Ctrl+2 sets heading level on the merged block

Load plain paragraphs. Select from mid-first to mid-second; press Ctrl+2.
The range deletes, the merged block becomes an H2 heading.

### 6. Tab in the middle of a paragraph selection inserts a literal tab

Plain paragraphs (no list). Select from mid-first to mid-second; press
Tab. The range deletes, Tab inserts a literal `\t` at the collapsed
caret inside the merged paragraph.

### 7. Selection collapses regardless of key outcome

For every delete-then-dispatch key, after the key press the editor is no
longer in cross-block mode (no `[data-cross-block]` attribute on the
editor root). This pins the Theme A symptom — the stale selection rendered
over mutated block indices.

### 8. Command key with a table-start cross-block selection reaches the cell

Drag from a mid-row table cell out to a paragraph below so the table is the
start of the cross-block range; press Enter. The range deletes (the covered
body rows are removed) and the dispatcher reveals the delete's own
post-delete caret — a deep table cell — so the cell's Enter command runs
(a row is inserted below) instead of being silently dropped at the table
wrapper. The grid stays well-formed and the next keystroke lands in a cell.
