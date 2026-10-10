# Clipboard: Same-Type List Paste Absorbs Into Enclosing List

When the clipboard's top block is a list whose ordered-flag matches the nearest list ancestor of the target, pasting inside a list item splices the pasted items as siblings of the target in the enclosing list, then renumbers (for ordered lists). Complements `list-paste-mismatched-breaks-out` (which handles the type-mismatched case) and `list-paste-flattens-into-matching-list` (which handles the empty-target and cross-block cases via container-match).

Design reason: the user copied a list of the same type; flattening preserves the "items are siblings at the same level" intent. Three separate lists (the old break-out result for same-type) produced confusing duplicated markers like `1. alpha / 1. x / 2. y / 2. beta`. Nesting as a sub-list under the target was also surprising: users did not type a Tab to indent. Flat absorption matches Obsidian and Google Docs.

## Happy paths

- Ordered paste at end of ordered item: pasted items become siblings immediately after the target, all renumbered continuously (`1. alpha, 2. x, 3. y, 4. beta`).

## Edge cases

- Target is an empty list item, or a cross-block paste lands in a same-type list: handled earlier by `findContainerMatchingUnwrap` (and its merge variant). Absorb does not fire.
- Mismatched ordered-flag between clipboard and target: absorb declines; `findListBreakOut` handles the break-out path.
- Multi-block clipboard (e.g. `list + paragraph`): absorb declines (`parsed.children.length !== 1` guard). Falls through to `findListBreakOut` → break-out preserves the multi-block structure at the enclosing list's parent level.
- Target deeper than a direct leaf of the listItem: absorb declines. Default structural paste applies (rare; may revisit).

## Pinned below the browser

Each row pastes into a list without a page and checks the whole list after, numbering included:

- An ordered paste at the start of an item lands the pasted items before it (`test/tree-operations/paste/list-absorb-rows.test.ts`).
- An ordered paste in the middle of an item splits it and puts the pasted items between the halves (`test/tree-operations/paste/list-absorb-rows.test.ts`).
- An ordered paste at the end of a middle item lands between it and the rest (`test/tree-operations/paste/list-absorb-rows.test.ts`).
- An unordered paste at the end of an item absorbs as flat siblings (`test/tree-operations/paste/list-absorb-rows.test.ts`).
- A single pasted item slots in as one new sibling (`test/tree-operations/paste/list-absorb-rows.test.ts`).
- A list that doesn't start at 1 keeps counting from its own first number (`test/tree-operations/paste/list-absorb-rows.test.ts`).
- Pasted items with a different ordered-marker suffix (`1) ` into a `1. ` list) take the enclosing list's style (`test/tree-operations/paste/list-absorb-rows.test.ts`).
- A clipboard with no trailing newline still absorbs as separate items, and the trailing slice of a word-boundary split keeps its leading space after its marker (`7.  third`), the same as Enter there (`test/tree-operations/paste/list-absorb-rows.test.ts`).
