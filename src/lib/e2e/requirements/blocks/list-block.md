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
- Backspace at start of non-empty first item (top-level): **Rule U1 — unwrap**. The item's paragraph becomes a plain paragraph before the list; matching-type nested sub-list items promote to the shrunk parent list level (renumbered for ordered lists); mismatched-type nested sub-lists become separate blocks between the lifted paragraph and the shrunk list. If removing the first item empties the list, the list is deleted. Cursor lands at offset 0 of the lifted paragraph. No auto-merge with the block above the list.
- Backspace at start of empty non-first item: delete the item, focus previous item
- Backspace at start of non-empty non-first item: **Rule M1 — merge (rule B + preserve absolute indent)**. The current item's first-paragraph text is appended to the "deepest visible text above" — the rightmost/deepest text-bearing paragraph reachable by descending into the preceding item's trailing nested lists. The current item's remaining children are placed at their original absolute list-nesting depth along the target's ancestry chain: listItem children slot into the container at their original depth; non-listItem children (extra paragraphs) absorb into the target item's inner children. Ordered markers renumber. Cursor lands at the merge point (end of target's original text, before appended content).
- Backspace at start of any nested item (first in its nested list): promote to parent level (same as Shift+Tab)

### M1 worked examples (preserve absolute indent)

| Input                                             | Backspace at | Result                                    | Rule applied                                                                    |
| ------------------------------------------------- | ------------ | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `- A`<br>`- B`                                    | start of B   | `- AB`                                    | flat merge                                                                      |
| `- A`<br>`- B`<br>`  - C`                         | start of B   | `- AB`<br>`  - C`                         | C nests under AB (target A at depth 0)                                          |
| `- A`<br>`  - AA`<br>`- B`<br>`  - C`             | start of B   | `- A`<br>`  - AAB`<br>`  - C`             | C becomes sibling of AA (target AA at depth 1, preserving C's absolute depth 1) |
| `- A`<br>`  - B`<br>`    - C`<br>`- D`<br>`  - E` | start of D   | `- A`<br>`  - B`<br>`    - CD`<br>`  - E` | E stays at depth 1, sibling of B, even though merge point is at depth 2         |
| `- A`<br>`- B`<br>_blank line_<br>`  extra`       | start of B   | `- AB`<br>_blank line_<br>`  extra`       | extra paragraph absorbed into target item's children                            |

See `docs/superpowers/specs/2026-04-12-container-backspace-unwrap-merge-design.md` for full semantic rules.

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

### Ordered list numbering and marker style on Shift+Tab

- The nested list's remaining items (if any) are renumbered from 1
- The parent list's items after the insertion point are renumbered, so the promoted item slots into the sequence and every later item shifts up
- When the nested and parent lists are different types (ordered ↔ unordered), the promoted item's marker is rewritten to match the parent list's style before renumbering. The destination marker suffix (`. ` / `) ` for ordered, `- ` / `*` / `+` for unordered) is templated from an existing sibling in the parent list

## Tab (indent) — ordered list numbering and marker style

- When Tab appends an ordered item to an existing ordered nested list, the appended item continues the nested list's sequence (e.g., joining `[1, 2]` becomes `[1, 2, 3]`, not `[1, 2, 1]`)
- When Tab creates a new nested list, its sole item starts at `1`
- The parent list's items after the removed item are renumbered

## Delete (forward delete)

- Delete at end of last child within an item: delegates to parent (same as paragraph behavior)

## Arrow key navigation

- ArrowDown from last line of last item exits the list to the next block
- ArrowUp from first line of first item exits the list to the previous block
- ArrowDown/ArrowUp between items traverses through all items including nested ones
- ArrowLeft at start of item content moves to end of previous item
- ArrowRight at end of item content moves to start of next item

## Cross-container merge on Backspace (list prev)

- Flat unordered list + following paragraph + Backspace at offset 0 of the paragraph: merge the paragraph's text into the last list item's last paragraph. Caret lands at the join point.
- Flat ordered list: same behavior. The merge does not change item numbering.
- Nested list: merge recurses into the deepest nested list item's last paragraph.
- Loose list item (multi-paragraph): merge lands in the LAST paragraph of the last list item.
- List inside a blockquote + following paragraph: same rule, two levels of container traversal.
- Deepest leaf is opaque (list item's last child is a fenced code block): fall back to move-focus.

See `container-editing.md` for the shared cross-container merge semantic (the same rule applies when the prev block is a blockquote).
