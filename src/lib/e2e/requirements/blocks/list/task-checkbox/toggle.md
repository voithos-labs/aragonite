# Block: List, Task Checkbox (toggle and undo)

Click toggling, undo/redo behavior, and uppercase normalization.

## Happy paths

- Clicking an unchecked checkbox (`[ ]`) toggles to checked (`[x]`), and clicking a checked one toggles it back; source reflects the new state. `src/lib/test/blocks/list/item-task-toggle.test.ts` pins both directions.

## User interactions

- Click → Ctrl+Z restores the source and the unchecked state as they were before the toggle, and Ctrl+Y restores the checked state as it was after the toggle.
- Uppercase variant `[X]` parses to checked; after a toggle, the marker normalizes to canonical `[x]` (documented behavior).
- A click on the list marker span (the `- ` the rendered modes collapse to nothing) changes no bytes.
- An ordered task (`1. [ ] first`) toggles to `1. [x] first`: the box is the only byte the toggle touches.
