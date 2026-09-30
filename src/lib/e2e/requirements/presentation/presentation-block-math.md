# Feature: reading-mode flip commits a render-primary reveal (presentation mode 1)

A block that renders rather than shows its markup (LaTeX `$$…$$` display math)
shows its raw source on focus and commits once on blur. Switching the editor to
`reading` while that open source holds an uncommitted edit must commit the edit
before the block goes inert. The commit rides the mode effect that blurs the
active element inside the editor on a mode switch, so `commitSource` and
`commitReveal` run with the mode already `reading`. Those two commits deliberately
do not check for reading mode, unlike the plain-leaf `commitInput`, and this
scenario pins that difference against a regression that would silently drop the
edit. Driven on `/test/plugins?seed=mathblock` (the LaTeX plugin plus the
`window.__test` bridge) through a header toggle that keeps focus, so the mode
switch does not steal focus first.

## Happy paths

- open the math source, edit it, switch to reading with no click in between: the
  edit commits (source updated) and the KaTeX render shows; the source element is
  gone
- switching back to source restores editing: the block shows its source and edits
  again

## Edge cases

- open the source with no edit, then switch to reading: a pure view change, and
  the source is byte-stable (the round trip holds)
- the committed edit survives because the commit is driven by that mode effect
  rather than by a blur that steals focus: the toggle keeps editor focus, so the
  commit runs while the mode is already `reading`

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
