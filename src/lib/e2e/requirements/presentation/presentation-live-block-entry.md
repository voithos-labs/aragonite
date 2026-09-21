# Feature: live-mode block entry puts the caret at an offset it can reach

The mirror of `presentation-live-block-exit.md`: having left one block, the caret
has to land somewhere in the next one. The one entry point for landing asks for
`CURSOR_END` (the block's raw length) or raw 0, and in live mode both can sit past
the offsets the caret can actually reach: after a trailing construct's hidden
closer, or before a leading construct's hidden opener. Nothing on screen tells
those offsets apart from the content edge, but the rule for where typed bytes go
reads them as inside the construct, so the first byte after the arrival extends a
construct the arrival was outside of. The contract: an arrival puts the caret
where stepping with an arrow could have stopped, and the byte typed there obeys
the same § 5 arrival rules as every other caret. Driven on `/test/editor` via
`?presentationMode=live`; offsets come from the `window.__test` selection bridge
and the bytes from the source bridge.

## Happy paths

- `ArrowLeft` at the start of a block, entering the previous one which ends in a
  link: the caret lands on the link's content end, and a typed byte lands after
  the whole link, since links never extend at either edge
- the same arrival into a block ending in `**bold**` lands on the bold content
  end, and a typed byte lands after the closing delimiter (arrow arrival from
  outside)
- `ArrowRight` at the end of a block, entering the next one which begins with
  `**bold**`: the caret lands at the construct's content start, and a typed byte
  lands before the construct. Every offset is clamped where the caret is put;
  only a live split's continuation keeps byte 0, through its own sentinel value
  (`presentation-live-split.md`)
- `Home` in a list item whose content opens with a construct: the `Home` handler
  for a container's marker prefix goes through that same sentinel entry point, so
  the caret lands at the construct's content start and a typed byte stays outside
  the construct. Miss-analysis (GH #110): that handler wrote raw 0 straight into
  the DOM, bypassing the sentinel entry point, and no spec typed after a `Home`
  in a block with a marker prefix

- stepping with an arrow is not the only path that says "the block's start": a
  landing after a structural change (`Alt+ArrowUp` reorder, and its siblings, an
  interior delete, a descent into a container body, an unwrap, a promotion) puts
  the caret on a block it did not create, so it takes the same sentinel. On a
  heading whose `## ` is hidden, a literal 0 puts the next byte in front of the
  marker run and dissolves the construct into a paragraph

## Edge cases

- the vertical arrival (`ArrowUp` / `ArrowDown`, which lands by pixel column
  rather than by sentinel) already stops on an offset the caret can reach; it is
  pinned here so the two arrivals cannot drift apart
- source mode is unchanged: every marker is painted, so the raw extremes can be
  reached and the same arrivals land on them

## User interactions

- every arrival is a real arrow keypress from a real click, and the byte is a
  real keystroke; placing the caret programmatically would skip the landing path
  under test
- the caret offset is read from the selection bridge, never inferred from the
  bytes: the two failure shapes, the caret past the run and the caret in the
  content, write different bytes but paint the same pixel

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
