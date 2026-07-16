# Feature: showcase presentation-mode toggle

The `/` showcase header carries a source/reading mode toggle wired to the
live `presentationMode` prop. Like the showcase smoke, this route exposes no
`window.__test` bridge, so assertions are rendered-DOM only. The reading rung's
promise on this route: markers disappear, rendered widgets (KaTeX math, mermaid)
stay rendered, and flipping back restores the source look.

## Happy paths

- the header shows a mode toggle; clicking "reading" sets
  `data-presentation="reading"` on the editor root
- in reading mode, heading/emphasis markers are hidden while the math island
  (`.katex`) and the mermaid block stay visible
- clicking "source" removes the `data-presentation` attribute and markers
  paint again

## User interactions

- toggle by real clicks on the header buttons only — no programmatic prop pokes

## Error cases

- zero `[invariant:…]` console fires across the toggle round-trip (automatic
  via the shared e2e fixture)
