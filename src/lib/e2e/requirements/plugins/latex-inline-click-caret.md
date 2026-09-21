# Feature: a click on an inline formula puts the caret where it landed

A rendered `$…$` widget shows its editable source on a click. The caret used to land at the
formula's end whatever the click meant, so editing the head of a formula took a click plus a walk
back, while keyboard entry from the left landed at the leading edge: where the caret ended up
depended on how you got there. A click names a point, and that point names an offset. KaTeX
paints glyphs rather than source bytes, so the click maps into the content span in proportion to
how far along the painted run it fell. The `$$` block already reads a click this way
(`latex-block-click-caret.md`).

Seed (`?seed=math`): `Before $x^2$ after` in block [0], and a `Next` paragraph in [1].

## Happy paths

- A click at the left of the rendered formula puts the caret at the start of the content, so a
  typed character lands before the formula's first byte, inside the opening `$`.
- A click at the right puts it at the end of the content, so a typed character lands after the
  formula's last byte, inside the closing `$`.
- Both hold in source mode and in live mode, since showing the source is the same gesture behind
  hidden markers.

## Edge cases

- A click further along a longer formula (`$alpha+beta$`) lands at a later offset than an
  earlier one, and both sit strictly inside the delimiters. Asserted as an ordering rather than
  a byte, because the mapping is proportional and an x derived from a rect lands on whichever
  side of a glyph the font metrics put it.
- Escape between the two clicks brings the rendered widget back, and neither click edits a byte.
- Keyboard entry is unchanged: arriving from the left still shows the source at the leading edge
  (`latex-inline.md` owns that scenario).
- A kind that declares no mapping from point to offset keeps the caret position it had. Footnote
  references and directive text declare no content span either, so both still show their source
  at the leading edge, unchanged.

## Miss-analysis

- Every scenario that showed an inline source either arrived by keyboard or clicked the widget's
  centre and then pressed Home or End before typing, so where the click itself landed was never
  the thing under test. The sibling `$$` block grew this scenario and the inline widget's
  identical gesture was never asserted as the same class.
