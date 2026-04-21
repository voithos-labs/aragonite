# Feature: one edit event per structural op (multi-scope sites)

Regression guard for 0.5.5.3: every structural operation that was migrated
to `commitMultiScope` must fire exactly one `edit` event per user action.
Pre-migration, several list-context and cross-block ops called
`beginContainerEdit` + `endContainerEdit` as a bracket pair around multiple
mutations, which could fire zero or two events depending on code path.

## Migrated sites covered

- `indentItem` (Tab on a list item) — one edit event
- `unindentItem` via `promoteNestedItem` (Shift+Tab on a nested item) — one edit event
- `promoteNestedItem` direct call (same user gesture as unindentItem) — covered by unindentItem test
- `splitItemAtOffset` (Enter mid-item) — one edit event; pre-fix emitted two
- `insertItemAfter` (Enter at end of item) — one edit event
- `blockquote splitBlock exit` (Enter on empty trailing paragraph inside blockquote) — one edit event
- `cross-block delete` (Backspace/Delete spanning two containers) — one edit event

## Identity preservation (cross-block delete, mixed scope)

When a cross-scope delete spans two list items and the start item's content
merges with content after the end path, the surviving list item keeps the
**start item's** original id, not the end item's id.

Scenario: `- alpha\n- beta\n\nfollow\n`, Shift+select from `[0,0,0]` offset 1
to `[1]` offset 3, Delete. The surviving merged item at position 0 must carry
the id that was assigned to `alpha`'s list item before the delete.

Known status: this is a known identity-preservation issue in
`computeScopeDescriptor` for mixed-scope deletes (start descends into the
list, end is at top level). Tracked as a fixme until a follow-up fix lands.
