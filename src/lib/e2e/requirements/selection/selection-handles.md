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

- Once a handle's drag ends, the finger lifted or the touch cancelled, the handles and the toolbar
  take a finger again.
  - Miss-analysis: the hit-test row only checked the drag itself; nothing pressed a handle or the
    toolbar after it, so a drag end that left them untouchable stayed green.
- A range across blocks after a mouse click gets no handles: they are a finger's.
- Shift+ArrowRight or Shift+ArrowLeft from a keyboard on a finger's word moves its end one
  character, as on the browser's own range: a keyboard's range inside one block is the browser's,
  so the word goes back to it and the editor stops painting it.
  - Miss-analysis: every keyboard row over a range the editor holds started from one across
    blocks, where Shift+Arrow steps a block at a time; none extended a finger's word.
- A rectangle of cells whose handle is dragged back into the cell at its other corner becomes a
  range in that cell, from the cell's edge on the rectangle's side to the finger, as a mouse drag
  back into its cell does, and it stays the editor's, with no native range under it. Either
  handle: the end handle back into the first cell, the start handle back into the last.
  - Miss-analysis: the cell row only grew a rectangle; no row shrank one, and a rectangle's corner
    handed the drag no cell to select in.
- Reading mode shows no handles.

## User interactions

- The toolbar sits above a finger's range, clear of its handles, where a phone puts its own menu.
- The toolbar moves past the end handle when there is no room above, so a finger reaching for a
  handle never lands on a toolbar button, and the bar covers no more of the page than before.
- A finger's toolbar is the range's one menu, so it cuts and pastes as well as copies. Its Cut
  takes the range, and one undo puts it back.
- A finger's toolbar Copy or Cut lands through the browser's own command even where the page
  may not call the clipboard API (a frame without the permission): the clipboard holds the word,
  a Cut takes it, and no API write is tried.
  - Miss-analysis: every menu Copy and Cut row ran with the clipboard granted, so none saw the API
    write refused where the command's own event would have copied.
- A finger's toolbar Copy puts its word on the clipboard, and its Paste on another finger's word
  puts that text in the word's place.
  - Miss-analysis: the toolbar rows only checked that Paste shows; none tapped it, so a Paste that
    left a finger's word as it was stayed green.
- A finger's word gets the toolbar's link button and heading picker, as a mouse's word does: a
  link and a heading level need a range inside one block, and a finger's word is one.
  - Miss-analysis: the rename audit read every `ownsRange` read as ownership; the command route's
    decline meant "spans blocks", and no row opened a command on a finger's word.
- The toolbar's link, or Mod+K from a keyboard, on a finger's word in live mode opens the create
  card, and its commit makes a link of exactly that word.
- The toolbar's heading picker on a finger's word turns its block into a heading. A finger's tap
  inside the picker keeps it open until the tap's click lands.
- Mod+1 from a keyboard on a finger's word turns its block into a heading and keeps the word, as
  inside one block anywhere; over a range across blocks it's delete, then the key.
- The first Mod+A from a keyboard on a finger's word selects its block's text, as from the
  browser's own range there.
- A mouse's Shift+click in a finger's word's block grows the word to the click, as on the
  browser's own range there.
- A finger's word inside a bold run, copied with the toolbar in live mode, goes on the clipboard
  with its run closed at both edges, so a paste gives back bold.
  - Miss-analysis: a copy inside one block only ever held a block whole until a finger's word
    reached that branch, and it sliced the raw bytes, dropping the run's markers.
- A finger's word cut in live mode takes the same bytes as a mouse's word cut there, and leaves
  the block the same.
- A mouse's toolbar only copies, since a mouse's range has the keyboard's Cut and Paste and the
  right-click menu.
- With `selectionToolbar` off, a finger's word still gets a bar with Cut, Copy and Paste alone,
  since the editor replaced the phone's own menu; a mouse's word gets no bar.
  - Miss-analysis: every toolbar row ran with the prop on, so turning it off left a finger's word
    with no clipboard at all and nothing went red.
