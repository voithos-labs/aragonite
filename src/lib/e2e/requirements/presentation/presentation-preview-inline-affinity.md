# Feature: preview-inline caret affinity (byte-honesty at construct boundaries)

The affinity contract, verified as shipped: the caret is a raw offset, a construct
showing its markers has visible source bytes, and typing or deleting lands at that raw
offset. There is no stored-marks ambiguity to resolve: at a boundary two adjacent
constructs share, both show their markers (the edges are inclusive), and insertion is
decided by position rather than by which construct the caret "belongs to". Empty wrapped
constructs do not exist in GFM, so that classic ambiguity has no representation here.

Scenarios distinct from `presentation-preview-inline-editing.md` (which pins mid-construct
typing, marker-text typing, and construct dissolve).

## Happy paths

- Adjacent constructs sharing a raw boundary (`**a***b*`): stepping onto the shared
  offset shows both wrappers; typing there inserts between them at that raw offset,
  splitting neither: byte-honest, with no winner chosen at the boundary.
- Trailing edge just past a closing marker: typing lands after the marker bytes
  (`**beta**` → `**beta**X`).

## Edge cases

- Leading edge at block start: the opening markers are reachable by stepping left from
  inside the construct; typing at raw offset 0 lands before the markers (`**bold**` →
  `X**bold**`), not after them.
- Leave-then-type: leaving a construct hides its markers again; typing right away at that
  boundary lands the byte at the visible caret position (`**bold** tail`, caret in
  "tail" → `**bold** Xtail`), never inside the hidden markers.
- Home at a block-leading construct lands the caret at the first visible position (after
  the hidden opening markers), and stepping left still reaches the opening-marker bytes.

## User interactions

- Real keyboard only (arrow steps, typing, backspace): a click cannot target hidden marker
  bytes, and placing the caret programmatically would bypass the showing and hiding of
  markers the contract rests on.
