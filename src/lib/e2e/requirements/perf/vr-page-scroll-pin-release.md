# Feature: Virtual rendering: reveal-pin release in a page-scrolled host

While a scroll-into-view request is live the root list re-asserts the target's position on every
measure pass, and any deliberate gesture in the document releases it. Under `scrollMode="host"`
with the page as the scroll container, the gesture that takes the viewport back is one the
editor's own subtree never sees, so the release listeners follow the scroll container that was
resolved rather than the editor root. They stay gesture-based and never key on `scroll`: a
programmatic correction fires `scroll` itself and would release the hold mid-settle.

## Happy paths

- A wheel outside the editor releases the hold and the page scrolls: with a target held, wheeling over a point hit-tested to be outside the editor subtree moves `window.scrollY`, and it stays moved across the following measure passes. With the listeners bound to the editor root the page is locked at the target and never releases.

## Edge cases

- A hold nothing disturbs still holds across several frames: without this case the release could widen to "always release" and read green.
- The wheel point is hit-tested, not assumed: a point that silently landed inside the editor would leave the release case proving nothing.

## Error cases

- No page errors surface during the reveal or the release.
