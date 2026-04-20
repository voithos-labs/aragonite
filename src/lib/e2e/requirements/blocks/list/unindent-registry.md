# Block: List Unindent — Ref Alignment via Registry

Regression coverage for the 0.5.1 rewrite that routed `promoteNestedItem`'s two children-mutation sites (nested list item remove, conditional nested-list-empty parent-item remove) through the `BlockListState` registry. Pins the ref-alignment behavior that used to depend on the now-deleted drift `$effect`.

## Happy paths

- Shift+Tab promotes a nested item: promoted item appears at outer list level between the parent item and the following sibling, caret lands at offset 0 of the promoted item
- Shift+Tab on the only nested item: nested list is removed from its parent item entirely (no empty nested-list residue), promoted item is placed at outer level, caret lands at offset 0 of the promoted item

## User interactions

- Click a nested item → Home → Shift+Tab → type a marker: marker appears at start of the promoted item, proving ref-based focus (not DOM-fallback or drift-`$effect`-regenerated) lands correctly
