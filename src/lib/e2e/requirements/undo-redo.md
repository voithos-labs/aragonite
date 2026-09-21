# Feature: Undo / Redo

Undo and redo for structural and text operations.

## Happy paths

- undo reverts a split: Enter then Ctrl+Z restores single block
- redo restores a split: undo then Ctrl+Shift+Z re-applies the split
- undo reverts typed text: type text, wait for debounce (~600ms), undo removes the typed text

## Edge cases

- undo reverts a merge: Backspace merge then undo restores both original blocks
- undo across a prose to non-prose kind change restores the rendered DOM, not just the CST: typing to turn a paragraph into an `htmlBlock` (DOM already carries the character) then undo must repaint the block to the CST; the next keystroke must not commit the undone byte back
- undo on empty stack: Ctrl+Z when nothing to undo does not crash or corrupt state

## Cross-block (covered in selection/undo.md)

- Undo after cross-block cut restores document and cross-block selection
- Undo after type-replace restores selection and removes typed chars in one step

## User interactions

- undo via Ctrl+Z keyboard shortcut: verify it uses real keyboard, not programmatic
- redo via Ctrl+Shift+Z keyboard shortcut: same
