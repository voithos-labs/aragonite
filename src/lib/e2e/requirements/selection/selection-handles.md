# Feature: selection handles on a touch screen

Each block is its own editable element, and the browser's touch handles never leave one, so on a
touch screen the editor draws handles where the browser's can't reach: both ends of a range across
blocks (or a rectangle of table cells), and the end of a one-block range that sits at the block's
edge. A finger drags them as a mouse drags a selection. Chromium only: the drags are CDP touch
events. The real-device rows are in `requirements/mobile/android.md` and `ios.md`.

## Happy paths

- A range across blocks gets a handle at each end after a tap: the start handle's corner sits on
  the start point, and the browser's own selection holds no range beside the painted one.
  - Miss-analysis: a selection across blocks had no touch route at all; nothing drew handles.
- The end handle dragged into a later block grows the range there, leaving the start where it was
  and no native range behind.
- The start handle dragged into an earlier block grows the range there; the old end stays put.
- A word at its block's end gets one edge handle (the browser's handles cover the rest), and
  dragging it into the next block makes a range across the two. While the finger is still down
  the word's native range is gone, so a phone draws no handles of its own beside the editor's.
- A handle dragged across table cells grows a rectangle of cells, as a mouse drag does.

## Edge cases

- A range across blocks after a mouse click gets no handles: they are a finger's.
- Reading mode shows no handles.
- An open editor menu hides the handles; they come back with the range when it closes.

## User interactions

- The toolbar sits above a finger's range, clear of its handles, where a phone puts its own menu.
- The toolbar drops below the handles when there is no room above, so a finger reaching for a
  handle never lands on a toolbar button.
