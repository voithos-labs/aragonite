# Feature: cross-block clipboard — cut, delete/backspace, type-replace

## Happy paths

- Ctrl+X with cross-block selection copies text then deletes the range.
- Backspace with cross-block selection deletes the range and merges endpoints.
- Delete with cross-block selection deletes the range and merges endpoints.
- Typing over a cross-block selection replaces it with the typed character.

## Edge cases

- Cut then undo restores the original document.
- Backspace merges endpoint blocks into one (start block survives).
- Cross-block delete spanning three blocks leaves only the merged result.
- Type-replace inserts the character at the correct offset in the merged block.
- Type-replace over a cross-block selection is one undo unit: a single Ctrl+Z restores the pre-replace document (delete + typed character share the same undo seam, with op:'delete' followed by op:'updateContent' on the event stream — the typed character re-derives the leaf's kind, so it is not an `input`).

## User interactions

- Select across two paragraphs via Shift+ArrowDown, Ctrl+X: removes range, cursor at merge point.
- Select across three blocks, Backspace: single merged block remains.
