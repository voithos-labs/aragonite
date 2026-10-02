# Feature: image-load scroll stability

The editor turns the browser's own scroll anchoring off (`overflow-anchor: none`) so that
its own correction owns the scroll position under virtual rendering. A remote image
without both width and height reserves no layout box until its bytes decode, then grows
asynchronously. That growth must not shift the visible content.

## Happy paths

- An unsized image above the viewport finishes loading: the block at the top of the
  viewport holds its on-screen position (the scroll compensates for the image's growth).

## Edge cases

- The image really does grow on load (the block gets taller): the correction has to fire
  from that real growth, not from a case that passes while nothing happened.

## User interactions

- Scroll an unsized, still-loading image above the viewport, then let it load: the
  reading position does not jump.

## Error cases

- No ResizeObserver loop error reaches `window.onerror` when a height correction mounts another block. Miss-analysis: the shared fixture relayed only thrown page errors until it also relayed `window.onerror`, so this loop error went unseen.
