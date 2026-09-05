# Feature: cross-block clipboard — cut, delete/backspace, type-replace

## Happy paths

- Ctrl+X with cross-block selection copies text then deletes the range.
- Backspace with cross-block selection deletes the range and merges endpoints.
- Delete with cross-block selection deletes the range and merges endpoints.
- Typing over a cross-block selection replaces it with the typed character.

## Edge cases

- Cut then undo restores the original document.
- Cut from a block's first character into the next block keeps the blank line above the survivor,
  so reloading the cut source still shows two blocks.
- Backspace merges endpoint blocks into one (start block survives).
- Cross-block delete spanning three blocks leaves only the merged result.
- Type-replace inserts the character at the correct offset in the merged block.
- Type-replace over a cross-block selection is one undo unit: a single Ctrl+Z restores the pre-replace document (delete + typed character share the same undo seam, with op:'delete' followed by op:'updateContent' on the event stream — the typed character re-derives the leaf's kind, so it is not an `input`).

## User interactions

- Select across two paragraphs via Shift+ArrowDown, Ctrl+X: removes range, cursor at merge point.
- Select across three blocks, Backspace: single merged block remains.

## Miss-analysis

- The dropped separator (#60) shipped because every cross-block delete fixture selected from
  MID-block, and from the document's FIRST block, whose leading trivia is empty either way; the
  byte assertions also never reloaded their result, which is the only place the loss shows.
