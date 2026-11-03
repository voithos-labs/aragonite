# Feature: selection handles on a touch screen

On a touch screen a finger's range is always the editor's own: across blocks, a rectangle of table
cells, or a word a long press picked inside one block, which the editor takes over once the press
ends. So the editor draws a handle at each end of every range it paints, and no phone draws its
own. A finger drags them as a mouse drags a selection. Chromium only: the drags are CDP touch
events, and a held touch from CDP never becomes a long press, so the takeover itself is pinned at
the unit layer and on the phones (`requirements/mobile/android.md` and `ios.md`).

## Happy paths

- A range across blocks gets a handle at each end after a tap: the start handle's corner sits on
  the start point, and the browser's own selection holds no range beside the painted one.
  - Miss-analysis: a selection across blocks had no touch route at all; nothing drew handles.
- The end handle dragged into a later block grows the range there, leaving the start where it was
  and no native range behind. The handle follows the finger while it's down, though no native
  selection moves under it.
- The start handle dragged into an earlier block grows the range there; the old end stays put.
- The end handle dragged back into the range's first block keeps the range the editor's, painted
  inside that block with its two handles and no native range under it. While the finger is down a
  caret stays in a focused block, so a phone neither draws its own handles nor drops its keyboard.
- A finger's double tap makes its word the editor's range, as a long press does: the word the
  editor's own word rule picks is painted, with a handle at each end and no native range under it.
- The end handle of a finger's word dragged into the next block grows the range there. For the
  drag's length the handles and the toolbar take no hit test, so the point under the finger names
  the text, not the handle being dragged.
  - Miss-analysis: every desktop handle row started from a range across blocks; none dragged a
    finger's word, owned inside one block, out of it, where the point runs into its own handle.
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

## User interactions

- The toolbar sits above a finger's range, clear of its handles, where a phone puts its own menu.
- The toolbar moves past the end handle when there is no room above, so a finger reaching for a
  handle never lands on a toolbar button, and the bar covers no more of the page than before.
- A finger's toolbar is the range's one menu, so it cuts and pastes as well as copies, and its Cut
  takes the range.
- A mouse's toolbar only copies, since a mouse's range has the keyboard's Cut and Paste and the
  right-click menu.
