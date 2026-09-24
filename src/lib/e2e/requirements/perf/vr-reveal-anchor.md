# Feature: Virtual rendering, reveal-anchor ownership

While a programmatic scroll-into-view is in progress, windowing holds the target's
screen position instead of the top-of-viewport block's, so layout arriving later
(an image decoding, a diagram settling) cannot clamp the resolved target
off-screen. One target is held at a time, and two properties decide whether it is
the right one: the hold names the full target path, and only the caller that
still holds it may drop it.

Both cut across callers, so neither is reachable from a spec with one caller, and both
bite after the scroll's own settle resolves, which is what `plugins/toc-navigation`
and `search/reveal-past-undecoded-images` (the mount and scroll together) cannot
see. The ownership rules themselves are unit-pinned in `test/cursor/reveal-anchor`
and `test/cursor/editor-rects`; this file covers what the user sees.

## Happy paths

- **A nested target stays where the reveal put it:** navigating to a heading deep
  inside a container taller than the viewport lands it in view, and a measure pass
  arriving afterwards (an image below the container decoding late) leaves it in
  view. Holding the container's top instead pushes the resolved target a
  container-height below the fold.
- **The newer navigation keeps the hold, and its target:** when a `'center'` scroll
  resolves inside a navigation's settle window, the navigated target is still in view
  afterwards. With the hold taken from under it, an undecoded image above the target
  keeps the document settling past the navigation's own resolve and the target is
  already gone.

## Edge cases

- Where the late image sits decides what each case measures. Below the
  container: nothing above the viewport moves when it decodes, so the ordinary
  top-of-viewport correction does nothing and any movement at all is the hold
  re-asserting the wrong block. Above the target: `'nearest'` lands the target near
  the viewport bottom, so the ordinary correction holds a paragraph above the image
  and the target is pushed off the bottom; only a held target re-asserts it.
- The hold outlives the settle, so a decode landing after the navigation resolves
  re-asserts the target rather than shifting it. Second property of the race case,
  not what the race itself turns on.
- **A bare `scroll` never releases the hold**, only a keydown, pointerdown or wheel
  does, because a programmatic anchor correction fires a `scroll` itself and would
  otherwise release mid-settle. Carried by the race case's assertion before the
  release: every re-assertion between the navigation resolving and that read
  happens after scroll events the correction itself fired, so a hold that released
  on `scroll` strands the target there.
- Changes inside the target's own container reach the hold too: a nested list's
  subtotal report upward consults it before writing, so growth above the target
  within its container re-asserts the target rather than displacing it.
- The hold gives up entirely once a mounted container has windowed its target out:
  the user scrolled past it, and the container's own top is a different block, so
  re-asserting would teleport them back. A container windowed out at the top level
  is the other case: nothing but the height table knows where the target sits, so
  the hold keeps the container.

## Error cases

- No page errors surface during the reveal, the race, or the late decode.
- No ResizeObserver loop error reaches `window.onerror` when a height correction mounts another block. Miss-analysis: the shared fixture relayed only thrown page errors until it also relayed `window.onerror`, so this loop error went unseen.
