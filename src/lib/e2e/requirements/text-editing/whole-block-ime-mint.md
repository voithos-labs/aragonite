# Feature: AltGr and IME input at whole-block focus mints a paragraph below

A printable typed at a `blockFocus: 'whole-block'` kind creates a paragraph below, and that path
reads a plain keydown. Two whole classes of printable never arrive that way: an AltGr production
carries Ctrl+Alt, which the chord check declines, and an IME composition emits no committing
keydown at all. Both arrive as `beforeinput` / `compositionend` on an editing host, and the focused
element of such a block is a bare `tabindex=0` div with no editing host under it, so both were
dropped whole.

The block now carries a hidden editing host inside its box. Whole-block focus lands there, so those
events fire, and what they carry creates the same paragraph below that a plain keystroke does. The
keydown route is untouched: plain printables still create the paragraph from it, and the set of
chords is unchanged.

Fixture: `Before` / `---` / `After`, so the break has an editable neighbour on each side.

## Happy paths

- Focused thematic break, an AltGr-shaped `insertText` of `€`: a paragraph `€` sits between the
  rule and `After`
- Focused thematic break, an IME composition committed as `日本`: a paragraph `日本` sits below
  the rule, and the composed text appears nowhere in the rule's own bytes

## Edge cases

- One Mod+Z after an IME commit restores the source from before it byte-exactly: the composed
  insert is a single undo entry, like the plain-keystroke one
- An aborted composition (committed empty) leaves the document byte-unchanged: no empty paragraph
- Clicking the rule and then composing works the same as arrowing into it, since a click reaches
  the editing host too

## Error / mode cases

- Reading mode: an AltGr-shaped insert at whole-block focus leaves the document byte-unchanged

## Miss-analysis

- The whole-block suites drove input through `keyboard.press` only, so the one input path the
  block had was also the only one any test used; no scenario asked whether a printable arriving
  through the browser's own editing events reached that path at all
