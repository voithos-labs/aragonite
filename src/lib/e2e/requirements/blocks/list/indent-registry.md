# Block: List Indent — Ref Alignment via Registry

Regression coverage for the 0.5.1 rewrite that routed `indentItem`'s two children-mutation sites (existing-nested-list push, fresh-nested-list push) through the `BlockListState` registry. Pins the ref-alignment behavior that used to depend on the now-deleted drift `$effect`.

## Happy paths

- Tab-indent into an existing nested list: moved item is appended, caret lands at offset 0 of the moved item (verified by typing a marker and asserting its position)
- Tab-indent into a fresh nested list: new nested list is created under the previous sibling, moved item placed inside, caret lands at offset 0 of the moved item

## User interactions

- Click an item → Home → Tab → type a marker: the marker appears at the start of the indented item, proving the ref-based focus (not a stale ref under the old drift-`$effect` compensation) lands correctly
