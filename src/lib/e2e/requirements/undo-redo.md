# Feature: Undo / Redo

Undo and redo for structural and text operations.

## Happy paths

- undo reverts a split: Enter then Ctrl+Z restores single block
- redo restores a split: undo then Ctrl+Shift+Z re-applies the split
- undo reverts typed text: type text, wait for debounce (~600ms), undo removes the typed text

## Edge cases

- undo reverts a merge: Backspace merge then undo restores both original blocks
- undo across a prose to non-prose kind change restores the rendered DOM, not just the CST: typing to turn a paragraph into an `htmlBlock` (DOM already carries the character) then undo must repaint the block to the CST; the next keystroke must not commit the undone byte back
- undo on empty stack: Ctrl+Z when nothing to undo does not crash or corrupt state

## Undo brings an off-screen caret into view

An undo puts the caret back where it was, and if that's off screen the editor scrolls it in, just far enough: the block lands at the nearest edge, not in the middle, and a caret already on screen doesn't move the page.

- type at block 5 of a long document, wheel down until block 5 leaves the window entirely, Ctrl+Z: block 5 is on screen with its top at the viewport's top edge (within 2px). Miss-analysis: a pin; mounting a windowed-out block already scrolled it to the top, but no test checked where an undo leaves its caret
- the same with block 5 only just above the viewport, still mounted: its top lands at the viewport's top edge (within 2px). Miss-analysis: every undo test ran in a document that fit on screen, so none saw that an undo only followed its caret because the focus call scrolled on its own
- a gap caret between a table and a fence, a paragraph typed there, the page wheeled away until the table leaves the window, Ctrl+Z: the gap caret is back and on screen. Miss-analysis: a pin; the gap's undo ran beside the caret landing rather than through it, so no scroll rule reached it and nothing checked it came back into view

## Cross-block (covered in selection/undo.md)

- Undo after cross-block cut restores document and cross-block selection
- Undo after type-replace restores selection and removes typed chars in one step

## User interactions

- undo via Ctrl+Z keyboard shortcut: verify it uses real keyboard, not programmatic
- redo via Ctrl+Shift+Z keyboard shortcut: same
