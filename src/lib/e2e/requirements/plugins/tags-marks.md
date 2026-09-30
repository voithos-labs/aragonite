# Feature: in-body tags as mark decorations

The other way to render `#tag`, against the same document the widget battery drives (`tags.md`):
a mark decoration painted over ordinary text rather than an inline widget the caret cannot enter.

A tag's source is its display, since `#name` renders as `#name`, so a widget's `revealSource` has
nothing to uncover and the widget it creates is what costs the caret. Under this model the bytes
stay plain text: the caret walks into a tag, Backspace takes one character, typing extends it,
selection and copy are the browser's own, and a typeahead anchors to text rather than to a widget
being rebuilt underneath it. The decoration system runs the source again on every document
change, so the chip follows the bytes with nothing of its own to invalidate.

What the model cannot do: a mark paints an overlay above the text, so it can tint a pill behind a
tag but cannot restyle the glyphs themselves. Activation, a Ctrl/Cmd-click that opens the tag, is
the host's job, since the overlay takes no hits while it stays non-interactive.

## Happy paths

- Every tag in the seed paints a chip, and the document holds no `[data-inline-widget]` at all.
- A click inside a tag puts the caret among its bytes, which a widget would have refused.
- One Backspace takes one character, and the chip follows the shortened bytes with no source
  shown.
- Typing inside a tag extends it and the chip follows; nothing remounts.
- A tag typed live paints as soon as its name lands.
- An edit earlier in the line moves the chip along with the text it covers.

## Selection

- A selection grown with Shift+ArrowRight takes one character per press through a tag, because
  the tag is text and nothing steps over it whole.

## The heading opener contests the same character

- A tag opening a line stays a paragraph, painted at paragraph size, exactly as it is under the
  widget model.

## Error cases

- no `[invariant:…]` console messages across the battery (asserted through `capturedErrors`)
