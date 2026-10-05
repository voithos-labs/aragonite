# Block: List, Shift+Tab (unindent / promote)

How Shift+Tab promotes a nested list item to the parent list level, including marker-style rewriting and renumbering.

## Shift+Tab (unindent / promote)

- Shift+Tab on a nested item promotes it to the parent list level
- Shift+Tab on a top-level item does nothing
- The promoted item is inserted after the parent item in the parent list
- The items after it in its sublist come along as its own children, after any it already had,
  so the document still reads in the same order: `- alpha` / `  - beta` / `  - gamma`, Shift+Tab
  on `beta`, gives `- alpha` / `- beta` / `  - gamma`. Enter in an empty nested item and
  Backspace at the start of a sublist lift an item the same way
  - Miss-analysis: every promote fixture lifted the last item of its sublist or checked the lifted
    line with a regex, so nothing read the order of the items after it, which ended up above it.
- If the nested list becomes empty after promotion, it is removed, and so is the parent item if
  that list was all it held (`- - a`, Shift+Tab on `a`, gives `- a`, the caret at its start)
  - Miss-analysis: every promote fixture gave the parent item a line of text above its sublist,
    so no test saw the item the removal left with nothing in it.
- Focus follows the item through the container mutation, whether the nested list survives with siblings or is removed outright: typing straight after Shift+Tab lands at the start of the promoted item, never at the position it held before the move

### Ordered list numbering and marker style on Shift+Tab

- The nested list's remaining items (if any) are renumbered from 1, and so are the items that came
  along, in their new sublist
- The parent list's items after the insertion point are renumbered, so the promoted item slots into the sequence and every later item shifts up
- When the nested and parent lists are different types (ordered ↔ unordered), the promoted item's marker is rewritten to match the parent list's style before renumbering. The destination marker suffix (`. ` / `) ` for ordered, `- ` / `*` / `+` for unordered) is copied from an existing sibling in the parent list
- Regression: ArrowUp immediately after Shift+Tab must move the caret into the previous outer item (out-of-date references to the outer list after a promote could leave ArrowUp doing nothing)
