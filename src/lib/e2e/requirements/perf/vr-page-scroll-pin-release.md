# Feature: Virtual rendering — reveal-pin release in a page-scrolled host

While a reveal claim is live the root scope re-asserts the target's position on every measure
pass, and any user-intent gesture in the document releases it. Under `scrollMode="host"` with
the page as the scrollport, the gesture that takes the viewport back is one the editor's own
subtree never sees, so the release listeners follow the resolved port rather than the editor
root. They stay gesture-based and never key on `scroll`: a programmatic correction fires
`scroll` itself and would self-release the pin mid-settle.

## Happy paths

- A wheel outside the editor releases the pin and the page scrolls: with a pin held at a revealed target, wheeling over a point hit-tested to be outside the editor subtree moves `window.scrollY`, and it stays moved across the following measure passes. With the listeners bound to the editor root the page is locked at the reveal target and never self-releases.

## Edge cases

- A pin nothing disturbs still holds across several frames — without this arm the release could widen to "always release" and read green.
- The wheel point is hit-tested, not assumed: a point that silently landed inside the editor would make the release arm vacuous.

## Error cases

- No page errors surface during the reveal or the release.
