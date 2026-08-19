# Feature: Home before a line-leading image

A block whose text opens with an inline image has a landable position BEFORE the
widget — typing there puts the byte ahead of `![...]` — but no text node holds
it, so the engine's Home seats the caret past the image and that position was
keyboard-unreachable in every mode (GH #115). The contract: bare Home seats the
block's start through the sentinel door, and a typed byte lands before the
image's bytes. Driven on `/test/editor`; the source bridge is the oracle.

## Happy paths

- source mode: click the trailing text, press `Home`, type — the byte lands
  before `![`, and the caret reported the block's start
- live mode: the same gesture, the same landing — the modes share the door

## Edge cases

- a list item opening with an image routes Home through the ambient arm's
  sentinel (GH #110); the clamp lands it before the image all the same

## User interactions

- real click on the trailing word, real `Home`, real typed key — the door lives
  inside the keydown dispatch and a programmatic seat would bypass it

## Error cases

## Miss analysis

The image caret suites pinned clicks, arrows and typing around the widget, but
no spec pressed Home on a line whose first landable position abuts the widget —
the one arrival the engine resolves by line geometry instead of the walk.
