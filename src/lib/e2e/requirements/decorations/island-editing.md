# Feature: Decoration island editing semantics

A decoration island renders in a prose block as an atomic inline widget
(`[data-inline-widget][data-decoration-island]`) carrying `data-source-start/end`: a
**widget island** spans zero bytes (a zero-length insertion), a **replace island** carries the
raw bytes of the DOM it displaced. Islands are view-only — never in the CST — so caret, arrow,
and destructive-key dispatch must treat them as atomic without ever corrupting the hidden bytes
they stand in for.

The behavior contract below is pinned verbatim from the Task 8 brief (with the reviewer-agreed
refinement that arrows step over while destructive keys select-then-delete for replace islands):

- Horizontal arrows **step over** any `[data-decoration-island]` — never select, never reveal,
  never park inside.
- **widget island** (0 bytes): Backspace/Delete act on the adjacent _real_ byte as if the island
  weren't there; typing at its boundary inserts into `raw` at the island's offset (island
  re-renders after the source recomputes).
- **replace island** (hidden bytes): Backspace/Delete against its edge **select the island
  whole**; a second press deletes the entire hidden range through the normal CST edit path (one
  undo entry). Rationale: silently eating one hidden byte is invisible corruption; whole-range
  select-then-delete is the image precedent.
- Cross-block selection sweeping through islands measures/paints normally. Deliberate zero-length
  case: a widget island (0 bytes) is invisible to selection cover-rects
  (`widgetsIntersectingRange` guards `len > 0`) — correct behavior (0 bytes ⇒ nothing selected),
  recorded so nobody "fixes" it. The mechanism guard is the unit
  `widgets-intersecting-range.test.ts` "ignores a zero-length widget"; the byte-exact spine over
  arbitrary island placements is `textcontent-spine.property.test.ts`.
- Clipboard, gesture-level: a copy over a range containing a ghost-text-style widget island
  yields clipboard text byte-identical to the raw slice.

## Happy paths

- ArrowRight from before a replace island lands the caret past the whole hidden range (offset ===
  island end); ArrowLeft from after it lands before the range (offset === island start). Source
  unchanged, island never selected.
- Backspace against a replace island's trailing edge selects it whole (island tinted, source
  unchanged); a second Backspace deletes the whole hidden range in one commit.
- Delete against a replace island's leading edge selects it whole; a second Delete deletes the
  whole hidden range in one commit.
- A single Ctrl+Z after the two-press delete restores the pre-delete bytes in one step (proves
  one undo entry — no stray native commit).
- The same two-press delete on a heading island (whose `data-source-*` include the block-own
  `## ` marker bytes) deletes the right hidden range — the marker-coordinate seam.
- The same two-press delete on a list-item island (whose `data-source-*` _exclude_ the ambient
  `- ` marker, and whose commit addresses a nested child) deletes the right hidden range — the
  ambient-coordinate seam.
- No two-press delete raises a dev warning. The fixture's source keeps its fixed offsets (that
  is what pins the marker conventions above) but declines once the block no longer holds the
  bytes, so the session models a well-formed source throughout.

## Edge cases

- Backspace against a widget island whose caret DOM-anchors past it deletes the adjacent real
  byte (as if the island weren't there), not a no-op that only strips the island DOM.
- A widget island at a true block boundary lets Backspace/Delete fall through to block merge (no
  adjacent real byte to eat).

## User interactions

- Typing a printable key at a widget island's element-level boundary inserts it into `raw` at the
  island's offset (the character Chromium would otherwise drop against a `contenteditable=false`
  neighbour).
- Copy (Ctrl+C) over a range spanning a widget island yields clipboard text byte-identical to the
  raw slice of that range.
