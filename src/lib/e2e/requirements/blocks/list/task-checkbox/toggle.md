# Block: List — Task Checkbox (toggle and undo)

Click toggling, undo/redo behavior, and uppercase normalization.

## Happy paths

- Clicking an unchecked checkbox (`[ ]`) toggles to checked (`[x]`); source reflects the new state.
- Clicking a checked checkbox (`[x]`) toggles to unchecked (`[ ]`); source reflects the new state.

## User interactions

- Click → Ctrl+Z restores pre-toggle source and unchecked state.
- Click → Ctrl+Z → Ctrl+Y restores post-toggle source and checked state.
- Uppercase variant `[X]` parses to checked; after a toggle, the marker normalizes to canonical `[x]` (documented behavior).
- A click on the list marker span (the `- ` the rendered modes collapse to nothing) changes no bytes.
- An ordered task (`1. [ ] first`) toggles to `1. [x] first`: the box is the only byte the toggle touches.
