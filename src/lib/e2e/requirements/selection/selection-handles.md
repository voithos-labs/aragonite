# Feature: selection handles on a touch screen

Each block is its own editable element, and the browser's touch handles never leave one, so on a
touch screen the editor draws handles where the browser's can't reach: both ends of a range across
blocks (or a rectangle of table cells), and an end of a one-block range that sits at the block's
edge. A finger drags them as a mouse drags a selection. Chromium only: the drags are CDP touch
events. The real-device rows are in `requirements/mobile/android.md` and `ios.md`.

## Happy paths

- A range across blocks gets a handle at each end after a tap: the start handle's corner sits on
  the start point, and the browser's own selection holds no range beside the painted one.
  - Miss-analysis: a selection across blocks had no touch route at all; nothing drew handles.
- The end handle dragged into a later block grows the range there, leaving the start where it was
  and no native range behind. The handle follows the finger while it's down, though no native
  selection moves under it.
- The start handle dragged into an earlier block grows the range there; the old end stays put.
- A word at its block's end gets one edge handle (the browser's handles cover the rest), and
  dragging it into the next block makes a range across the two. While the finger is still down
  the word's native range is gone, so a phone draws no handles of its own beside the editor's.
- A handle dragged across table cells grows a rectangle of cells, as a mouse drag does.

## Edge cases

- A range across blocks after a mouse click gets no handles: they are a finger's.
- A rectangle of cells whose handle is dragged back into the cell at its other corner becomes a
  range in that cell, from the cell's edge on the rectangle's side to the finger, as a mouse drag
  back into its cell does. Either handle: the end handle back into the first cell, the start
  handle back into the last.
  - Miss-analysis: the cell row only grew a rectangle; no row shrank one, and a rectangle's corner
    handed the drag no cell to select in.
- Reading mode shows no handles.
- An open editor menu keeps the handles, drawn above it, and a press on one closes the menu as
  any press outside it does, then drags.

## User interactions

- The toolbar sits above a finger's range, clear of its handles, where a phone puts its own menu.
- The toolbar moves past the end handle when there is no room above, so a finger reaching for a
  handle never lands on a toolbar button, and the bar covers no more of the page than before.
