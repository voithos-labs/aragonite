# Feature: Image popover anchoring

## Layout

- The toolbar hangs off the widget's right edge as a column, level with its top, not at end
  of editor flow
- A widget with no room beside it (full width) tucks the toolbar inside its top-right corner
  as a row (`inside`); the placement is measured again whenever the overlay re-anchors
- Buttons and fields look like the editor's menus (same background, border, radius, shadow);
  the Markdown title survives commits but has no field
- Overlay re-anchors when a sibling image finishes loading and reflows the document, so the popover follows its target image's new position rather than staying behind over the old one
