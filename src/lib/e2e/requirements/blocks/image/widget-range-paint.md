# Feature: Inline image highlight during text range selection

The browser's `::selection` does not paint over `contenteditable=false` content, so
a range inside one block that crosses an inline image leaves the image untinted
while the text around it picks up the selection color. The editor adds a
`md-widget-selected` class to the widgets a range crosses so styling can fill
the gap.

## Happy paths

- Drag-extend a range across an inline image: the image gains `md-widget-selected`
- Collapsing the selection (caret-only) removes the class

## Edge cases

- Cross-block selection that includes the image does not add the class:
  the cross-block overlay already paints over the widget, and painting twice would read as a bug
- Click-selecting a widget (popover state) does not add the class:
  the resize and popover overlay owns that look
