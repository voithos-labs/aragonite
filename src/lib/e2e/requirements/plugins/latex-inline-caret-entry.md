# Feature: Inline Math — Horizontal Caret Entry Reveals the Source

Horizontal caret entry against an inline-math widget opens its source reveal
(Obsidian model). The caret never enters the invisible widget-selected state math
used to fall into: ArrowLeft/Backspace from the trailing edge and ArrowRight/Delete
from the leading edge all reveal the editable `$…$` source at the entered edge, with
zero CST mutation on the entry press (no undo entry). The reveal-vs-select policy
keys off the widget kind's `revealSource` flag at one seam — images keep
select-then-step (pinned in `blocks/image/caret-arrows-horizontal.md` and
`backspace-delete.md`), reveal-capable kinds reveal.

Seed (`?seed=math`): `Before $x^2$ after` in block [0], a `Next` paragraph in [1].
Cross-block scenarios load their own two-block seeds.

## Happy paths

- caret right of the widget, ArrowLeft: source revealed at the trailing edge, source
  byte-unchanged; a typed char lands after the closing `$`
- caret left of the widget, ArrowRight: source revealed at the leading edge; a typed
  char lands before the opening `$`

## Edge cases

- walking the caret left out of the revealed source (past the leading boundary) folds
  the reveal back to the rendered widget, source unchanged
- Backspace right of the widget reveals with the source fully intact (NOT a silent
  whole-widget delete); the next Backspace visibly eats the trailing `$`
- Delete left of the widget reveals at the leading edge; the next Delete eats the
  opening `$`
- Shift+ArrowLeft over the widget extends a real (non-collapsed) selection without
  revealing — a selection sweep never reveals

## User interactions

- cross-block ArrowRight from the block above onto a block that STARTS with math:
  reveal at the leading edge (the near edge the move arrived at)
- cross-block ArrowLeft from the block below onto a block that ENDS with math: reveal
  at the trailing edge
- all gestures are real keyboard input; caret direction is verified by typing a
  marker char, reveal by the widget count dropping to zero, byte-stability by the
  serialized source

## Error cases

- the entry press pushes no undo entry and mutates no bytes — reveal is a view toggle
