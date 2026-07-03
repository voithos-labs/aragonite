# Feature: Plugin Container — `<details>` Nested Windowing × Clamp

Spec §8.2. A details whose body has enough children to activate its own nested
windowing, toggled through closed → open → closed. The collapse clamp and the
nested window share the slice machinery, so this stresses the seam where the two
meet: children churn in and out of the mounted set, and the CST must stay in
lockstep with the per-container BlockListState (id/ref arrays) throughout.

## Happy paths

- open + nested-windowed: a details with a large body windows its own children —
  spacers appear inside the box and only a slice of the body hosts mount
- toggle closed clamps: the body collapses to the summary row (every body child
  unmounts, the nested spacers go with it) while the CST child count is unchanged
- toggle open re-mounts and re-windows: the body remounts, spacers reappear, and
  the first body child is genuinely back in the DOM with its text (the re-expanded
  slice is measured, not stranded)
- re-close: the clamp re-engages cleanly on a second close

## Edge cases

- CST/ref consistency: `auditBlockListStateConsistency` reports no container whose
  id/ref arrays drifted from its children across every toggle
- CST is windowing-independent: the body child count is the same closed, open, and
  re-closed — only the mounted DOM slice changes

## User interactions

- clicking the disclosure toggle is a real pointer event; the mount/unmount is
  asserted via the scoped body-host count and the nested spacer count

## Error cases

- the `[invariant:…]` console watcher stays silent and `getCapturedErrors()` is empty
  across the full closed→open→closed cycle
