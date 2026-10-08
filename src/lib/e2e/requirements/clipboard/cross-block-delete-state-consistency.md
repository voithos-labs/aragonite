# Feature: cross-block delete, BlockListState consistency (0.5.5.3 regression guard)

Regression guard for the 0.5.5.3 multi-scope commit rework. The defect:
the cross-block delete synced only the top-level doc's
`innerBlockIds`/`innerBlockRefs` after a range delete, so when the delete
reached into a nested container, that container's registered `BlockListState`
still held the ids and refs from the children array before the delete. The
keyed `{#each}` then keyed components against stale ids, producing zombie
components (Bug A class).

The invariant asserted by these tests: for every container with a registered
`BlockListState`, `node.children.length === state.innerBlockIds.length`.

## Scenarios

### 1. Cross-block delete spanning two list items

Three-item list. Select from mid-first-item to mid-third-item; Backspace.
The enclosing list's `BlockListState` shrinks from three items to one (merged
content); its `innerBlockIds` must match the post-delete `node.children`
length.

### 2. Mixed top-level + list cross-block delete

Select from inside a list item's paragraph to a following top-level paragraph;
Backspace. Both the list's `BlockListState` and the surviving list item's
`BlockListState` must stay in sync with their respective `node.children`
lengths after the delete and any cascade cleanup.

### 3. Deeply-nested list cross-block delete

Outer list contains an item whose children include a nested sub-list. Select
from the outer first item's paragraph to a paragraph inside the nested sub-
list's second item; Backspace. Both the outer list's and the nested list's
`BlockListState` instances must remain consistent: depth is no excuse for
falling out of sync.

## Pinned below the browser

A delete spanning a blockquote and the paragraph before it, and a delete from a paragraph into a table
body cell, leave every registered `BlockListState` in step with its children. Both run in
`test/selection/cross-block/cross-block-delete-sync.test.ts` and
`test/selection/cross-block/cross-block-delete-table-scope.test.ts`.
The cell delete was the stale-row-ids regression: the endpoint table was never a commit scope, so its
row state kept the ids from before the whole-row snap.
