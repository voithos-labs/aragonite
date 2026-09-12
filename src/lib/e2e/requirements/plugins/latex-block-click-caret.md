# Feature: a click on an equation seats the caret where it landed

A `$$` block reveals its source on a click. The caret it lands with used to be the source's end,
whatever the press meant, so editing the head of a formula was a click plus a walk back. The
press names a point, and the point names an offset: the revealed card IS the source bytes, and
the folded render is glyphs whose position along the equation names a place in its body.

## Happy paths

- A click at the left of the rendered equation seats the caret at the start of the body: a typed
  character lands before the formula's first byte, inside the fence.
- A click at the right of the rendered equation seats it at the end of the body: a typed
  character lands after the formula's last byte, inside the fence.

## Edge cases

- A click in the card beside the ink clamps into the glyph box, so it takes the nearest glyph:
  left of the equation is the body's start, not the far side of the closing fence.
- A click in an already-revealed card is a click in a contenteditable and lands natively; the
  hook answers for the folded render alone.
- Keyboard entry is unchanged: arriving from the block above still lands at the source's leading
  edge (`latex-block.md` A1 owns that).
