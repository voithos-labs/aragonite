# Feature: a plugin editable leaf under a marker-hiding mode

The `%%` memo kind (`createEditableLeaf({ mode: 'plain' })`) driven under `live`. The mode is
the only thing that changes, so the expected bytes deliberately repeat the plain-leaf battery's.
What is new is that a plugin's own editable area takes real keystrokes while the mode hides the
markers. The shared fixture's console watch comes along, so any `[invariant:…]` message fails
the run, including G1.33, the check that the caret sits at an offset it is allowed to sit at.

## Live mode

- arrowing from the paragraph above into the memo, then typing at its end: the caret settles in
  the leaf, the bytes land in the source after the text already there, and the document still
  round-trips.

## Miss-analysis

- No plugin e2e test drove a plugin kind under a marker-hiding mode, so the check's reach over
  plugin-owned editable areas was written down in the invariant catalog and never exercised.
