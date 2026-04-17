# Block: List — Enter

Covers list behavior when Enter creates a new item, splits content, or exits the list.

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
- Enter on empty first item renumbers remaining items from 1 (e.g., `1. empty / 2. x` → `1. x`)
- Enter on empty middle item preserves the surviving second half's original markers (e.g., `1. a / 2. b / 3. empty / 4. c` → first list `1. a / 2. b`, second list `4. c`). Renumbering across the split would misrepresent the user's source numbering.
