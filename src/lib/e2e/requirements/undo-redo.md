# Feature: Undo / Redo

Undo and redo for structural and text operations.

## Happy paths

- undo reverts a split: Enter then Ctrl+Z restores single block
- redo restores a split: undo then Ctrl+Shift+Z re-applies the split
- undo reverts typed text: type text, wait for debounce (~600ms), undo removes the typed text

## Edge cases

- undo reverts a merge: Backspace merge then undo restores both original blocks
- undo reverts kind change: typing # to convert, wait for debounce, undo reverts to paragraph
- undo across a prose→non-prose flip restores the rendered DOM, not just the CST: typing to turn a paragraph into an htmlBlock (DOM already carries the char) then undo must repaint the block to the CST; the next keystroke must not commit the undone byte back
- multiple undo steps: perform several operations, undo each one in sequence
- redo stack cleared on new edit: split, undo, type new text, redo does nothing (stack cleared)
- undo on empty stack: Ctrl+Z when nothing to undo does not crash or corrupt state

## Cross-block (covered in selection/undo.md)

- Undo after cross-block cut restores document AND cross-block selection
- Undo after type-replace restores selection and removes typed chars in one step

## User interactions

- undo via Ctrl+Z keyboard shortcut: verify it uses real keyboard, not programmatic
- redo via Ctrl+Shift+Z keyboard shortcut: same
