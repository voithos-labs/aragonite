# Feature: `/test/host-theme` — a host cascade with no opt-in class

The only route that mounts `<Editor>` with no `.aragonite-editor-theme` anywhere: the
host-chrome tokens are declared on the page wrapper and the editor inherits them straight
down the cascade. That makes it the route-level check on G4.6d — the host-chrome defaults
sit behind the opt-in class alone, so a themed host's own values reach the editor unbridged.

`theming-tokens.md` covers the classed route and the type-scale token; this file owns the
colour half on the class-free route. The route exposes no `window.__test` bridge, so
assertions read computed style off rendered elements and interactions are real selections
on the page's own dropdowns.

Miss-analysis: nothing pinned the accent's path from a host wrapper to painted editor text,
because the route shipped with no spec at its own level — the entry-layer blind spot
culture.md names, one rung up from a module.

## Happy paths

- the route mounts the editor with no `.aragonite-editor-theme` in the document, so the
  host wrapper is the only source of the chrome tokens
- picking an accent moves `--color-accent` on the editor root to the picked value: an
  editor-scoped default would shadow it and pin the token at the theme's own green
- picking an accent repaints the surfaces that read it — inline link text and the footnote
  marker both take the new colour, and both differ from body text
- picking a theme flips `data-editor-theme` on the editor root and repaints the body text,
  independently of the accent
- the page chrome's UI font comes from the wrapper, not the app stylesheet's `:root`: the
  wrapper declares `--font-ui` itself, and its value differs from the `:root` one so an
  undeclared wrapper cannot pass by inheritance
  (miss-analysis: the token's reads were never asserted, so dropping the declaration left them
  silently resolving from `:root` — the same-value-by-inheritance shape a bare equality check
  would also have missed)

- a host-declared `--color-selection` reaches a painted selection overlay: a document-wide
  selection paints the wash the wrapper's base implies, measured against a probe rather than a
  hex, and a theme swap to a copper base repaints it
  (miss-analysis: no test read a painted selection colour at all, so the four presentational
  washes could ignore any host cascade — the entry-layer blind spot, one rung below the token
  manifest, which only pins declarations)

## Edge cases

- accent and theme are independent axes: an accent picked under a dark theme survives the
  flip to a light one, resolving to that theme's own hex for the preset
- `Accent: default` resolves to the theme's own accent rather than a stale previous pick

## Error cases

- zero `[invariant:…]` console fires across the picker interactions (automatic via the
  shared e2e fixture)
