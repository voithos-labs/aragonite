# Feature: Table block — keyboard vocabulary

## Happy paths

- Ctrl+Enter inserts a new empty row below the current row; focus lands in the first cell of the new row.
- Ctrl+Shift+Enter inserts a new empty row above the current row; focus lands in the first cell of the new row.
- Alt+Shift+ArrowRight inserts an empty column to the right of the current column; the focused cell shifts to the new column.
- Alt+Shift+ArrowLeft inserts an empty column to the left of the current column.
- Ctrl+Shift+Backspace deletes the current row when the table has at least two body rows.
- Alt+Shift+Backspace deletes the current column when the table has at least two columns.
- Ctrl+Shift+A cycles the current column's alignment. `'none'` (delimiter `---`) renders identically to `'left'` (delimiter `:---`), so the first press from `none` jumps straight to `center` (`:---:`) to avoid an invisible step. After that the cycle is `left → center → right → left → ...` (`:---` / `:---:` / `---:`); `none` is not re-entered once cycling has begun.
- Ctrl+Alt+↑ / Ctrl+Alt+↓ moves the WHOLE table one slot among its siblings; the bare Alt+↑/↓ keeps
  meaning "move this row", so at the header boundary it is a no-op rather than a block move. The
  chord is the platform-modifier variant of the reorder gesture every other kind puts on Alt+↑/↓,
  which a cell caret cannot use because the row reorder claims it.
- Shift+Enter inside a cell inserts a literal `<br>` at the cursor. GFM cells can't carry raw newlines, so the proper representation is `<br>`. Round-trip preserves the `<br>` bytes. The cell currently displays it as literal text — a visible line break in the rendered cell depends on a follow-up cell-inline-render migration (tracked in `docs/issues.md`).

## Edge cases

- Ctrl+Shift+Backspace is a no-op when only one body row remains.
- Alt+Shift+Backspace is a no-op when only one column remains.
- Ctrl+Shift+Backspace on the header row (row 0) promotes the next row to be the new header.

## Notes on ownership

- Every chord above is a `tableCell` keymap binding, resolved through the same override-aware
  dispatcher as every other kind's, so the consumer `keybindings` prop can disable or rebind it
  (scoped to `tableCell` — the cell holds the caret, not the table). Cell arrow navigation and the
  three-stage Ctrl+A stay off the keymap: both read where the caret sits inside the cell.

## User interactions

- Each shortcut-driven structural mutation is a single undo entry — one Ctrl+Z press restores the prior state.
- After delete-column followed by undo, the rendered per-cell alignments must match the pre-delete state — the live metadata is restored, not just the markdown source.
- A delete-undo-delete-undo cycle restores all the way to the original. Per-row child IDs live on the container nodes, so the deep-cloned snapshot restores them in lockstep with `children`, keeping Svelte's keyed-each in sync across repeated structural-undo cycles.

## Notes

- Tab on the last cell of the last row creating a new row is verified in `navigation.spec.ts`.
