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
- **The newer navigation keeps the pin, and its target:** when a `'center'` reveal —
  whose terminal release used to be unconditional — resolves inside a navigation's
  settle window, the navigated target is still in view afterwards. With the pin
  taken from under it, an undecoded image ABOVE the target keeps the document
  settling past the navigation's own resolve and the target is already gone.

## Edge cases

- Where the deferred image sits decides what each case measures. BELOW the
  container: nothing above the viewport moves when it decodes, so the honest
  top-of-viewport correction is a no-op and any movement at all is the pin
  re-asserting the wrong block. ABOVE the target: `'nearest'` lands the target near
  the viewport bottom, so the honest anchor holds a paragraph above the image and
  the target is pushed off the bottom — only a held pin re-asserts it.
- The pin outlives the settle, so a decode landing after the navigation resolves
  re-asserts the target rather than shifting it. Second property of the race case,
  not what the race itself turns on.
- **Not covered, and known:** churn INSIDE the target's own container. A nested
  scope's upward subtotal report is correction-free by design, so the pin is never
  consulted for it (`docs/issues.md`).

## Error cases

- No page errors surface during the reveal, the race, or the late decode.
