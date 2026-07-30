# Feature: Public caret doors under a live cross-block range

The two public doors a consumer can move the caret through while a cross-block range is
live: `setSelection` on the editor API and `BlockComponent.focus` through the test
bridge. No gesture-level spec reaches either — every built-in caret placement travels a
pointer or keyboard path that ends the range on its way in — so a consumer calling them
directly is the only observer of what they do to a live range.

The two doors behave differently, and the difference is the contract: `focus` parks a
caret and leaves the range alone (the cross-block dispatcher itself parks that way
mid-extend, so the primitive cannot end a range), while `setSelection` states a new
selection and ends the old one. A consumer moving the caret because the USER acted wants
the second door.

## Happy paths

- `setSelection` to a collapsed position ends the live cross-block range: the editor
  reports no cross-block selection afterwards, and the next typed character inserts at
  the collapsed caret instead of replacing the range (both outer paragraphs survive)
- `BlockComponent.focus` parks the caret at the requested path/offset, returns `true`,
  and leaves the cross-block range live — the park semantics `revealActiveEndpoint`
  depends on while an extend is still growing the range

## Edge cases

- range-ending is deliberately absent from the `focus` path: seating it there was tried
  and reverted, because it reds three cross-block extend specs. This file is the pin that
  keeps the asymmetry from drifting back silently.

## User interactions

- the cross-block range is built by real keys — caret to block 0's start, then double
  Ctrl+A — and settled through the cross-block wait, so both doors act on a range the
  editor entered the way a user would
