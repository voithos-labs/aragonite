# Feature: Table caret/selection recovery on undo

## Happy paths

- Undo after Alt+Shift+Backspace (delete column): caret lands back in the cell that had focus before the delete
- Undo after Ctrl+Shift+Backspace (delete row): caret lands back in the cell that had focus before the delete
- Undo after a column delete triggered via cross-block column coverage restores the intra-table multi-cell selection
