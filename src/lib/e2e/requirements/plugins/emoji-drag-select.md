# Feature: a drag that starts on an emoji selects

An emoji renders as an atomic island: `contenteditable=false` with `user-select: none`. The
browser starts no selection from such a press and answers its point with a position in the
neighbouring text, so a drag beginning on the glyph used to paint nothing at all — unexpected,
since to a reader the glyph is a character in the line like any other.

The editor's own drag session runs from such a press, as it does for one from the margin, and
paints the range inside the block itself. The anchor is the island's own raw edge on the press's
side (`cursor/widget-edge-snap.ts`), not the engine's hit test, which drifts with whatever is
already selected. Only a kind the caret reads as ONE character (`onEdge: 'step-over'` — emoji, an
entity reference) anchors this way; an island that owns its press keeps it (an image's select, a
formula's reveal).

## Happy paths

- A drag right off the glyph selects the text after it, anchored at the raw offset following
  `:smile:`; a drag left off it selects the text before it, from the same anchor.
  - Miss-analysis: every island test pressed and released in one place, so the press half of a
    click had no test of its own and a gesture that begins on an island and ends elsewhere was
    never driven.
- The painted range is a real selection: the next printable key type-replaces it, leaving the
  emoji and the text before it untouched.

## The kinds either side of the rule

- An entity reference (`&amp;`) drags exactly as the emoji does: the rule is the kind's own
  declaration, not the emoji component.
- An inline formula drags too — it shows its source on a click, and a drag is not that click.
- An inline image does not: it owns its press for the resize drag, so the gesture paints no
  range and writes no bytes. Pinned from this side so a widening of the declaration reds here.

## Edge cases

- A press on the glyph with no movement paints no range and writes no bytes: it is the click
  that seats a caret beside the island, which the synthetic caret then shows.
- A press inside a range that is already painted is the drag-to-move gesture, not a new
  selection — the island is no exception to that.

## Error cases

- zero `[invariant:…]` console fires across the drags (asserted through `capturedErrors`)
