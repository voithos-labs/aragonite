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
- Enter on item whose first paragraph is empty exits the list, even if the item has nested content:
  - Matching-type nested lists (same ordered/unordered) merge into the surviving list halves as siblings
  - Mismatched-type nested lists (e.g. ordered inside unordered) lift out as a separate top-level block
  - Non-list trailing children (extra paragraphs in a loose item, fenced code, etc.) lift out as separate top-level blocks
  - Order: lifted blocks appear immediately after the new exit paragraph, preserving the document order they had inside the exited item
- Enter on an empty item inside a **nested** list outdents one level (Shift+Tab semantics) instead of escaping to a paragraph. Each press promotes one level outward; only the outermost list escapes to a paragraph at the parent container level. Parallels Backspace at the start of a first-child of a nested list.

### Undo after Enter mid-item

- Enter in the middle of an item followed by Ctrl+Z restores the original item in ONE undo press (mid-item Enter is one user action, one undo snapshot)

### Ordered list numbering on Enter

- New item gets the next sequential number after the previous item
- Subsequent items are renumbered (e.g., inserting between 1 and 2 produces 1, 2, 3)
- Enter at start of first item: the new empty first item gets the original first number, original item renumbers
- Enter on empty first item renumbers remaining items from 1 (e.g., `1. empty / 2. x` → `1. x`)
- Enter on empty middle item renumbers the surviving second half to continue the sequence uninterrupted across the exit gap (e.g., `1. a / 2. b / 3. empty / 4. c` → first list `1. a / 2. b`, paragraph, second list `3. c`). The exit paragraph is treated as a description between items, not as a numbered slot — matches Google Docs / Obsidian behavior.
- Double-Enter from the end of a middle item exits the list with continuous renumbering: the first Enter creates an empty sibling, the second Enter exits; the trailing item renumbers as if the inserted-then-exited slot never existed (e.g., `1. one / 2. two|` + Enter + Enter + `3. three` remains `3. three`, not `4.`)
- Enter at the end of the last item in a loose list (blank line between siblings) appends a new item continuing the sequence (e.g., `1. a / 2. b / [blank] / 3. c` + Enter at end of c → a new `4.` item). The blank line is descriptive trivia and doesn't terminate numbering.
