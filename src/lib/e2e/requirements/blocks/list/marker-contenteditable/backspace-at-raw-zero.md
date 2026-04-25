# Block: List — Backspace at Raw Offset 0

Backspace at raw offset 0 of a list item dispatches U1 (first item) or M1 (non-first item) just as if the marker were not there.

## User interactions

- Backspace at raw offset 0 of first item: U1 unwrap (paragraph lifts out).
- Backspace at raw offset 0 of non-first item: M1 merge into previous item's deepest prose leaf.
