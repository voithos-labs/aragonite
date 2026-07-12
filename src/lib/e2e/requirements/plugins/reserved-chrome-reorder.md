# Feature: Opaque containers decline nested reorder (no chrome/body drag affordance)

A plugin (opaque) container — admonition, `<details>`, callout — is not a
reorderable parent. `resolveReorderUnit` stops at its boundary and declines, so a
nested body leaf has no reorder unit: drag and keyboard reorder are clean no-ops.
The inner `BlockList` renders `reorderable: false`, so neither the reserved chrome
row (title / summary) nor the body rows render a drag handle. The container itself
stays a valid top-level reorder unit. Behavioral gate: CST/source/handle-count
read by path via `window.__test`, not visuals.

## Bug 2 — no dead drag affordance

- admonition title chrome row (`[c, 0]`): no `.block-drag-handle`
- admonition body rows (`[c, 1]`, `[c, 2]`): no `.block-drag-handle`
- `<details>` summary chrome row (`[c, 0]`): no `.block-drag-handle`
- the container's own host (`[c]`): keeps its handle — a legitimate top-level unit

## Bug 1 — the shared resolver declines (both entry paths)

- Alt+ArrowUp on an admonition body paragraph: byte-exact no-op; root stays one admonition (no teleport)
- Alt+ArrowDown on an admonition body paragraph: byte-exact no-op
- a no-op Alt+Arrow pushes no undo entry: after typing a char then a declined Alt+Arrow, one Ctrl+Z reverts the typed char, not a phantom reorder

## Regression — the container itself still reorders

- dragging the admonition's own handle down past a sibling reorders it at document level; root count unchanged (no drop or duplication)

## User interactions

- real pointer hover + drag on the container's own handle, real keyboard Alt+Arrow / typing / Ctrl+Z; assertions read source/CST/handle-count by path, never DOM text shape
