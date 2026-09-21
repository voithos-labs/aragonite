# Feature: Table block, keyboard vocabulary

## Happy paths

- Ctrl+Enter inserts a new empty row below the current row; focus lands in the first cell of the new row.
- Ctrl+Shift+Enter inserts a new empty row above the current row; focus lands in the first cell of the new row.
- Alt+Shift+ArrowRight inserts an empty column to the right of the current column; the focused cell shifts to the new column.
- Alt+Shift+ArrowLeft inserts an empty column to the left of the current column.
- Ctrl+Shift+Backspace deletes the current row when the table has at least two body rows.
- Alt+Shift+Backspace deletes the current column when the table has at least two columns.
- Ctrl+Shift+A cycles the current column's alignment. `'none'` (delimiter `---`) renders identically to `'left'` (delimiter `:---`), so the first press from `none` jumps straight to `center` (`:---:`) to avoid an invisible step. After that the cycle is `left → center → right → left → ...` (`:---` / `:---:` / `---:`); `none` is not re-entered once cycling has begun.
- Ctrl+Alt+↑ / Ctrl+Alt+↓ moves the whole table one position among its siblings; the bare Alt+↑/↓ keeps
  meaning "move this row", so at the header boundary it does nothing rather than moving the block. The
  chord is the platform-modifier version of the reorder gesture every other kind puts on Alt+↑/↓,
  which a caret in a cell cannot use because the row reorder has taken it.
- Ctrl+Alt+↑ into a gap whose neighbors had no blank line between them (a heading interrupting the
  paragraph above it) lands the table with one: it stays a table rather than becoming the
  paragraph's next lines, and the source reloads to the same three blocks.
- Shift+Enter inside a cell inserts a literal `<br>` at the cursor. GFM cells can't carry raw newlines, so the proper representation is `<br>`. Round-trip preserves the `<br>` bytes. This file pins the bytes the insertion writes; the rendered line break is `cell-line-break.spec.ts`.

## Edge cases

- Ctrl+Shift+Backspace does nothing when only one body row remains.
- Alt+Shift+Backspace does nothing when only one column remains.
- Ctrl+Shift+Backspace on the header row (row 0) promotes the next row to be the new header.

## Notes on ownership

- Every chord above is a `tableCell` keymap binding, resolved through the same override-aware
  dispatcher as every other kind's, so the consumer `keybindings` prop can disable or rebind it
  (scoped to `tableCell`, since the cell holds the caret, not the table). Cell arrow navigation and the
  two-stage Ctrl+A (the cell's text, then the document, with no table stage, matching every other
  block and the standard editors) stay off the keymap: both read where the caret sits inside the cell.

## User interactions

- Each structural change a shortcut makes is a single undo entry: one Ctrl+Z press restores the prior state.
- After delete-column followed by undo, the rendered per-cell alignments must match the state before the delete, so the live metadata is restored, not just the markdown source.
- A delete-undo-delete-undo cycle restores all the way to the original. Per-row child IDs live on the container nodes, so the deep-cloned snapshot restores them in step with `children`, keeping Svelte's keyed-each in sync across repeated structural-undo cycles.

## Notes

- Tab on the last cell of the last row creating a new row is verified in `navigation.spec.ts`.
