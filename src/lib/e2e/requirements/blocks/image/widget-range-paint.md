# Feature: Inline image highlight during text range selection

Native `::selection` does not paint over `contenteditable=false` content, so a
single-block range that crosses an inline image leaves the image un-tinted while
the surrounding text picks up the selection color. A JS painter toggles a
`md-widget-selected` class on widgets the range intersects so styling can fill
the gap.

## Happy paths

- Drag-extend a range across an inline image: the image gains `md-widget-selected`
- Collapsing the selection (caret-only) removes the class

## Edge cases

- Cross-block selection that includes the image does NOT add the class —
  the cross-block overlay paints over the widget, double-paint would read as a bug
- Click-selecting a widget (popover state) does NOT add the class —
  the resize/popover overlay owns that visual
