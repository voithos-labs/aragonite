# Feature: Undo / Redo

Undo and redo for structural and text operations.

## Happy paths

Undo reverting a split, undo reverting a burst of typed text, and undo on an empty stack changing nothing are walked by `undo-typing-structural.spec.ts`: type, split, type, then undo four times, the last on an empty stack. Redo restoring a split is the redo row in `text-editing/break-over-selection.spec.ts`.

## Edge cases

- undo reverts a merge: Backspace merge then undo restores both original blocks
- undo across a prose to non-prose kind change restores the rendered DOM, not just the CST: typing to turn a paragraph into an `htmlBlock` (DOM already carries the character) then undo must repaint the block to the CST; the next keystroke must not commit the undone byte back

## Undo brings an off-screen caret into view

An undo puts the caret back where it was, and if that's off screen the editor scrolls it in, just far enough: the block lands at the nearest edge, not in the middle, and a caret already on screen doesn't move the page.

- type at block 5 of a long document, wheel down until block 5 leaves the window entirely, Ctrl+Z: block 5 is on screen with its top at the viewport's top edge (within 2px). Miss-analysis: a pin; mounting a windowed-out block already scrolled it to the top, but no test checked where an undo leaves its caret
- the same with block 5 only just above the viewport, still mounted: its top lands at the viewport's top edge (within 2px). Miss-analysis: every undo test ran in a document that fit on screen, so none saw that an undo only followed its caret because the focus call scrolled on its own
- type at the end of a paragraph taller than the viewport, scroll so its top sits 100px into the view, Ctrl+Z: the caret's line is on screen. Miss-analysis: every undo row used a short block, where showing the block shows the caret, so a caret deep in a tall block whose top was already on screen stayed below the edge
- a gap caret between a table and a fence, a paragraph typed there, the page wheeled away until the table leaves the window, Ctrl+Z: the gap caret is back and on screen. Miss-analysis: a pin; the gap's undo ran beside the caret landing rather than through it, so no scroll rule reached it and nothing checked it came back into view. Miss-analysis: the restore then showed the block below the gap rather than the gap, which left it a few pixels over the top edge, and only Firefox ran the row without the browser's own focus scroll covering for it

## An undo step changes the document

A gesture that leaves the bytes as they were is no undo step, and nothing writes while an undo or redo puts its entry back.

- in `ab` with the caret after `a`: Enter, type `a`, Backspace, Ctrl+Z: one press gets back to `ab`, and `canRunCommand('history.undo')` then answers false. Miss-analysis: every undo row checked a gesture that changed the bytes, so a typing run that deleted what it typed still read as a step
- a freshly loaded document answers false to `canRunCommand` for undo and redo; after typing, undo answers true; after undoing it, undo answers false and redo true. Miss-analysis: `canRunCommand` was only ever asked of block commands, and the history commands registered no check of their own
- an empty `#` heading above a paragraph `b`: type `c` after `b`, then `x` after `#`, Ctrl+Z twice: the empty heading is back, still a heading, with the caret in the paragraph; Ctrl+Shift+Z twice gets back to `#x` above `bc`. Miss-analysis: no undo row moved the caret off an empty heading, which turns itself into a paragraph on blur, so that write landed inside the undo and cleared the redo stack unseen

## Cross-block (covered in selection/undo.md)

- Undo after cross-block cut restores document and cross-block selection
- Undo after type-replace restores selection and removes typed chars in one step

## User interactions

- undo via Ctrl+Z keyboard shortcut: verify it uses real keyboard, not programmatic
- redo via Ctrl+Shift+Z keyboard shortcut: same
