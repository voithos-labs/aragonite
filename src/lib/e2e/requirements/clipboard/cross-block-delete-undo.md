# Feature: cross-block delete — Ctrl+Z restores content and cross-block selection state

## Happy paths

- Select across 3 blocks, press Delete: content deleted, selection collapsed. Ctrl+Z: content restored AND cross-block selection state reactivates with original anchor/focus.

## Edge cases

- Cut (Ctrl+X) across 3 blocks, undo: content restored; cross-block selection restored.
- Backspace across a cross-block range: identical undo semantics as Delete.

## Regression notes

- Guards the closed "sometimes fails to restore pre-operation selection" defect after cross-block delete.
