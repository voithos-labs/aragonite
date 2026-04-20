# Feature: cross-block paste → Ctrl+Z → Ctrl+Y round-trip

## Happy paths

- Paste 2 blocks over a 3-block selection, Ctrl+Z (restores original and reactivates the pre-paste cross-block selection), Ctrl+Y (re-applies paste). After redo, source matches the post-paste state and the selection is collapsed at the end of the last pasted block (matching where the original paste left the cursor).

## Edge cases

- Redo stack cleared on any new edit after undo: Ctrl+Z, type 'x', Ctrl+Y is a no-op.

## Regression notes

- One-direction undo passes today (partially); the redo path is where finickiness lingers.
