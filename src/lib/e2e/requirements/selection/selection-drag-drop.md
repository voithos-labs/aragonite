# Feature: dragging a selection and dropping it

Press on selected text, drag it somewhere else, release: the text moves. The browser would do
this itself as two unrelated native edits — a `deleteByDrag` on the source and an
`insertFromDrop` on the target — each committed on its own, which is two undo steps with a
byte-losing document in between, and inside one block the source commit rebuilds the surface
under the drop so the text lands at offset 0 instead of where it was dropped. The editor owns
the gesture instead (`selection/selection-drop.ts`): one commit, one undo entry, the payload
taken from the source block's own bytes so live-mode markers travel with it.

The gesture is the same whichever way the selection was made — the click ladder or Shift+Arrow —
because the drag is the browser's and reads only the native range.

## Happy paths

- drag a double-clicked word to the end of its own paragraph: the word lands there and is gone
  from where it was
  - Miss-analysis: no spec ever pressed on an existing selection and dragged it, so both native
    drag mutations and the pair of undo entries they push were outside the suite entirely
- drag a double-clicked word onto the first glyph of another paragraph: the word lands at that
  paragraph's start and leaves the source
- drag the block rung's whole content into another paragraph: the content lands in the target
  and the source block stays as an empty one
- drag a Shift+Arrow selection: it moves exactly as a ladder-made one does
- drag a word out of a code body into a paragraph: the code body loses exactly that word

## Edge cases

- drop a selection inside itself: the document is untouched
- undo after a drop: one press restores the whole document byte for byte, and redo re-lands it
- after every step the live tree still serializes to what it parses back from, and each
  touched block's rendered text still equals its raw, so no native edit leaked past the seam

## Error cases

- a drag that leaves the editor: nothing dropped here, so the source is the browser's own
  business and this seam stands down
- dragging something with a drag of its own (a rendered link, an image) while a range is selected
  elsewhere: the range is not what is being dragged, so this seam stands down
- a payload carrying a line break, a source inside a table cell, or a drop point that names no
  character position: the browser keeps the gesture, unchanged from before this seam existed
