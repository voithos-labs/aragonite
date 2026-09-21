# Feature: Plugin Container, `<details>` Collapsed Height Estimate at Scale

Each kind's height estimator guesses the height of a block that is not mounted, which is what
top-level windowing sums over (`virtual-rendering.md` § How tall is a block nobody has
rendered?). A collapsed details carries its whole hidden body in
`raw` but renders as a single summary row, so estimating from the full `raw` over-counted every
collapsed details outside the window and inflated the scroll height at load. The estimator now
reads the declared `reservedChrome.isCollapsed` check and returns one title row for a collapsed
container, which is the tight estimate and removes the over-count at its source.

The unit suite pins the exact estimate: one title row when collapsed, the full `raw` when open.
This suite proves the same thing at scale: with top-level windowing active over a run of
collapsed details, the height at load no longer over-counts, and the editor stays correct under
the drift that is left.

## Happy paths

- a run of collapsed blocks at scale: the scroll height at load no longer exceeds the fully
  measured height. The tight estimate under-counts a collapsed block's real title row slightly,
  and the scroll correction absorbs that, which is far better than over-counting the hidden body

## Edge cases

- correctness under the drift that is left: no `BlockListState` goes out of sync and no render
  throws while the estimated and measured heights disagree at scale

## Material judgment (absorbed)

- the scroll correction that holds a block in place is not re-proven here: `correctAnchor`
  behaves the same in either direction and for any block list, so the virtual-rendering suite's
  general tests already prove that a gap between estimate and measurement is absorbed. Asserting
  a mid-jump inside this fixture would prove nothing: the real measured height is shorter than a
  viewport, so a jump to the estimated middle settles at the top through the browser's own
  `scrollTop` clamp, which is the clamp at work and not the correction

## Error cases

- the `[invariant:…]` console watcher stays silent, `getCapturedErrors()` is empty, and no
  `pageerror` fires across load and scrolling through
