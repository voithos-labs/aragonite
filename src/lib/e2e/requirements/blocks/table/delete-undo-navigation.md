# Feature: Table delete + undo + arrow navigation

## Happy paths

- After deleting a table via Ctrl+A×2 + Backspace and then undoing, ArrowDown from the paragraph above the restored table moves the caret into the table.

## Regression notes

- The pre-fix bug: post-undo, the editor's top-level `blockRefs[tableIdx]` stayed `undefined` because the array was a Svelte 5 `$state` proxy and the BlockHost's publish from inside the post-undo reactive flush was reverted by the proxy's mutation guard. `moveFocus(tableIdx)` would silently no-op on the empty slot.
- Fix: `blockRefs` is a plain array (no `$state`); `BlockList` publishes through owner-supplied slot accessors instead of `bind:blockRefs`. Reads are synchronous from `focus.ts` / `block-edit.ts` — no reactive subscriber needs the array.
- Direct click on a cell after delete-undo always worked (DOM focus path), so this regression test specifically exercises the focus-dispatch path that depends on `blockRefs`.
