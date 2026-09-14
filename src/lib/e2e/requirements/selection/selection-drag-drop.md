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

**A shape the seam does not move is cancelled, never half-applied.** The seam claims every drag
that grips its own selection, including the ones it declines, so the browser's pair of native
edits never runs: a declined drag writes nothing and leaves the undo stack alone.

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
- after a drop the live tree still serializes to what it parses back from, and each touched
  block's rendered text still equals its raw, so no native edit leaked past the seam

## Error cases

Both of these are the cancel rule, read through the two shapes that reach it. Each asserts the
document byte-identical AND that a following undo changes nothing, since a fresh document has
nothing to undo: an entry on the stack would show up as a document that moved.

- drag a word out of a table cell: cancelled. A cell addresses its offsets by cell index, so the
  seam cannot move its bytes — and letting the browser have the gesture loses them
  - Miss-analysis: the first version of this seam returned "not my gesture" for a cell source,
    which reads the same as "no drag here" and handed the shape back to the browser; no spec
    dragged out of a cell, so the two native edits landed and one undo left the cell's word gone
- triple-click a paragraph holding a soft line break and drag it: cancelled. A payload carrying a
  line break needs the structural paste route, which this seam does not take
