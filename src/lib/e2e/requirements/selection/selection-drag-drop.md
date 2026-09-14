# Feature: dragging a selection and dropping it

Press on selected text, drag it somewhere else, release: the text moves. The browser would do
this itself as two unrelated native edits — a `deleteByDrag` on the source and an
`insertFromDrop` on the target — each committed on its own, which is two undo steps with a
byte-losing document in between, and inside one block the source commit rebuilds the surface
under the drop so the text lands at offset 0 instead of where it was dropped. The editor owns
the gesture instead (`selection/selection-drop.ts`): one commit, one undo entry, the payload
taken from the source surface's own bytes so live-mode markers travel with it.

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
- drag a word out of a table cell into a paragraph: the word lands there, the cell keeps the rest,
  and one undo restores both sides
  - Miss-analysis: the only cell drag in the suite asserted the cancel, so no test ever asked a
    cell's bytes to land anywhere else and the seam's own decline read as coverage

## Edge cases

- drop a selection inside itself: the document is untouched
- undo after a drop: one press restores the whole document byte for byte, and redo re-lands it
- after a drop the live tree still serializes to what it parses back from, and each touched
  block's rendered text still equals its raw, so no native edit leaked past the seam

## Error cases

Every shape the seam declines takes the same exit: the document is byte-identical AND a following
undo changes nothing, since a fresh document has nothing to undo — an entry on the stack would show
up as a document that moved. The five declines the code carries, each named:

- **a payload carrying a line break** — cancelled, covered (triple-click a paragraph holding a soft
  break and drag it). Moving it needs the structural paste route, which this seam does not take, so
  the spec asserts the source paragraph still holds BOTH its lines, not just that the bytes match
- **a drop on a block that holds no character position** — cancelled, covered twice: a drop onto a
  thematic break, and a drop onto a table cell, whose offsets are cell indices rather than
  character positions. There is no offset to insert at
- **a range that leaves its surface** — cancelled, not drivable under Playwright: a cross-block
  selection paints through the overlay and parks a collapsed native caret, so the browser starts no
  drag from it at all
- **an empty range after the ambient clamp** — cancelled, not drivable: a drag needs a non-collapsed
  native selection to start, and one covering only a marker island is not reachable by gesture
- **reading mode** — cancelled, not drivable: reading mode mounts no editable surface, so there is
  no selection to drag

One shape is NOT a decline and stays the browser's: a drag whose gripped node lies outside the
painted range (a rendered link, an image). Implemented, but not covered — Chromium starts no such
drag under Playwright's synthetic mouse.
