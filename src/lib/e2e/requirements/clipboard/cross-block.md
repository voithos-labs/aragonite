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

## Paste into cross-block selection

- Single-block text paste into a cross-list-item selection replaces the range with the clipboard text
- Paste into a selection covering two of three list items replaces only those two; the untouched item survives
- Paste into a selection covering items 2 and 3 of a 3-item list replaces those two; item 1 survives
- Multi-block text paste into a cross-list-item selection lands both pasted blocks as siblings inside the container
- Copy across list items then paste across different list items round-trips the copied slice without losing content
- Drag selection across list items (empty native selection) still receives the paste — the paste handler parks a caret in the focus block regardless of entry gesture
- Mid-paragraph-offset cross-block paste splices the clipboard text between the pre-anchor head and the post-focus tail, producing a single merged item
- Paste covering an entire list between two paragraphs replaces the list with the clipboard text and leaves surrounding paragraphs intact

## Multi-block paste at a single caret

- Pasting two paragraphs at a single caret creates multiple top-level blocks
- Multi-block paste with an active intra-block selection replaces the selected text with the pasted blocks

## List marker preservation on copy

- Copying across a full ordered list preserves every item marker (`1.`, `2.`, `3.`) in the clipboard text with no content duplication

## Structural paste discriminator (single-paragraph vs multi-block)

- Pasting a markdown list at the end of a paragraph creates a list block below the paragraph with no items dropped
- Pasting a markdown list inside a list item preserves all pasted items alongside the original items
- Pasting a heading at the end of a paragraph creates a heading block below the paragraph
- Cross-block paste of multi-block clipboard content into a list-item selection lands every pasted block; selected items are removed and the untouched tail item survives

## Single-undo paste guarantees

- Cross-block top-level multi-block paste is one undo unit: a single Ctrl+Z restores the pre-paste document rather than an intermediate "selection-deleted but blocks-not-inserted" state
- Cross-block multi-block paste across list items is one undo unit: a single Ctrl+Z restores the pre-paste document

## Partial list promotion on copy

- Selecting the last list item through content below copies only that item — earlier items of the list are not promoted into the clipboard
