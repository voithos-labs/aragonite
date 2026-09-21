# Feature: in-body tags as mark decorations

The other way to render `#tag`, against the same document the widget battery drives (`tags.md`):
a mark decoration painted over ordinary text, rather than an atomic inline widget.

A tag's source IS its display — `#name` renders as `#name` — so a widget's `revealSource` has
nothing to uncover, and the island it mints is what costs the caret. Under this model the bytes
stay plain text: the caret walks into a tag, Backspace takes one character, typing extends it,
selection and copy are the browser's own, and a typeahead anchors to text rather than to an
island being rebuilt under it. The decoration engine re-runs the source on every document change,
so the chip follows the bytes with no invalidation of its own.

What the model cannot do: a mark paints an overlay ABOVE the text, so it can tint a pill behind a
tag but cannot restyle the glyphs themselves. Activation (a Ctrl/Cmd-click that opens the tag) is
the host's, since the overlay is not hit-testable while it stays non-interactive.

## Happy paths

- Every tag in the seed paints a chip, and the document holds NO `[data-inline-widget]` island.
- A click inside a tag lands the caret among its bytes, which an island would have refused.
- One Backspace takes one character; the chip follows the shortened bytes, with no reveal.
- Typing inside a tag extends it and the chip follows; nothing remounts.
- A tag typed live paints as soon as its name lands.
- An edit earlier in the line moves the chip along with the text it covers.

## Selection

- A selection grown with Shift+ArrowRight takes one character per press through a tag: the tag is
  text, so nothing steps over it whole.

## The heading opener contests the same character

- A tag opening a line stays a paragraph, painted at paragraph size, exactly as under the widget
  model.

## Error cases

- zero `[invariant:…]` console fires across the battery (asserted through `capturedErrors`)
