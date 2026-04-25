# Feature: One Edit Event per Op — List-Context Operations

Regression guard: every list-context structural op migrated to `commitMultiScope` must fire exactly one `edit` event per user gesture.

## Migrated sites covered

- `indentItem` (Tab on a list item) — one edit event
- `unindentItem` via `promoteNestedItem` (Shift+Tab on a nested item) — one edit event
- `splitItemAtOffset` (Enter mid-item) — one edit event; pre-fix emitted two
- `insertItemAfter` (Enter at end of item) — one edit event
