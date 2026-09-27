# Feature: needsUndoCheckpoint resets across typing/structural-op boundaries

## Happy paths

- Type 5 chars (batch A), press Enter to split (structural op), type 5 chars in the new block (batch B). Three Ctrl+Z keypresses walk back in order: batch B → split → batch A. Fourth Ctrl+Z does nothing to the original doc.

## Edge cases

- Type, click into a different block, type: two independent batches separated by the focus change, not the structural op.
- Type, pause past the debounce window, type more in the same block: two batches (debounce expired).

## A burst that ends in a kind change

- `Plan\n===\n`, caret at the end of the underline, Backspace three times (the third makes it a paragraph), one Ctrl+Z: the source is back to `Plan\n===\n`, caret where the burst started
- The same inside a quote, `> Plan\n> ===\n`: one Ctrl+Z restores it (regression #471: the kind-changing key was its own undo step inside a container; miss-analysis: the batch tests typed same-kind bursts and the kind-change tests typed one key at the top level, so no test ended a burst with a kind change below the root)
- The same inside a list item, `- Plan\n  ---\n`: one Ctrl+Z restores it (the erased underline also trips the dev stale-raw check, a separate defect the spec declares)
- `- a\n\n  abcdef`, `>` typed at the start of `abcdef`: one Ctrl+Z restores the text with the caret back at its start, `[0,0,1]` offset 0 (regression #22: the undo put the caret after the typed `>`; miss-analysis: the kind change's own commit recorded the caret as it stood after the key, and no test read the caret an undo restores below the root)

## Regression notes

- Guards the closed "needsUndoCheckpoint drifts wrong" defect class.
