# Block: List, Enter (ordered list numbering)

How Enter numbers an ordered list when it inserts, splits or exits an item. The renumber starts at
the new item and counts on from the item above it, by 0 when the list's first two numbers match
and by 1 otherwise. The items above keep their numbers.

## Ordered list numbering on Enter

- The new item gets the number after the item above it, and the items after it count on (inserting between 1 and 2 produces 1, 2, 3)
- A list whose first two numbers match keeps them: Enter at the end of `a` in `1. a / 1. b / 1. c` gives `1. a / 1. / 1. b / 1. c`
- `0.` is a start like any other: Enter at the end of `a` in `0. a / 1. b` gives `0. a / 1. / 2. b`
- Any other spacing counts by 1 from the new item: Enter at the end of `a` in `3. a / 5. b / 7. c` gives `3. a / 4. / 5. b / 6. c`
- Enter at start of first item: the new empty first item gets the list's first number, and the items after it count on from it
- Enter on empty first item: the remaining items count on from the list's first number (e.g., `1. empty / 2. x` → `1. x`)
- Enter on empty middle item renumbers the surviving second half to continue the sequence uninterrupted across the exit gap (e.g., `1. a / 2. b / 3. empty / 4. c` → first list `1. a / 2. b`, paragraph, second list `3. c`). The exit paragraph counts as a description between items rather than a numbered position, which is what Google Docs and Obsidian do. The first half keeps its numbers.
- Double-Enter from the end of a middle item exits the list with continuous renumbering: the first Enter creates an empty sibling, the second Enter exits; the trailing item renumbers as if the inserted-then-exited item had never existed (e.g., `1. one / 2. two|` + Enter + Enter + `3. three` remains `3. three`, not `4.`)
- The same double-Enter, at the top level and in a quote, leaves one blank line and then the empty paragraph between the list's two halves, with nothing after it (`1. one / 2. two / [blank] / [empty] / 3. three`, the empty paragraph reading as a blank line itself), and typing `lead` there gives `lead` with a blank line on each side. A second blank line would reload as a second empty paragraph (miss-analysis: these rows matched lines one at a time, so an extra blank line between them never failed one)
- Enter at the end of the last item in a loose list (blank line between siblings) appends a new item continuing the sequence (e.g., `1. a / 2. b / [blank] / 3. c` + Enter at end of c → a new `4.` item). The blank line is spacing and does not end the numbering.

Miss-analysis: every numbering row counted up by 1 from 1, where a renumber that always steps by 1
writes the bytes the author wrote. The rule over every list route and spelling is the unit table
`src/lib/test/editor-actions/ordered-renumber-rule.test.ts`.
