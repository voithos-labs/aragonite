# Block: List — Backspace (Rule M1 — merge non-first item)

Backspace at offset 0 of a non-empty non-first item merges the current item's first-paragraph text into the deepest visible text above; the current item's remaining children preserve their absolute list-nesting depth along the target's ancestry chain.

## M1 merge

- Backspace at start of non-empty non-first item: the current item's first-paragraph text is appended to the "deepest visible text above" — the rightmost/deepest text-bearing paragraph reachable by descending into the preceding item's trailing nested lists. The current item's remaining children are placed at their original absolute list-nesting depth along the target's ancestry chain: listItem children slot into the container at their original depth; non-listItem children (extra paragraphs) absorb into the target item's inner children. Ordered markers renumber. Cursor lands at the merge point (end of target's original text, before appended content).

- Backspace with the caret at raw offset 0 dispatches M1 through the rendered ambient marker: the `contenteditable="false"` marker span translates the DOM offset to raw 0, so a two-item list merges byte-exactly (`- Item one` + `- Item two` → `- Item oneItem two`) with one surviving marker.

### M1 worked examples (preserve absolute indent)

| Input                                             | Backspace at | Result                                    | Rule applied                                                                    |
| ------------------------------------------------- | ------------ | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `- A`<br>`- B`                                    | start of B   | `- AB`                                    | flat merge                                                                      |
| `- A`<br>`- B`<br>`  - C`                         | start of B   | `- AB`<br>`  - C`                         | C nests under AB (target A at depth 0)                                          |
| `- A`<br>`  - AA`<br>`- B`<br>`  - C`             | start of B   | `- A`<br>`  - AAB`<br>`  - C`             | C becomes sibling of AA (target AA at depth 1, preserving C's absolute depth 1) |
| `- A`<br>`  - B`<br>`    - C`<br>`- D`<br>`  - E` | start of D   | `- A`<br>`  - B`<br>`    - CD`<br>`  - E` | E stays at depth 1, sibling of B, even though merge point is at depth 2         |
| `- A`<br>`- B`<br>_blank line_<br>`  extra`       | start of B   | `- AB`<br>_blank line_<br>`  extra`       | extra paragraph absorbed into target item's children                            |

The worked examples above are the ground truth for the expected reshuffling; see `src/lib/test/tree-operations/merge-list-item.test.ts` for the matching unit-test coverage.

### Ordered list numbering on M1

- Deleting an item via M1 renumbers subsequent items

## Opaque previous leaf — fall back to move-focus (no merge)

When the previous item's deepest leaf is opaque (not a text-bearing paragraph — a fenced code block, or a collapsed container's chrome), M1 finds no merge target. The gesture makes no structural change and never crashes or dead-keys: the tree is left intact and the caret moves to the end of the previous item's deepest leaf.

- Backspace at start of `text` where the previous item is a fenced code block (` - ```…``` ` then `- text`): no merge, both items survive, caret lands at the end of the previous item's fenced code block.
- Backspace at start of `text` where the previous item's last child is a collapsed container (a collapsed `<details>`): no merge, both items survive, caret lands at the end of the collapsed container's summary (its body stays unmounted). Covered at the unit level by `src/lib/test/tree-operations/merge-list-item.test.ts` (the M1 no-target null) and `src/lib/test/schema/merge-rules-collapse.test.ts` (the walker stopping at the collapsed chrome rather than descending into the unmounted body).
