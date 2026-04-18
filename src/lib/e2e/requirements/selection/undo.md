# Feature: Selection undo — cross-block restore

## Happy paths

- Undo after cross-block cut restores document content AND cross-block selection (overlays reappear)
- Undo after cross-block backspace restores document AND cross-block selection
- Redo after undoing a cross-block cut re-applies the deletion

## Edge cases

- Undo after type-replace restores cross-block selection AND removes all typed chars in one step
- Selection-only changes (Shift+Arrow) push no undo entries: stack depth unchanged
