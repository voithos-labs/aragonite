# Feature: needsUndoCheckpoint resets across typing/structural-op boundaries

## Happy paths

- Type 5 chars (batch A), press Enter to split (structural op), type 5 chars in the new block (batch B). Three Ctrl+Z presses walk back in order: batch B → split → batch A. Fourth Ctrl+Z is a no-op on the original doc.

## Edge cases

- Type, click into a different block, type: two independent batches separated by the focus change, not the structural op.
- Type, pause past the debounce window, type more in the same block: two batches (debounce expired).

## Regression notes

- Guards the closed "needsUndoCheckpoint drifts wrong" defect class.
