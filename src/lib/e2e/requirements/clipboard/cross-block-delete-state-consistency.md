# Feature: cross-block delete — BlockListState consistency (0.5.5.3 regression guard)

Regression guard for the 0.5.5.3 multi-scope commit rework. Before the
rework, `performCrossBlockDelete` synced only the top-level doc's
`innerBlockIds`/`innerBlockRefs` after a range delete. When the delete
reached into a nested container, that container's registered `BlockListState`
still held ids/refs from the pre-delete children array. The keyed `{#each}`
then keyed components against stale ids, producing zombie components (Bug A
class).

The invariant asserted by these tests: for every container with a registered
`BlockListState`, `node.children.length === state.innerBlockIds.length`.

## Scenarios

### 1. Cross-block delete spanning a blockquote and a top-level paragraph

Start caret inside the top-level paragraph that precedes a blockquote; shift-
select into the first inner paragraph of the blockquote; Backspace. The
blockquote's `BlockListState` must reflect the post-delete children count, not
the pre-delete count.

### 2. Cross-block delete spanning two list items

Three-item list. Select from mid-first-item to mid-third-item; Backspace.
The enclosing list's `BlockListState` shrinks from three items to one (merged
content); its `innerBlockIds` must match the post-delete `node.children`
length.

### 3. Mixed top-level + list cross-block delete

Select from inside a list item's paragraph to a following top-level paragraph;
Backspace. Both the list's `BlockListState` and the surviving list item's
`BlockListState` must stay in sync with their respective `node.children`
lengths after the delete and any cascade cleanup.

### 4. Deeply-nested list cross-block delete

Outer list contains an item whose children include a nested sub-list. Select
from the outer first item's paragraph to a paragraph inside the nested sub-
list's second item; Backspace. Both the outer list's and the nested list's
`BlockListState` instances must remain consistent — depth is not an excuse for
desyncing.

### 5. Cross-block delete ending in a table body cell (regression)

Paragraph above a table; shift-click into a body cell and Backspace. The
whole-row snap splices rows out of `table.children`, so the table must commit
as its own scope: its row `BlockListState` ids/refs shrink with the surviving
rows. Regression guard for the stale-row-ids bug where the endpoint table was
never a commit scope and only strict ancestors were collected.
