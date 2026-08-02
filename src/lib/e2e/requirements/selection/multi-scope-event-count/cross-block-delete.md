# Feature: One Edit Event per Op — Cross-Block Delete (and identity)

Cross-block delete spanning multiple containers fires exactly one edit event; mixed-scope deletes preserve the start item's id on the surviving list item.

## Migrated sites covered

- `cross-block delete` (Backspace/Delete spanning two containers) — one edit event

## Identity preservation (cross-block delete, mixed scope)

When a cross-scope delete spans two list items and the start item's content merges with content after the end path, the surviving list item keeps the **start item's** original id, not the end item's id.

Scenario: `- alpha\n- beta\n\nfollow\n`, Shift+select from `[0,0,0]` offset 1 to `[1]` offset 3, Delete. The surviving merged item at position 0 must carry the id that was assigned to `alpha`'s list item before the delete.

Known status: this is a known identity-preservation issue in `computeScopeDescriptor` for mixed-scope deletes (start descends into the list, end is at top level). Tracked as issue #74.
