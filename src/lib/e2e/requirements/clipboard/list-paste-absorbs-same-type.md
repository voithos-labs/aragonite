# Clipboard: Same-Type List Paste Absorbs Into Enclosing List

When the clipboard's top block is a list whose ordered-flag matches the nearest list ancestor of the target, pasting inside a list item splices the pasted items as siblings of the target in the enclosing list, then renumbers (for ordered lists). Complements `list-paste-mismatched-breaks-out` (which handles the type-mismatched case) and `list-paste-flattens-into-matching-list` (which handles the empty-target and cross-block cases via container-match).

Design reason: the user copied a list of the same type; flattening preserves the "items are siblings at the same level" intent. Three separate lists (the old break-out result for same-type) produced confusing duplicated markers like `1. alpha / 1. x / 2. y / 2. beta`. Nesting as a sub-list under the target (the pre-0.6.1.4 behavior) was also surprising — users didn't type a Tab to indent. Flat absorption matches Obsidian and Google Docs.

## Happy paths

- Ordered paste at end of ordered item: pasted items become siblings immediately after the target, all renumbered continuously (`1. alpha, 2. x, 3. y, 4. beta`).
- Ordered paste at start of ordered item: pasted items become siblings before the target; target keeps its content.
- Ordered paste in middle of ordered item: target splits into leading and trailing items; pasted items sandwich between them; continuous renumbering across the whole list.
- Unordered paste at end of unordered item: same shape, flat single list with all items as siblings.
- Single-item ordered paste at end of target: pasted item slots in as one new sibling.

## Edge cases

- Target is an empty list item: handled earlier by `findContainerMatchingUnwrap`. Absorb does not fire.
- Cross-block paste that happens to land in a same-type list: handled by `findContainerMatchingUnwrap`'s merge variant. Absorb does not fire.
- Mismatched ordered-flag between clipboard and target: absorb declines; `findListBreakOut` handles the break-out path.
- Multi-block clipboard (e.g. `list + paragraph`): absorb declines (`parsed.children.length !== 1` guard). Falls through to `findListBreakOut` → break-out preserves the multi-block structure at the enclosing list's parent level.
- Target deeper than a direct leaf of the listItem: absorb declines. Default structural paste applies (rare; may revisit).
- Pasted items with a different ordered-marker suffix (`1) ` into a `1. ` list): suffix coerces to match the parent's template; `1. alpha, 2. x, 3. y, 4. beta` with uniform `. ` suffix throughout.
- Trailing slice of a word-boundary split trims one leading whitespace character so the resulting trailing item serializes with a single-space marker.
