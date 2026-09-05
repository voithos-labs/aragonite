# Feature: One Edit Event per Op — Cross-Block Delete (and identity)

Cross-block delete spanning multiple containers fires exactly one edit event; mixed-scope deletes preserve the start item's id on the surviving list item.

## Migrated sites covered

- `cross-block delete` (Backspace/Delete spanning two containers) — one edit event

## Identity preservation (cross-block delete, mixed scope)

When a cross-scope delete spans two list items and the start item's content merges with content after the end path, the surviving list item keeps the **start item's** original id, not the end item's id.

Scenario: `- alpha\n- beta\n\nfollow\n`, Shift+select from `[0,0,0]` offset 1 to `[1]` offset 3, Delete. The surviving merged item at position 0 must carry the id that was assigned to `alpha`'s list item before the delete.

Pinned: the spec's identity test drives this scenario with real gestures, and `computeScopeDescriptor`'s mixed-depth branch maps the survivor to the start item's id (fixed pre-0.6 in `ec2d02031`, which unblocked the spec's fixme). Issue #74 was filed from this paragraph while it still read Known-status.

Miss-analysis (#74): no test missed anything; the fix commit flipped the spec but not this paragraph, and the issue was later minted from the stale prose. Requirement status reconciles against the spec, never against its own text.
