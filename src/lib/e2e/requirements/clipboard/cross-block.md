# Feature: Cross-block clipboard operations

## Happy paths

- Ctrl+C with cross-block selection copies the correct markdown text to clipboard
- Ctrl+X with cross-block selection copies text then deletes the range
- Backspace with cross-block selection deletes the range and merges endpoints
- Delete with cross-block selection deletes the range and merges endpoints
- Typing over a cross-block selection replaces it with the typed character
- Ctrl+V with cross-block selection deletes the range then pastes clipboard content

## Edge cases

- Ctrl+C preserves the selection (no collapse, no mutation)
- Cut then undo restores the original document
- Backspace merges endpoint blocks into one (start block survives)
- Cross-block delete spanning three blocks leaves only the merged result
- Type-replace inserts the character at the correct offset in the merged block
- Cross-block copy of a list with nested items does not duplicate content (container+leaf regression)
- Cross-block copy of an ordered list preserves all item markers (start/end boundary promotion regression)
- Selecting last list item + content below copies only that item, not entire list (over-promotion regression)
- Partial selection ending inside a single-child list item preserves that item's marker (e.g. "3. thi")
- Blank lines between blocks survive copy + paste: selecting across two paragraphs separated by a blank line and pasting reproduces the blank-line separator (not a soft break merging them into one paragraph)

## User interactions

- Select across two paragraphs via Shift+ArrowDown, Ctrl+C, collapse, paste: duplicates text
- Select across two paragraphs via Shift+ArrowDown, Ctrl+X: removes range, cursor at merge point
- Select across three blocks, Backspace: single merged block remains
