# Feature: Decoration overlay over a block drawn whole

A block drawn whole with no text of its own, such as the mermaid diagram, has nothing inside to
paint a decoration mark, so the block paints the mark on itself, measuring its whole box through
`measurePartialRects`. It is the rule the selection overlay's `delegatesPainting` already
follows, applied to decorations.

## Happy paths

- A mark on the mermaid block's own path paints one `.decoration-overlay` inside that block's
  host, sized to the block, so its width is greater than zero

## Edge cases

- Disposing the source removes the block-level mark from the screen

## Miss-analysis

- The overlay over a block drawn whole is driven end to end through
  decorations, where a source targets the block path directly, independent of search. The
  counterpart driven from search has its own coverage in
  `requirements/search/childless-container-match.md`.
