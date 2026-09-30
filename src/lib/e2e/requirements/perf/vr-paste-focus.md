# Feature: Virtual rendering, post-paste caret under container windowing

A structural paste lands the caret at the end of the pasted run. That landing index
scales with the clipboard's item count, not with where the caret was, so a paste
larger than the container window's overscan targets an unmounted item. The landing
scrolls to and mounts the target before placing the caret (VR-12).

Focus is asserted by typing a character and reading where it appears. A source
assertion cannot cover this: the pasted bytes are identical whatever the caret did.

## User interactions

- Paste a list of many items into an item near the top of a windowed list: after the
  paste, the caret is in the last pasted item (never the split residue) and typing
  appends there.

## Error cases

- The typed character must reach the document at all. Losing it entirely is what the
  defect looked like: a real user pasted, typed, and nothing happened.

## Synchronization

The source is final at commit time, before the landing item has been scrolled to and
mounted. The spec therefore waits on the caret, polling the landing block's editable
element, rather than on the pasted bytes. Waiting on the source alone would type into
whatever still held focus and pass or fail on scheduling luck.

## Non-vacuity

- Container windowing must be active for the scenario to mean anything; the spec
  asserts a `.vr-spacer` exists inside the list before pasting, so a fixture that
  stops clearing the 4000px threshold fails loudly instead of passing trivially.
