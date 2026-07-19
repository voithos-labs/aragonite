# Feature: preview-inline caret affinity (byte-honesty at construct boundaries)

The affinity contract, verified as shipped: the caret is a raw offset; a revealed
construct's source bytes are visible; typing/deleting lands at that raw offset. There
is no stored-marks ambiguity to resolve — at a boundary shared by adjacent constructs
BOTH reveal (inclusive edges), and insertion is decided by position, not by which
construct the caret "belongs to". Empty wrapped constructs do not exist in GFM, so that
classic ambiguity has no representation here.

Scenarios distinct from `presentation-preview-inline-editing.md` (which pins mid-construct
typing, marker-text typing, and construct dissolve).

## Happy paths

- Adjacent constructs sharing a raw boundary (`**a***b*`): stepping onto the shared
  offset reveals both wrappers; typing there inserts between them at that raw offset,
  splitting neither — byte-honest, no boundary winner chosen.
- Trailing edge just past a closing marker: typing lands after the marker bytes
  (`**beta**` → `**beta**X`).

## Edge cases

- Leading edge at block start: the opening markers are reachable by a leftward walk from
  inside the construct; typing at raw offset 0 lands before the markers (`**bold**` →
  `X**bold**`), not after them.
- Fold-then-type: leaving a construct folds its markers; typing immediately at the folded
  boundary lands the byte at the visible caret position (`**bold** tail`, caret in
  "tail" → `**bold** Xtail`), never inside the hidden markers.
- Home at a block-leading construct lands the caret at the first VISIBLE position (after
  the folded opening markers), and a leftward walk still reaches the opening-marker bytes.

## User interactions

- Real keyboard only (arrow walk, type, backspace): a click cannot target hidden marker
  bytes, and programmatic caret placement would bypass the reveal/fold the contract rests on.
