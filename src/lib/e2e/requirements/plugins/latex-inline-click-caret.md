# Feature: a click on an inline formula seats the caret where it landed

A rendered `$…$` island reveals its editable source on a click. The caret it lands with used to be
the formula's end, whatever the press meant, so editing the head of a formula was a click plus a
walk back — while keyboard entry from the left landed at the leading edge, making the caret's
place depend on the door. The press names a point, and the point names an offset: KaTeX paints
glyphs rather than source bytes, so the press walks the content span in proportion to how far
along the painted run it fell. The `$$` block already reads a press this way
(`latex-block-click-caret.md`).

Seed (`?seed=math`): `Before $x^2$ after` in block [0], a `Next` paragraph in [1].

## Happy paths

- A click at the left of the rendered formula seats the caret at the start of the content: a typed
  character lands before the formula's first byte, inside the opening `$`.
- A click at the right seats it at the end of the content: a typed character lands after the
  formula's last byte, inside the closing `$`.
- Both hold in source mode and in live mode — the reveal is the same gesture behind hidden markers.

## Edge cases

- A press further along a longer formula (`$alpha+beta$`) seats a later offset than an earlier
  press, and both sit strictly inside the delimiters. Asserted as an ordering, not a byte: the
  mapping is proportional and a rect-derived x lands on whichever side of a glyph the font
  metrics put it.
- Escape between the two presses restores the rendered island, and neither reveal edits a byte.
- Keyboard entry is unchanged: arriving from the left still reveals at the leading edge
  (`latex-inline.md` owns that scenario).
- A kind that names no point mapping keeps the end seat — footnote references and directive text
  reveal at the end of their content as before.

## Miss-analysis

- Every inline-reveal scenario either arrived by keyboard or clicked the island's center and then
  pressed Home/End before typing, so the click's own landing was never the thing under test. The
  sibling `$$` block grew this scenario and the inline widget's identical gesture was never
  asserted as the same class.
