# Feature: image-load scroll stability

The editor disables native browser scroll-anchoring (`overflow-anchor: none`) so its
own anchor correction can own the scroll line under virtual rendering. A remote image
without both width and height reserves no layout box until its bytes decode, then grows
asynchronously. That async growth must NOT shift the visible content.

## Happy paths

- An unsized image above the viewport finishes loading: the block at the top of the
  viewport holds its on-screen position (the scroll compensates for the image's growth).

## Edge cases

- The image genuinely grows on load (the block height increases) — the correction must
  fire from the real async growth, not a no-op that passes vacuously.

## User interactions

- Scroll an unsized, still-loading image above the viewport, then let it load: the
  reading position does not jump.
