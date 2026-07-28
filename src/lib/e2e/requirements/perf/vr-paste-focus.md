# Feature: Virtual rendering — post-paste caret under container windowing

The container-matching paste lands the caret at the end of the pasted run. Its
landing index scales with the CLIPBOARD's item count, not with where the caret was,
so a paste larger than the container window's overscan targets an unmounted item.
The sync focus dispatcher cannot reveal an off-window head (VR-12), so it returns
silently and the caret is lost.

Focus is asserted by typing a marker and reading where it appears. A source
assertion cannot cover this: the pasted bytes are identical whatever the caret did.

## User interactions

- Paste a list of many items into an item near the top of a windowed list: after the
  paste, typing appends to the end of the last pasted item.

## Error cases

- The typed marker must reach the document at all. Losing it entirely is the shape
  the defect produces today: a real user pastes, types, and nothing happens.

## Known defect

This scenario currently FAILS. The spec pins it by asserting the INVERTED outcome (the
marker reaches the document nowhere), with every precondition left as a hard assertion,
so the file turns red the day the focus path is fixed. Re-inverting it is part of that fix. Ledger entry: `docs/issues.md` § Virtual rendering.

## Non-vacuity

- Container windowing must be active for the scenario to mean anything; the spec
  asserts a `.vr-spacer` exists inside the list before pasting, so a fixture that
  stops clearing the 4000px watermark fails loudly instead of passing trivially.
