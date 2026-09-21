# Block: List, Shift+Tab (unindent / promote)

How Shift+Tab promotes a nested list item to the parent list level, including marker-style rewriting and renumbering.

## Shift+Tab (unindent / promote)

- Shift+Tab on a nested item promotes it to the parent list level
- Shift+Tab on a top-level item does nothing
- The promoted item is inserted after the parent item in the parent list
- If the nested list becomes empty after promotion, it is removed
- Focus follows the item through the container mutation, whether the nested list survives with siblings or is removed outright: typing straight after Shift+Tab lands at the start of the promoted item, never at the position it held before the move

### Ordered list numbering and marker style on Shift+Tab

- The nested list's remaining items (if any) are renumbered from 1
- The parent list's items after the insertion point are renumbered, so the promoted item slots into the sequence and every later item shifts up
- When the nested and parent lists are different types (ordered ↔ unordered), the promoted item's marker is rewritten to match the parent list's style before renumbering. The destination marker suffix (`. ` / `) ` for ordered, `- ` / `*` / `+` for unordered) is copied from an existing sibling in the parent list
- Regression: ArrowUp immediately after Shift+Tab must move the caret into the previous outer item (out-of-date references to the outer list after a promote could leave ArrowUp doing nothing)
