# Block: List — Backspace & Delete

Covers list behavior when Backspace deletes, merges, or promotes items, plus Delete at end of an item.

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

The worked examples above are the ground truth for the expected reshuffling; see `src/lib/editor/test/tree-operations-unwrap.test.ts` for the matching unit-test coverage.

### Ordered list numbering on Backspace

- Deleting an item renumbers subsequent items

## Delete (forward delete)

- Delete at end of last child within an item: delegates to parent (same as paragraph behavior)
