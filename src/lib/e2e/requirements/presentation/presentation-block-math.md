# Feature: reading-mode flip commits a render-primary reveal (presentation-mode rung 1)

A render-primary block (LaTeX `$$…$$` display math) reveals its raw source on
focus and commits once on blur. Flipping the editor to `reading` while such a
reveal holds an UNCOMMITTED edit must commit that edit before the surface goes
inert — the commit rides the blur-class mode effect (which blurs the active
in-editor element on the flip), so `commitSource` / `commitReveal` run with the
mode already `reading`. Those commits are deliberately NOT reading-gated (unlike
the plain-leaf `commitInput`); this scenario pins that asymmetry against a
regression that would silently drop the edit. Driven on
`/test/plugins?seed=mathblock` (the LaTeX plugin + `window.__test` bridge) via a
focus-preserving header toggle, so the flip does not steal focus first.

## Happy paths

- reveal the math source, edit it, flip to reading with no intervening click: the
  edit commits (source updated) and the KaTeX render shows; the source element is
  gone
- flipping back to source restores editing: the block reveals and edits again

## Edge cases

- reveal with NO edit, then flip to reading: a pure view toggle — the source is
  byte-stable (round-trip holds)
- the committed edit survives because the commit is driven by the blur-class mode
  effect, not a focus-stealing blur (the toggle preserves editor focus, so the
  commit runs while the mode is already `reading`)

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
