# Feature: a drag that starts on an emoji selects

An emoji renders as a widget the caret cannot enter: `contenteditable=false` with
`user-select: none`. The browser starts no selection from a click on it and answers that point
with a position in the neighbouring text, so a drag beginning on the glyph used to paint nothing
at all, which surprises the user, for whom the glyph is a character in the line like any other.

The editor runs its own drag from such a click, as it does for one starting in the margin, and
paints the range inside the block itself. The drag is anchored at the widget's own raw edge on
the side the click landed (`cursor/widget-edge-snap.ts`), not at the browser's hit test, which
moves with whatever is already selected. Only a kind the caret reads as one character
(`onEdge: 'step-over'`: an emoji, an entity reference) anchors this way; a widget that handles
its own click keeps it, as an image does for its selection and a formula for showing its source.

## Happy paths

- A drag to the right off the glyph selects the text after it, anchored at the raw offset just
  after `:smile:`; a drag to the left off it selects the text before it, from the same anchor.
  - Miss-analysis: every widget test pressed and released in one place, so the press half of a
    click had no test of its own and a gesture that begins on a widget and ends elsewhere was
    never driven.
- The painted range is a real selection: the next printable key replaces it, leaving the emoji
  and the text before it untouched.

## The kinds either side of the rule

- An entity reference (`&amp;`) drags exactly as the emoji does, so the rule comes from the
  kind's own declaration rather than from the emoji component.
- An inline formula drags too: it shows its source on a click, and a drag is not a click.
- An inline image does not: it handles its own click for the resize drag, so the gesture paints
  no range and writes no bytes. Pinned from this side, so widening the declaration fails here.

## Edge cases

- A click on the glyph with no movement paints no range and writes no bytes: it is the click
  that puts a caret beside the widget, which the drawn caret then shows.
- A click inside a range that is already painted starts the drag-to-move gesture rather than a
  new selection, and the widget is no exception to that.

## Error cases

- no `[invariant:…]` console messages across the drags (asserted through `capturedErrors`)
