# Feature: cross-block paste → Ctrl+Z → Ctrl+Y round-trip

## Happy paths
- Paste 2 blocks over a 3-block selection, Ctrl+Z (restores original), Ctrl+Y (re-applies paste). Source and cross-block selection match the post-paste state exactly.

## Edge cases
- Redo stack cleared on any new edit after undo: Ctrl+Z, type 'x', Ctrl+Y is a no-op.

## Regression notes
- One-direction undo passes today (partially); the redo path is where finickiness lingers.
