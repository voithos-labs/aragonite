# Block: List — Tab (indent / nest)

How Tab changes a list item's nesting level, including ordered-list numbering when nesting.

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
