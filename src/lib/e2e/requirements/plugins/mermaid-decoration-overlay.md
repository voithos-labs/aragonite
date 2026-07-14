# Feature: Decoration overlay over a childless opaque container

A container with NO child block-hosts (a render-primary plugin block like mermaid) has no
children to paint a decoration mark, so the block paints the mark on itself — measuring the
whole box through the container shim's `measurePartialRects`. This is the SelectionOverlay
`hasChildHosts` precedent applied to decorations. Lives in the plugins project because only
plugin kinds produce childless opaque containers.

## Happy paths

- A mark on the mermaid block's own path paints one `.decoration-overlay` inside that block's
  host, sized to the block (positive width)

## Edge cases

- Disposing the source unpaints the block-level mark

## Miss-analysis

- The overlay + shim route for a childless opaque container is driven end to end through
  decorations (a source targets the block path directly), independent of search. The
  search-fed twin has its own coverage in
  `requirements/search/childless-container-match.md` now that `scanDocument` scans a
  childless opaque container's raw.
