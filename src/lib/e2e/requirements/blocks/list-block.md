# Block: List

Covers ordered and unordered lists — flat items, nested items, and all keyboard interactions.

## Rendering

- Unordered lists display with `-`, `*`, or `+` markers
- Ordered lists display with `1.`, `2.`, etc. markers
- Nested lists render indented within the parent item
- The entire list (including nested levels) is a single top-level block
- Source round-trips after any edit

## Enter (new item / split / exit)

- Enter at end of item creates new empty sibling item after it
- Enter in middle of item splits content: first half stays, second half moves to new item
- Enter at start of first item creates empty item before it, content moves to second item
- Enter on empty item exits the list:
  - Empty only item: list replaced by empty paragraph
  - Empty first item: deleted, paragraph created before the list
  - Empty middle item: deleted, list splits into two lists with paragraph between
  - Empty last item: deleted, paragraph created after the list
- Enter on item whose first paragraph is empty exits the list, even if the item has nested content (nested lists from a previous split move to adjacent items)

### Ordered list numbering on Enter

- New item gets the next sequential number after the previous item
- Subsequent items are renumbered (e.g., inserting between 1 and 2 produces 1, 2, 3)
- Enter at start of first item: the new empty first item gets the original first number, original item renumbers

## Backspace (delete / merge / promote)

- Backspace at start of empty first item (with siblings): delete the item, focus next item
- Backspace at start of empty only item: delete the entire list, focus the block before it
- Backspace at start of non-empty first item (top-level): move focus to block before the list
- Backspace at start of empty non-first item: delete the item, focus previous item
- Backspace at start of non-empty non-first item: move focus to end of previous item
- Backspace at start of any nested item (first in its nested list): promote to parent level (same as Shift+Tab)

### Ordered list numbering on Backspace

- Deleting an item renumbers subsequent items

## Tab (indent / nest)

- Tab on non-first item nests it under the previous sibling
- Tab on first item is a no-op (no previous sibling to nest under)
- If previous sibling already has a nested list of the same type, item is appended to it
- If previous sibling has no nested list, a new one is created
- Cursor stays in the indented item at offset 0 (not at end of nested content)

### Ordered list marker on Tab

- When nesting an ordered item, its marker resets to `1.` (new numbering context)
- Subsequent items in the original list renumber

## Shift+Tab (unindent / promote)

- Shift+Tab on a nested item promotes it to the parent list level
- Shift+Tab on a top-level item is a no-op
- The promoted item is inserted after the parent item in the parent list
- If the nested list becomes empty after promotion, it is removed

## Delete (forward delete)

- Delete at end of last child within an item: delegates to parent (same as paragraph behavior)

## Arrow key navigation

- ArrowDown from last line of last item exits the list to the next block
- ArrowUp from first line of first item exits the list to the previous block
- ArrowDown/ArrowUp between items traverses through all items including nested ones
- ArrowLeft at start of item content moves to end of previous item
- ArrowRight at end of item content moves to start of next item
