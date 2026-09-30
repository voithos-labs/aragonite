# Feature: Public caret entry points under a live cross-block range

The public calls a consumer can move the caret through while a cross-block range is
live: `setSelection` on the editor API, and `BlockComponent`'s two caret methods through
the test bridge. No gesture-level spec reaches them, because every built-in caret
placement travels a pointer or keyboard path that ends the range on its way in, so a
consumer calling them directly is the only observer of what they do to a live range.

`focus` and `setSelection` agree: both state a new caret and end the old range. That is
the safe default, and it is safe because of what the document does otherwise: a caret
that lands inside a range left live is content the next keystroke replaces, which
shipped twice. `parkCaret` is the deliberate exception, for the selection-extend paths
only: the cross-block dispatcher places a caret in an endpoint it has just mounted while
the extend is still growing the range a `focus` would cancel.

## Happy paths

- `setSelection` to a collapsed position ends the live cross-block range: the editor
  reports no cross-block selection afterwards, and the next typed character inserts at
  the collapsed caret instead of replacing the range (both outer paragraphs survive)
- `BlockComponent.focus` ends the live cross-block range, so the next typed character
  inserts at the placed caret instead of replacing the whole document
- `BlockComponent.parkCaret` places the caret and leaves the cross-block range live,
  which is what `revealActiveEndpoint` depends on mid-extend

## Edge cases

- `focus` lands at a path inside the live range (the reproduction the original defect
  used), so the test cannot pass by an accident of position: the range must be ended by
  the call, not by the caret happening to fall outside it
- `parkCaret` is optional in the contract. The bridge reports `false` for a block
  that omits it rather than falling back to `focus`, so a missing method reads as a
  missing method instead of as a silently ended range

## User interactions

- the cross-block range is built by real keys (caret to block 0's start, then double
  Ctrl+A) and waited for through the cross-block wait, so every call acts on a range the
  editor entered the way a user would
- the type-replace check types a real character and waits for the source to carry it,
  so what is measured is the document a keystroke would have destroyed
