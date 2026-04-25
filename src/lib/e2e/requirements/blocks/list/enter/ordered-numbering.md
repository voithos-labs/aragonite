# Block: List — Enter (ordered list numbering)

Renumbering rules when Enter inserts, splits, or exits an item inside an ordered list.

## Ordered list numbering on Enter

- New item gets the next sequential number after the previous item
- Subsequent items are renumbered (e.g., inserting between 1 and 2 produces 1, 2, 3)
- Enter at start of first item: the new empty first item gets the original first number, original item renumbers
- Enter on empty first item renumbers remaining items from 1 (e.g., `1. empty / 2. x` → `1. x`)
- Enter on empty middle item renumbers the surviving second half to continue the sequence uninterrupted across the exit gap (e.g., `1. a / 2. b / 3. empty / 4. c` → first list `1. a / 2. b`, paragraph, second list `3. c`). The exit paragraph is treated as a description between items, not as a numbered slot — matches Google Docs / Obsidian behavior.
- Double-Enter from the end of a middle item exits the list with continuous renumbering: the first Enter creates an empty sibling, the second Enter exits; the trailing item renumbers as if the inserted-then-exited slot never existed (e.g., `1. one / 2. two|` + Enter + Enter + `3. three` remains `3. three`, not `4.`)
- Enter at the end of the last item in a loose list (blank line between siblings) appends a new item continuing the sequence (e.g., `1. a / 2. b / [blank] / 3. c` + Enter at end of c → a new `4.` item). The blank line is descriptive trivia and doesn't terminate numbering.
