# Feature: dragging a selection and dropping it

Press on selected text, drag it somewhere else, release: the text moves. The browser would do
this itself as two unrelated native edits, a `deleteByDrag` on the source and an
`insertFromDrop` on the target, each committed on its own. That is two undo steps with a
document that has lost bytes in between, and inside one block the source commit rebuilds the
editable element under the drop so the text lands at offset 0 instead of where it was dropped.
The editor owns the gesture instead (`selection/selection-drop.ts`): one commit, one undo entry,
and the moved text taken from the source block's own bytes so live-mode markers travel with it.

The gesture is the same whichever way the selection was made, by multi-click or by Shift+Arrow,
because the drag is the browser's and reads only the native range.

**A case the handler does not move is cancelled, never half-applied.** The handler takes every
drag that starts on its own selection, including the ones it declines, so the browser's pair of
native edits never runs: a declined drag writes nothing and leaves the undo stack alone.

There are therefore two different noes, and confusing them is the whole bug class: "not this
gesture" hands the drag back to the browser, while a case the handler recognizes but cannot move
is cancelled. Answering the first where the second is meant gives the browser its two native
edits, and one undo then leaves the source's bytes gone.

## Happy paths

- drag a double-clicked word to the end of its own paragraph: the word lands there and is gone
  from where it was
  - Miss-analysis: no spec ever pressed on an existing selection and dragged it, so both native
    drag mutations and the pair of undo entries they push were outside the suite entirely
- drag a double-clicked word onto the first glyph of another paragraph: the word lands at that
  paragraph's start and leaves the source
- drag a whole block's content, taken by triple-click, into another paragraph: the content lands
  in the target and the source block stays as an empty one
- drag a Shift+Arrow selection: it moves exactly as a multi-clicked one does
- drag a word out of a code body into a paragraph: the code body loses exactly that word
- drag a word out of a table cell into a paragraph: the word lands there, the cell keeps the rest,
  and one undo restores both sides
  - Miss-analysis: the only cell drag in the suite asserted the cancel, so no test ever asked a
    cell's bytes to land anywhere else and the handler's own decline read as coverage
- drag a double-clicked word into another paragraph with Ctrl or Alt held through the release: a
  copy lands there, the source keeps the word, one undo restores the document, and redo re-lands it
  - Miss-analysis: every drag case released with no key held, so the copy branch had no case and
    could break with every suite green

## Edge cases

- drop a selection inside itself: the document is untouched
- undo after a drop: one press restores the whole document byte for byte, and redo re-lands it
- after a drop the live tree still serializes to what it parses back from, and each touched
  block's rendered text still equals its raw, so no native edit leaked past the handler

## Error cases

Every case the handler declines takes the same exit: the document is byte-identical and a
following undo changes nothing, since a fresh document has nothing to undo and an entry on the
stack would show up as a document that moved. The six declines the code carries, each named:

- **text carrying a line break**: cancelled, covered (triple-click a paragraph holding a soft
  break and drag it). Moving it needs the structural paste route, which this handler does not
  take, so the spec asserts the source paragraph still holds both its lines, not just that the
  bytes match
- **a drop on a block that holds no character position**: cancelled, covered twice: a drop onto a
  thematic break, and a drop onto a table cell, whose offsets are cell indices rather than
  character positions. There is no offset to insert at
- **a range that leaves its block**: cancelled, not drivable under Playwright: a cross-block
  selection paints through the overlay and leaves a collapsed native caret, so the browser starts
  no drag from it at all
- **an editable element the DOM resolves no path for**: cancelled, not drivable: every mounted
  editable area sits under a block host, so neither a cell path nor a block path answering means
  the range is in DOM the editor does not own
- **an empty range once the container's marker prefix is clamped away**: cancelled, not drivable:
  a drag needs a non-collapsed native selection to start, and one covering only a marker is not
  reachable by gesture
- **reading mode**: cancelled, not drivable: reading mode mounts no editable area, so there is no
  selection to drag

One case is not a decline and stays the browser's: a drag whose grabbed node lies outside the
painted range (a rendered link, an image). Implemented, but not covered, because Chromium starts
no such drag under Playwright's synthetic mouse.
