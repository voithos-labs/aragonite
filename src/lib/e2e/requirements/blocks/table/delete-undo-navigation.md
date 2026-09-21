# Feature: Table delete + undo + arrow navigation

## Happy paths

- After deleting a table via Ctrl+A×2 + Backspace and then undoing, ArrowDown from the paragraph above the restored table moves the caret into the table.

## Regression notes

- The bug: after an undo, the editor's top-level `blockRefs[tableIdx]` stayed `undefined`, because the array was a Svelte 5 `$state` proxy and the write BlockHost made from inside the reactive flush after the undo was reverted by the proxy's mutation guard. `moveFocus(tableIdx)` then quietly did nothing on the empty position.
- The fix: `blockRefs` is a plain array (no `$state`), and `BlockList` writes through accessors the owner supplies instead of `bind:blockRefs`. Reads are synchronous from `focus.ts` and `block-edit.ts`, and no reactive subscriber needs the array.
- A direct click on a cell after delete-undo always worked (it goes through DOM focus), so this regression test drives the focus-dispatch path that depends on `blockRefs`.
