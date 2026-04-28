# Feature: Table block — keyboard vocabulary

## Happy paths

- Ctrl+Enter inserts a new empty row below the current row; focus lands in the first cell of the new row.
- Ctrl+Shift+Enter inserts a new empty row above the current row; focus lands in the first cell of the new row.
- Alt+Shift+ArrowRight inserts an empty column to the right of the current column; the focused cell shifts to the new column.
- Alt+Shift+ArrowLeft inserts an empty column to the left of the current column.
- Ctrl+Shift+Backspace deletes the current row when the table has at least two body rows.
- Alt+Shift+Backspace deletes the current column when the table has at least two columns.
- Ctrl+Shift+A cycles the current column's alignment. `'none'` (delimiter `---`) renders identically to `'left'` (delimiter `:---`), so the first press from `none` jumps straight to `center` (`:---:`) to avoid an invisible step. After that the cycle is `left → center → right → left → ...` (`:---` / `:---:` / `---:`); `none` is not re-entered once cycling has begun.
- Shift+Enter inside a cell inserts a literal `<br>` at the caret. GFM cells can't carry raw newlines, so `<br>` is the standard line-break encoding; rendered as visible markup until inline-HTML rendering ships.

## Edge cases

- Ctrl+Shift+Backspace is a no-op when only one body row remains.
- Alt+Shift+Backspace is a no-op when only one column remains.
- Ctrl+Shift+Backspace on the header row (row 0) promotes the next row to be the new header.

## User interactions

- Each shortcut-driven structural mutation is a single undo entry — one Ctrl+Z press restores the prior state.
- After delete-column followed by undo, the rendered per-cell alignments must match the pre-delete state — the live metadata is restored, not just the markdown source.

## Notes

- Tab on the last cell of the last row creating a new row is verified in `navigation.spec.ts`.
