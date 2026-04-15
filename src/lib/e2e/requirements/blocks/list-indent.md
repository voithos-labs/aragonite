# Block: List — Tab & Shift+Tab (indent / unindent)

Covers how Tab and Shift+Tab change list item nesting level, including ordered-list numbering and marker-style changes.

## Tab (indent / nest)

- Tab on non-first item nests it under the previous sibling
- Tab on first item is a no-op (no previous sibling to nest under)
- If previous sibling already has a nested list of the same type, item is appended to it
- If previous sibling has no nested list, a new one is created
- Cursor stays in the indented item at offset 0 (not at end of nested content)

### Ordered list marker on Tab

- When nesting an ordered item, its marker resets to `1.` (new numbering context)
- Subsequent items in the original list renumber

### Tab (indent) — ordered list numbering and marker style

- When Tab appends an ordered item to an existing ordered nested list, the appended item continues the nested list's sequence (e.g., joining `[1, 2]` becomes `[1, 2, 3]`, not `[1, 2, 1]`)
- When Tab creates a new nested list, its sole item starts at `1`
- The parent list's items after the removed item are renumbered

## Shift+Tab (unindent / promote)

- Shift+Tab on a nested item promotes it to the parent list level
- Shift+Tab on a top-level item is a no-op
- The promoted item is inserted after the parent item in the parent list
- If the nested list becomes empty after promotion, it is removed

### Ordered list numbering and marker style on Shift+Tab

- The nested list's remaining items (if any) are renumbered from 1
- The parent list's items after the insertion point are renumbered, so the promoted item slots into the sequence and every later item shifts up
- When the nested and parent lists are different types (ordered ↔ unordered), the promoted item's marker is rewritten to match the parent list's style before renumbering. The destination marker suffix (`. ` / `) ` for ordered, `- ` / `*` / `+` for unordered) is templated from an existing sibling in the parent list
