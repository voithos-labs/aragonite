# Block: List — Backspace (Rule M1 — merge non-first item)

Backspace at offset 0 of a non-empty non-first item merges the current item's first-paragraph text into the deepest visible text above; the current item's remaining children preserve their absolute list-nesting depth along the target's ancestry chain.

## M1 merge

- Backspace at start of non-empty non-first item: the current item's first-paragraph text is appended to the "deepest visible text above" — the rightmost/deepest text-bearing paragraph reachable by descending into the preceding item's trailing nested lists. The current item's remaining children are placed at their original absolute list-nesting depth along the target's ancestry chain: listItem children slot into the container at their original depth; non-listItem children (extra paragraphs) absorb into the target item's inner children. Ordered markers renumber. Cursor lands at the merge point (end of target's original text, before appended content).

### M1 worked examples (preserve absolute indent)

| Input                                             | Backspace at | Result                                    | Rule applied                                                                    |
| ------------------------------------------------- | ------------ | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `- A`<br>`- B`                                    | start of B   | `- AB`                                    | flat merge                                                                      |
| `- A`<br>`- B`<br>`  - C`                         | start of B   | `- AB`<br>`  - C`                         | C nests under AB (target A at depth 0)                                          |
| `- A`<br>`  - AA`<br>`- B`<br>`  - C`             | start of B   | `- A`<br>`  - AAB`<br>`  - C`             | C becomes sibling of AA (target AA at depth 1, preserving C's absolute depth 1) |
| `- A`<br>`  - B`<br>`    - C`<br>`- D`<br>`  - E` | start of D   | `- A`<br>`  - B`<br>`    - CD`<br>`  - E` | E stays at depth 1, sibling of B, even though merge point is at depth 2         |
| `- A`<br>`- B`<br>_blank line_<br>`  extra`       | start of B   | `- AB`<br>_blank line_<br>`  extra`       | extra paragraph absorbed into target item's children                            |

The worked examples above are the ground truth for the expected reshuffling; see `src/lib/editor/test/tree-operations/merge-list-item.test.ts` for the matching unit-test coverage.

### Ordered list numbering on M1

- Deleting an item via M1 renumbers subsequent items
