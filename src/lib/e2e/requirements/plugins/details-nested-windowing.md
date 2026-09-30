# Feature: Plugin Container, `<details>` Nested Windowing × Clamp

A details whose body has enough children to start windowing on its own, toggled closed, open and
closed again. Every container gets a window of its own (`virtual-rendering.md` § Nesting) and a
collapsed one clamps its body shut (`plugin-contract.md` § Collapsible containers). The clamp and
the nested window share the same slice code, so this stresses where the two meet: children move
in and out of the mounted set, and the
tree has to stay in step with the container's own `BlockListState` (its id and reference arrays)
throughout.

## Happy paths

- open and windowing its own body: a details with a large body windows its own children, so
  spacers appear inside the box and only a slice of the body has mounted hosts
- closing clamps the body: the body collapses to the summary row, every body child unmounts and
  the nested spacers go with them, while the tree's child count is unchanged
- opening remounts and windows again: the body remounts, the spacers reappear, and the first
  body child is really back in the DOM with its text, so the re-opened slice is measured rather
  than left behind
- closing again: the clamp re-engages cleanly on a second close

## Edge cases

- tree and references agree: `auditBlockListStateConsistency` reports no container whose id and
  reference arrays have drifted from its children, across every toggle
- the tree does not depend on windowing: the body's child count is the same closed, open and
  closed again; only the mounted slice of the DOM changes

## User interactions

- clicking the disclosure toggle is a real pointer event; mounting and unmounting are asserted
  through the number of hosts inside the body and the number of nested spacers

## Error cases

- the `[invariant:…]` console watcher stays silent and `getCapturedErrors()` is empty across the
  whole closed, open, closed cycle
