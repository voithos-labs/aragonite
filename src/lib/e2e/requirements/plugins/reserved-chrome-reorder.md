# Feature: Opaque containers decline nested reorder (no handle on the title row or the body)

An opaque plugin container, an admonition, a `<details>` or a callout, is not a parent whose
children can be reordered. `resolveReorderUnit` stops at its boundary and declines, so a body
leaf inside it has nothing to reorder and both the drag and the keyboard reorder do nothing at
all. Its kind declares no `reorderChildren`, so the inner `BlockList` isn't reorderable and
neither the reserved title row (a title or a summary) nor the body rows render a drag handle. The
container itself is still a valid thing to reorder at the top level. These checks read behavior: the tree, the source and
the number of handles read by path through `window.__test`, not visuals.

## Bug 2: no dead drag affordance

- the admonition's title row (`[c, 0]`): no `.block-drag-handle`
- the admonition's body rows (`[c, 1]`, `[c, 2]`): no `.block-drag-handle`
- the `<details>` summary row (`[c, 0]`): no `.block-drag-handle`
- the admonition's own host (`[c]`): no handle either, since a note reads as prose
- the `<details>` host (`[c]`): keeps its handle, since it is a real unit at the top level

## Bug 1: the shared resolver declines (both entry paths)

- Alt+ArrowUp on an admonition body paragraph: nothing happens, byte for byte, and the root still holds one admonition, which does not jump anywhere
- Alt+ArrowDown on an admonition body paragraph: nothing happens, byte for byte
- an Alt+Arrow that does nothing pushes no undo entry: after typing a character and then a declined Alt+Arrow, one Ctrl+Z takes back the typed character rather than a reorder that never happened

## Regression: the container itself still reorders

- dragging the `<details>` own handle down past a sibling moves it at document level, and the root's block count is unchanged, so nothing is dropped or duplicated

## User interactions

- a real pointer hover and drag on the container's own handle, and real keyboard Alt+Arrow, typing and Ctrl+Z; the assertions read the source, the tree and the number of handles by path, never the shape of the DOM text
