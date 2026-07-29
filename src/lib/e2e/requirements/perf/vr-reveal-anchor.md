# Feature: Virtual rendering — reveal-anchor ownership

While a programmatic reveal is in flight the windowing scope holds the reveal
target's screen position instead of the top-of-viewport block, so async layout
churn (an image decoding, a diagram settling) cannot clamp the resolved target
off-screen. The slot holds one target, and two properties decide whether it holds
the RIGHT one: the pin names the full target path, and only the claimant that
still holds the pin may drop it.

Both are cross-cutting — neither is reachable from a single-caller spec — and both
bite AFTER the reveal's own settle resolves, which is what `plugins/toc-navigation`
and `search/reveal-past-undecoded-images` (the mount/scroll composition) cannot
see. The ownership algebra itself is unit-pinned in `test/cursor/reveal-anchor`
and `test/cursor/editor-rects`; this file covers what a reader observes.

## Happy paths

- **A nested target stays where the reveal put it:** navigating to a heading deep
  inside a container taller than the viewport lands it in view, and a measure pass
  arriving afterwards (an image below the container decoding late) leaves it in
  view. Pinning the container's top instead pushes the resolved target a
  container-height below the fold.
- **The newer navigation keeps the pin:** when a `'center'` reveal — whose terminal
  release is unconditional — resolves inside a navigation's settle window, the
  navigation's pin survives it, so a later measure pass still re-asserts the
  navigation's target rather than finding an empty slot.

## Edge cases

- The image sits BELOW the container on purpose: nothing above the viewport moves
  when it decodes, so the honest top-of-viewport correction is a no-op and any
  movement at all is the pin re-asserting.
- A bare `scroll` never releases the pin (a programmatic anchor correction fires
  one itself), so a programmatic scroll followed by a measure pass is the
  observable for "the pin is still armed".

## Error cases

- No page errors surface during the reveal, the race, or the late decode.
