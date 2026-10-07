# Block: List, Backspace (Rule M1: merge non-first item)

Backspace at offset 0 of a non-empty non-first item merges the current item's first-paragraph text into the deepest visible text above. That's the only line it rewrites: the marker line goes, and every line under the item keeps its bytes, reading wherever a reload puts it.

## M1 merge

- Backspace at start of non-empty non-first item: the current item's first-paragraph text is appended to the "deepest visible text above", the rightmost and deepest text-bearing paragraph reachable by descending into the preceding item's trailing nested lists. The current item's other lines keep their indentation and their blank lines, so a sublist under it joins whichever list sits at that indent above, and a paragraph stays after it at its own indent. Ordered markers renumber. Cursor lands at the merge point (end of target's original text, before appended content).

- Backspace with the caret at raw offset 0 dispatches M1 through the rendered list marker: the `contenteditable="false"` marker span translates the DOM offset to raw 0, so a two-item list merges byte-exactly (`- Item one` + `- Item two` → `- Item oneItem two`) with one surviving marker.

### M1 worked examples (the lines under the item keep their bytes)

| Input                                             | Backspace at | Result                                    | Rule applied                                                                    |
| ------------------------------------------------- | ------------ | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `- A`<br>`- B`                                    | start of B   | `- AB`                                    | flat merge                                                                      |
| `- A`<br>`- B`<br>`  - C`                         | start of B   | `- AB`<br>`  - C`                         | C nests under AB (target A at depth 0)                                          |
| `- A`<br>`  - AA`<br>`- B`<br>`  - C`             | start of B   | `- A`<br>`  - AAB`<br>`  - C`             | C becomes sibling of AA (target AA at depth 1, preserving C's absolute depth 1) |
| `- A`<br>`  - B`<br>`    - C`<br>`- D`<br>`  - E` | start of D   | `- A`<br>`  - B`<br>`    - CD`<br>`  - E` | E stays at depth 1, sibling of B, even though merge point is at depth 2         |
| `- A`<br>`- B`<br>_blank line_<br>`  extra`       | start of B   | `- AB`<br>_blank line_<br>`  extra`       | extra paragraph absorbed into target item's children                            |
| `- a`<br>`- b`<br>_blank line_<br>`      code`    | start of b   | `- ab`<br>_blank line_<br>`      code`    | the moved code block keeps its own blank line                                   |

A sublist and then a paragraph under the merged item stay in that order:
`- i0` / `  - i1` / `    - i2` / `  - i3` / `    - i4` / _blank line_ / `    p5`, Backspace at `i3`, gives
`- i0` / `  - i1` / `    - i2i3` / `    - i4` / _blank line_ / `    p5`, reading i0, i1, i2i3, i4, p5.
Miss-analysis: every row here gave the merged item one kind of child, so no row held a sublist
followed by a paragraph, which the merge used to put above the sublist's items.

The code-block row is a regression (#555): the code block used to lose its blank line and fold into `ab` on reload. Miss-analysis: every moved child in these rows was a paragraph, the one kind the merge gave a separator, so no row moved a block that needed its own blank line kept.

The worked examples above are the ground truth for where the lines end up. The browser drives the flat merge (with the caret landing at the merge point) and the code-block row; rows 2 to 5, the sublist-then-paragraph shape and the ordered renumber are pinned in `src/lib/test/tree-operations/merge-list-item.test.ts` and `src/lib/test/blocks/list/merge-keeps-lines.test.ts`.

### Ordered list numbering on M1

- Deleting an item via M1 renumbers subsequent items (`merge-list-item.test.ts`)

## Opaque previous leaf: fall back to move-focus (no merge)

When the previous item's deepest leaf cannot hold prose (a fenced code block, or the header of a collapsed container), M1 finds nothing to merge into. The gesture makes no structural change, and it neither crashes nor leaves the key doing nothing: the tree is left intact and the caret moves to the end of the previous item's deepest leaf.

- Backspace at start of `text` where the previous item is a fenced code block (` - ```…``` ` then `- text`): no merge, both items survive, caret lands at the end of the previous item's fenced code block.
- Backspace at start of `text` where the previous item's last child is a collapsed container (a collapsed `<details>`): no merge, both items survive, caret lands at the end of the collapsed container's summary (its body stays unmounted). Covered at the unit level by `src/lib/test/tree-operations/merge-list-item.test.ts` (the M1 no-target null) and `src/lib/test/schema/merge-rules-collapse.test.ts` (the walker stopping at the collapsed header rather than descending into the unmounted body).
