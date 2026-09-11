# Feature: Image popover anchoring

## Layout

- The toolbar hangs off the widget's right edge as a column, level with its top, not at end
  of editor flow
- A widget with no room beside it (full width) tucks the toolbar inside its top-right corner
  as a row (`inside`); the placement re-measures whenever the overlay re-anchors
- Buttons and fields are the menu family's surface (same background, border, radius, shadow);
  the Markdown title is kept through commits but has no field
- Overlay re-anchors when a sibling image finishes loading and reflows the document, so the popover follows its target image's new position rather than staying stranded over the old one
