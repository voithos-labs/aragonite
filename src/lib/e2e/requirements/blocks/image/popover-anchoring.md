# Feature: Image popover anchoring

## Layout

- Popover is anchored just below the widget, not at end of editor flow
- Overlay re-anchors when a sibling image finishes loading and reflows the document, so the popover follows its target image's new position rather than staying stranded over the old one
