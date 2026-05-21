# Feature: Table block — keyboard vocabulary

## Happy paths

- Ctrl+Enter inserts a new empty row below the current row; focus lands in the first cell of the new row.
- Ctrl+Shift+Enter inserts a new empty row above the current row; focus lands in the first cell of the new row.
- Alt+Shift+ArrowRight inserts an empty column to the right of the current column; the focused cell shifts to the new column.
- Alt+Shift+ArrowLeft inserts an empty column to the left of the current column.
- Ctrl+Shift+Backspace deletes the current row when the table has at least two body rows.
- Alt+Shift+Backspace deletes the current column when the table has at least two columns.
- Ctrl+Shift+A cycles the current column's alignment. `'none'` (delimiter `---`) renders identically to `'left'` (delimiter `:---`), so the first press from `none` jumps straight to `center` (`:---:`) to avoid an invisible step. After that the cycle is `left → center → right → left → ...` (`:---` / `:---:` / `---:`); `none` is not re-entered once cycling has begun.
- Shift+Enter inside a cell is a silent no-op. GFM cells can't carry raw newlines, so the proper representation is a literal `<br>` — but until the 0.6.7 inline-HTML pipeline can render `<br>` as a visible line break, inserting raw markup is worse UX than doing nothing. Re-enable once inline rendering ships.

## Edge cases

- Ctrl+Shift+Backspace is a no-op when only one body row remains.
- Alt+Shift+Backspace is a no-op when only one column remains.
- Ctrl+Shift+Backspace on the header row (row 0) promotes the next row to be the new header.

## User interactions

- Each shortcut-driven structural mutation is a single undo entry — one Ctrl+Z press restores the prior state.
- After delete-column followed by undo, the rendered per-cell alignments must match the pre-delete state — the live metadata is restored, not just the markdown source.
- A delete-undo-delete-undo cycle restores all the way to the original. Per-row child IDs live on the container nodes, so the deep-cloned snapshot restores them in lockstep with `children`, keeping Svelte's keyed-each in sync across repeated structural-undo cycles.

## Notes

- Tab on the last cell of the last row creating a new row is verified in `navigation.spec.ts`.
