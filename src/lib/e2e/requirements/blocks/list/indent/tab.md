# Block: List — Tab (indent / nest)

How Tab changes a list item's nesting level, including ordered-list numbering when nesting.

## Tab (indent / nest)

- Tab on non-first item nests it under the previous sibling
- Tab on first item is a no-op (no previous sibling to nest under)
- If previous sibling already has a nested list of the same type, item is appended to it
- If previous sibling has no nested list, a new one is created
- Cursor stays in the indented item at offset 0 (not at end of nested content)
- When the moved item has multiple paragraphs, the cursor lands at offset 0 of its last paragraph (FOCUS_LAST_START contract clamps to 0 — no IndexSizeError fallback)
- Focus follows the item through the container mutation, for both nested-list paths (appended to an existing list, or placed in a freshly created one): typing straight after Tab lands at the start of the MOVED item, never at a stale pre-move position

### Ordered list marker on Tab

- When nesting an ordered item, its marker resets to `1.` (new numbering context)
- Subsequent items in the original list renumber

### Tab (indent) — ordered list numbering and marker style

- When Tab appends an ordered item to an existing ordered nested list, the appended item continues the nested list's sequence (e.g., joining `[1, 2]` becomes `[1, 2, 3]`, not `[1, 2, 1]`)
- When Tab creates a new nested list, its sole item starts at `1`
- The parent list's items after the removed item are renumbered
