# Feature: Mermaid diagrams follow the editor theme

The engine paints colors INTO the SVG it returns, so no stylesheet can retheme a
diagram already drawn — the diagram has to be redrawn for the theme. The renderer
contract therefore carries a theme term (`MermaidRenderContext.theme`, the editor's
`data-editor-theme` name), the plugin's render memo keys on it, and the block reads
the theme live so a `theme` prop change re-renders every mounted diagram. Driven on
`/test/plugins?seed=mermaid` via the header "Light theme" toggle (a real click).

Editor theme names that match one of mermaid's own themes pass through; anything else
resolves to mermaid's light `default`. A consumer wanting a different mapping wraps
the injected renderer.

## Happy paths

- a diagram rendered in the dark theme paints dark node fills
- flipping the `theme` prop to light re-renders every mounted diagram, and the node
  fills change
- flipping back to dark restores the dark fills (the earlier render is still memoized
  under its own key, so this costs no engine work)

## Edge cases

- every mounted diagram recolors, not just the focused one (both seeded diagrams)
- a theme flip renders no duplicate diagram: the mounted `<svg>` count is unchanged
- a theme flip writes no bytes — `getSource()` is byte-identical across the flip and
  back

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared
  e2e fixture)
