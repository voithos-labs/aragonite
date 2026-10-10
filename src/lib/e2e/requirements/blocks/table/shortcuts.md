# Feature: Table block, keyboard vocabulary

## User interactions

- After delete-column followed by undo, the rendered per-cell alignments match the state before the delete, so the live metadata is restored, not just the markdown source.
- A column insert after that undo still reaches every row, so the state registry follows the undo's cloned tree.
- Delete, undo, delete, undo cycles back to the original with no page error and the DOM in step with the tree. Per-row child IDs live on the container nodes, so the deep-cloned snapshot restores them in step with `children`, keeping Svelte's keyed-each in sync across repeated structural-undo cycles.

## Edge cases

- Deleting the last body row leaves focus on a surviving cell, never on `<body>`.
- Deleting the last column leaves focus on a surviving cell.

## Pinned below the browser

These chords are `tableCell` keymap bindings, resolved through the same override-aware dispatcher as every other kind's, so the consumer `keybindings` prop can disable or rebind them (scoped to `tableCell`, since the cell holds the caret, not the table). A keystroke in a mounted cell and the document that comes out are checked without a page:

- Ctrl+Enter and Ctrl+Shift+Enter insert a row below and above, and Alt+Shift+ArrowRight and Alt+Shift+ArrowLeft insert a column to the right and left (`test/blocks/table/cell-table-chords.test.ts`; where the caret lands is `e2e/tests/blocks/table/action-landing.spec.ts`).
- Ctrl+Shift+Backspace deletes the caret's row (the header row too, which promotes the next one) and Alt+Shift+Backspace deletes its column. Each does nothing when one body row or one column is left (`test/blocks/table/cell-table-chords.test.ts`).
- Ctrl+Shift+A cycles the column's alignment, skipping the invisible step from `none` straight to `center` (`test/tree-operations/table-mutations.test.ts` for the whole cycle, `test/blocks/table/cell-table-chords.test.ts` for the key).
- Ctrl+Alt+ArrowUp and Ctrl+Alt+ArrowDown move the whole table among its siblings while the bare Alt chord stays the row reorder, and a table moved flush under a paragraph keeps a blank line so it reloads as a table (`test/blocks/table/cell-table-chords.test.ts`, `test/tree-operations/reorder-lands-whole.property.test.ts`).
- Each structural change is one undo entry (`test/undo/undo-restoration.property.test.ts`), and a header delete comes back whole (`test/editor-actions/table-header-delete-undo.test.ts`).
- Shift+Enter inside a cell inserts a literal `<br>` (`test/blocks/table/cell-write-escape.test.ts`; the rendered break is `e2e/tests/blocks/table/cell-line-break.spec.ts`).

Cell arrow navigation and the two-stage Ctrl+A (the cell's text, then the document, with no table stage) stay off the keymap because both read where the caret sits inside the cell. Tab on the last cell of the last row creating a new row is `e2e/tests/blocks/table/navigation.spec.ts`.
