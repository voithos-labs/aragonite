# Feature: AltGr and IME input at whole-block focus mints a paragraph below

The printable mint at a `blockFocus: 'whole-block'` kind reads a plain keydown, and two whole
classes of printable never arrive that way: an AltGr production carries Ctrl+Alt, which the
chord gate declines, and an IME composition emits no committing keydown at all. Both arrive as
`beforeinput` / `compositionend` on an editing host, and the focused element of such a block is
a bare `tabindex=0` div with no editing host under it — so both were dropped whole.

The block now carries a hidden editing host inside its box. Whole-block focus lands there, so
those doors fire, and what they carry mints the same paragraph below that a plain keystroke does.
The keydown route is untouched: plain printables still mint from it, and the chord space is
unchanged.

Fixture: `Before` / `---` / `After`, so the break has an editable neighbour on each side.

## Happy paths

- Focused thematic break, an AltGr-shaped `insertText` of `€`: a paragraph `€` sits between the
  rule and `After`
- Focused thematic break, an IME composition committed as `日本`: a paragraph `日本` sits below
  the rule, and the composed text appears nowhere in the rule's own bytes

## Edge cases

- One Mod+Z after an IME commit restores the pre-mint source byte-exactly — the composed mint is
  a single undo entry, like the plain-keystroke mint
- An aborted composition (committed empty) leaves the document byte-unchanged: no empty paragraph
- Clicking the rule and then composing works the same as arrowing into it — a pointer entry
  reaches the editing host too

## Error / mode cases

- Reading mode: an AltGr-shaped insert at whole-block focus leaves the document byte-unchanged

## Miss-analysis

- The whole-block suites drove input through `keyboard.press` only, so the one input path the
  block had was also the only one any test used; no scenario asked whether a printable arriving
  through the browser's editing doors reached the mint at all
