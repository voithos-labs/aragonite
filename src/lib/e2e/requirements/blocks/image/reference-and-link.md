# Feature: Reference-style images and images nested in links

Two shapes beyond the plain inline image: a reference image (`![alt][ref]`
resolved through its `[ref]:` definition) and an image living inside a link
(`[![alt][ref]][repo]`). Both must behave like any other image — clickable,
resizable — and edits that don't touch the url must keep the reference form
intact instead of silently rewriting it to an inline url and orphaning the
definition.

## Happy paths

- A reference image nested inside a link renders as an image widget, not as
  plain text.
- Clicking the image inside a link selects it — the resize/properties overlay
  appears just as it does for a bare image.

## Edge cases

- Keyboard-resizing the image inside a link preserves both wrappers: the
  surrounding link survives, the image stays a reference, and its definition
  line is untouched — the resolved url is never written into the image.
- Keyboard-resizing a standalone reference image updates only the width; the
  reference form and its definition both survive, nothing is inlined.

## User interactions

- Editing the url in the image properties popover deliberately inlines the
  image: the new url is written in place and the reference form is gone (the
  one edit that opts out of the reference).
- Dismissing the properties popover without changing anything is a true no-op:
  the reference and its definition are preserved and no undo entry is added.
