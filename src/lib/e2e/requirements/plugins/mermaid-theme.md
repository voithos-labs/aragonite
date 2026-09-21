# Feature: Mermaid diagrams follow the editor theme

Mermaid paints the colors into the SVG it returns, so no stylesheet can recolor a diagram that
is already drawn: the diagram has to be drawn again for the new theme. The renderer contract
therefore carries a theme (`MermaidRenderContext.theme`, the editor's `data-editor-theme` name),
the plugin's memoized render keys on it, and the block reads the theme live, so a change to the
`theme` prop re-renders every mounted diagram. Driven on `/test/plugins?seed=mermaid` through
the header's "Light theme" toggle, with a real click.

An editor theme name that matches one of mermaid's own themes passes through; anything else
falls back to mermaid's light `default`. An app that wants a different mapping wraps the
injected renderer.

## Happy paths

- a diagram rendered in the dark theme paints dark node fills
- switching the `theme` prop to light re-renders every mounted diagram, and the node fills change
- switching back to dark restores the dark fills, and the earlier render is still memoized under
  its own key, so this costs no rendering work

## Edge cases

- every mounted diagram recolors, not only the focused one, which both seeded diagrams show
- a theme switch renders no duplicate diagram: the number of mounted `<svg>` elements is
  unchanged
- a theme switch writes no bytes: `getSource()` is byte-identical across the switch and back

## Error cases

- no `[invariant:…]` console messages across any scenario (automatic through the shared e2e
  fixture)
