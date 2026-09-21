# Feature: Decoration overlay over a childless opaque container

A container with no child block hosts, such as a render-primary plugin block like mermaid, has
no children to paint a decoration mark, so the block paints the mark on itself, measuring the
whole box through the container shim's `measurePartialRects`. It is the rule the selection
overlay's `delegatesPainting` already follows, applied to decorations. It lives in the plugins
project because only plugin kinds produce childless opaque containers.

## Happy paths

- A mark on the mermaid block's own path paints one `.decoration-overlay` inside that block's
  host, sized to the block, so its width is greater than zero

## Edge cases

- Disposing the source removes the block-level mark from the screen

## Miss-analysis

- The overlay and the shim for a childless opaque container are driven end to end through
  decorations, where a source targets the block path directly, independent of search. The
  counterpart driven from search has its own coverage in
  `requirements/search/childless-container-match.md`, now that `scanDocument` scans the raw
  text of a childless opaque container.
