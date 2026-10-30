# Feature: Home before a line-leading image

A block whose text opens with an inline image has a position the caret can sit at
before the widget, where typing puts the byte ahead of `![...]`, but no text node
holds it, so the browser's own Home puts the caret past the image (GH #115). The
rule: Home lands before an image that opens the line, and a typed byte lands before
the image's bytes. The editor decides that landing for every line and engine
(`caret/motion-class.md`); these rows pin the first line. Driven on `/test/editor`;
the source read back through the test hooks is the expected answer.

## Happy paths

- source mode: click the trailing text, press `Home`, type, and the byte lands
  before `![`, with the caret reporting the block's start
- live mode: the same gesture, the same landing, since the modes share one path

## Edge cases

- a list item opening with an image: Home lands past the item's marker and before
  the image, the same spot as in a paragraph (GH #110)

## User interactions

- a real click on the trailing word, a real `Home`, a real typed key: the handling
  lives inside the keydown dispatch, and placing the caret programmatically would
  skip it

## Error cases

## Miss-analysis

The image caret suites pinned clicks, arrows and typing around the widget, but
no spec pressed Home on a line whose first usable caret position sits against the
widget: the one arrival the browser settles from the line's geometry rather than
from the DOM-to-offset traversal.
