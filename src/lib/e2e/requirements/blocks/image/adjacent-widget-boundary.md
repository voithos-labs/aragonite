# Feature: caret at a boundary two adjacent image widgets share

When two image widgets sit flush against each other (`![a](…)![b](…)`), the caret
between them touches both — the trailing edge of the first and the leading edge of
the second. The caret-edge dispatch must resolve that boundary by key direction so
a plain edit key enters the intended widget instead of falling through to native
contenteditable, which would delete the whole `contenteditable=false` island in one
press with no select step.

## Happy paths

- Delete at the boundary: selects the following widget (leading edge) — its overlay
  appears and its source survives; a second press would delete it.
- ArrowRight at the boundary: selects the following widget rather than skipping past
  its entry.
- Backspace at the boundary: selects the preceding widget (trailing edge).

## Edge cases

- The following widget's source is never silently removed by a single forward press.

## User interactions

- Place the caret between two adjacent image widgets, press Delete / ArrowRight /
  Backspace, assert the selected widget and the surviving source.

## Error cases

- pre-fix regression: a forward Delete at the boundary resolved to the preceding
  widget's trailing edge, consumed nothing, and let native delete wipe the whole
  following image.
