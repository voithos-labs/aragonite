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
  `**bold**`: the caret lands at the construct's content start, and a typed byte
  lands BEFORE the construct. This is why the door takes a START sentinel rather
  than a literal 0 — a live split's continuation seats at 0 too and must STAY
  there (`presentation-live-split.md`), so only an arrival's sentinel moves in

- an arrow walk is not the only door that says "the block's start": a STRUCTURAL
  landing (`Alt+ArrowUp` reorder, and its siblings — an interior delete, a
  descent into a container body, an unwrap, a promotion) seats the caret on a
  block it did not create, so it takes the same sentinel. On a heading whose
  `## ` is hidden, a literal 0 puts the next byte in front of the marker run and
  dissolves the construct into a paragraph

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
