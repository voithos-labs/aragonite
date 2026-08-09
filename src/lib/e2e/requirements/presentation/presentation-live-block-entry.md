# Feature: live-mode block ENTRY seats a landable caret

The mirror of `presentation-live-block-exit.md`: having left one block, the caret
has to land somewhere in the next one. The landing door seats `CURSOR_END` (the
block's raw length) or raw 0, and in live mode both can sit past the block's
landable extremes — after a trailing construct's hidden closer, or before a
leading construct's hidden opener. Nothing on screen distinguishes those offsets
from the content edge, but the typing seat reads them as INSIDE the construct, so
the first byte after the arrival extends a construct the arrival was outside of.
The contract: an arrival seats where the arrow walk could have stopped, and the
byte typed there obeys the same § 5 arrival rules as every other caret. Driven on
`/test/editor` via `?presentationMode=live`; offsets come from the `window.__test`
selection bridge and the bytes from the source bridge.

## Happy paths

- `ArrowLeft` at the start of a block, entering the previous one which ENDS in a
  link: the caret lands on the link's content end, and a typed byte lands after
  the whole link — links never extend at either edge
- the same arrival into a block ending in `**bold**` lands on the bold content
  end, and a typed byte lands after the closing delimiter (arrow arrival from
  outside)
- `ArrowRight` at the end of a block, entering the next one which BEGINS with
  `**bold**`: the caret should land at the construct's content start and a typed
  byte BEFORE the construct — pinned KNOWN-FAIL. It seats at raw 0 today and the
  byte lands inside the pair. The END sentinel's clamp cannot reach it: a
  `'start'` arrival and a live split's continuation both spell the seat
  `focus(0)`, and `presentation-live-split.md` pins that the split's caret stays
  at raw 0 and keeps typing inside, so telling them apart needs a start sentinel
  carried through `FocusPosition` rather than a door-level clamp

## Edge cases

- the vertical arrival (`ArrowUp` / `ArrowDown`, which lands by pixel column
  rather than by sentinel) already stops on a landable offset; it is pinned here
  so the two arrivals cannot drift apart
- source mode is unchanged: every marker is painted, so the raw extremes ARE
  landable and the same arrivals seat on them

## User interactions

- every arrival is a real arrow press from a real click, and the byte is a real
  keystroke; a programmatic seat would skip the landing door under test
- the caret offset is read from the selection bridge, never inferred from the
  bytes: the two failure shapes (seated past the run, seated in content) write
  different bytes but paint the same pixel

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
