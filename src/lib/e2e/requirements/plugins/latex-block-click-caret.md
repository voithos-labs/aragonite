# Feature: a click on an equation puts the caret where it landed

A `$$` block shows its source on a click. The caret used to land at the end of that source
whatever the click meant, so editing the head of a formula took a click plus a walk back. A
click names a point, and that point names an offset: the card that opens is the source bytes,
and the rendered form is glyphs whose position along the equation names a place in its body.

## Happy paths

- A click at the left of the rendered equation puts the caret at the start of the body, so a
  typed character lands before the formula's first byte, inside the fence.
- A click at the right of the rendered equation puts it at the end of the body, so a typed
  character lands after the formula's last byte, inside the fence.

## Edge cases

- A click in the card beside the equation itself clamps into the glyph box and takes the nearest
  glyph, so left of the equation is the start of the body rather than the far side of the
  closing fence.
- A click in a card whose source is already open is a click in a contenteditable and behaves the
  way the browser handles it; this handler answers only for the rendered form.
- Keyboard entry is unchanged: arriving from the block above still lands at the leading edge of
  the source (`latex-block.md` A1 owns that).
