# Feature: Decoration island editing semantics

A decoration island (a non-editable inline widget) renders in a prose block as
`[data-inline-widget][data-decoration-island]` and carries `data-source-start/end`: a
**widget island** spans zero bytes (a zero-length insertion), a **replace island** carries the
raw bytes of the DOM it stands over. Islands are view-only and never enter the CST, so caret
placement, arrow keys and destructive keys must treat them as single units without ever
corrupting the hidden bytes they stand in for.

The behavior contract:

- Horizontal arrows **step over** any `[data-decoration-island]`: they never select it, never
  show its bytes, and never put the caret inside it.
- **widget island** (0 bytes): Backspace and Delete act on the adjacent _real_ byte as if the
  island were not there; typing at its boundary inserts into `raw` at the island's offset, and
  the island re-renders once the source recomputes.
- **replace island** (hidden bytes): Backspace or Delete against its edge **selects the island
  whole**; a second keypress deletes the entire hidden range through the normal CST edit path,
  as one undo entry. Silently eating one hidden byte would be invisible corruption, and
  selecting the whole range then deleting it is what images already do.
- A cross-block selection sweeping through islands measures and paints normally. One
  deliberate zero-length case: a widget island (0 bytes) is invisible to the rects that cover
  a selection, because `widgetsIntersectingRange` requires `len > 0`. That is correct (0 bytes
  means nothing is selected), and it is recorded so nobody "fixes" it. The unit test
  `widgets-intersecting-range.test.ts` "ignores a zero-length widget" covers the mechanism;
  `textcontent-spine.property.test.ts` covers byte-exactness over arbitrary island placements.
- Clipboard, at the gesture level: copying a range that contains a ghost-text-style widget
  island puts text on the clipboard byte-identical to the raw slice.

## Happy paths

- ArrowRight from before a replace island lands the caret past the whole hidden range (offset ===
  island end); ArrowLeft from after it lands before the range (offset === island start). Source
  unchanged, island never selected.
- Backspace against a replace island's trailing edge selects it whole (island tinted, source
  unchanged); a second Backspace deletes the whole hidden range in one commit.
- Delete against a replace island's leading edge selects it whole; a second Delete deletes the
  whole hidden range in one commit.
- A single Ctrl+Z after the two-keystroke delete restores the bytes in one step, which proves
  there was one undo entry and no stray native commit.
- The same two-keystroke delete on a heading island (whose `data-source-*` include the block's
  own `## ` marker bytes) deletes the right hidden range: the case where the block's own marker
  sits inside the coordinates.
- The same two-keystroke delete on a list-item island (whose `data-source-*` _exclude_ the `- `
  marker the list draws in front of the text, and whose commit addresses a nested child) deletes
  the right hidden range: the case where the container's marker prefix sits outside them.
- No two-keystroke delete raises a dev warning. The fixture's source keeps its fixed offsets,
  which is what pins the marker conventions above, but declines once the block no longer holds
  the bytes, so the session models a well-formed source throughout.

## Edge cases

- Backspace against a widget island whose caret is anchored in the DOM past it deletes the
  adjacent real byte, as if the island were not there, rather than doing nothing but stripping
  the island's DOM.
- A widget island at a true block boundary lets Backspace and Delete fall through to block merge
  (no adjacent real byte to eat).

## User interactions

- Typing a printable key at a widget island's element-level boundary inserts it into `raw` at the
  island's offset (the character Chromium would otherwise drop against a `contenteditable=false`
  neighbor).
- Copy (Ctrl+C) over a range spanning a widget island yields clipboard text byte-identical to the
  raw slice of that range.
