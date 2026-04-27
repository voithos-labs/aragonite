# Feature: Table block — keyboard vocabulary

## Happy paths

- Ctrl+Enter inserts a new empty row below the current row; focus lands in the first cell of the new row.
- Ctrl+Shift+Enter inserts a new empty row above the current row; focus lands in the first cell of the new row.
- Alt+Shift+ArrowRight inserts an empty column to the right of the current column; the focused cell shifts to the new column.
- Alt+Shift+ArrowLeft inserts an empty column to the left of the current column.
- Ctrl+Shift+Backspace deletes the current row when the table has at least two body rows.
- Alt+Shift+Backspace deletes the current column when the table has at least two columns.
- Alt+Shift+A cycles the current column's alignment in order none → left → center → right → none, reflected in the delimiter syntax (`---` / `:---` / `:---:` / `---:`). Each press advances by one (no double-press needed; Ctrl+Shift+A would conflict with Chromium's global "Search tabs" binding so we use the Alt+Shift namespace shared with other column ops).

## Edge cases

- Ctrl+Shift+Backspace is a no-op when only one body row remains.
- Alt+Shift+Backspace is a no-op when only one column remains.
- Ctrl+Shift+Backspace on the header row (row 0) promotes the next row to be the new header.

## User interactions

- Each shortcut-driven structural mutation is a single undo entry — one Ctrl+Z press restores the prior state.

## Notes

- Tab on the last cell of the last row creating a new row is verified in `navigation.spec.ts`.
