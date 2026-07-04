# Feature: Plugin Container — `<details>` Collapsed Height Estimate at Scale

Spec §8.3. The per-kind height oracle estimates an unmounted block for top-level
windowing. A collapsed details carries its whole hidden body in `raw` but renders
as one summary row, so estimating from full `raw` over-counted every off-window
collapsed details and inflated the load-time scroll height. The oracle now reads
the declared `reservedChrome.isCollapsed` probe and returns one chrome row for a
collapsed container — the tight estimate — eliminating the over-estimate at its
root.

The unit suite pins the exact estimate (one chrome row collapsed, full-raw open).
This suite proves the property at scale: with top-level windowing active over a run
of collapsed details, the load-time height no longer over-counts, and correctness
holds under the residual drift.

## Happy paths

- collapsed run at scale: the load-time scroll height no longer exceeds the
  fully-measured height — the tight estimate slightly under-counts a collapsed
  block's real chrome, absorbed by scroll-anchor correction, rather than
  over-counting the hidden body

## Edge cases

- correctness under the residual drift: no BlockListState desync and no render
  throw while the estimated and measured heights disagree at scale

## Material judgment (absorbed)

- anchor absorption is NOT re-proven here: `correctAnchor` is sign-symmetric and
  scope-generic, so the VR suite's general anchor tests already prove that an
  estimate ≠ measured is absorbed. A local details mid-jump assertion is vacuous
  with this fixture: the real measured height is shorter than a viewport, so a
  jump to the estimated middle settles at the top via the browser's scrollTop
  clamp — a clamp, not the anchor correction

## Error cases

- the `[invariant:…]` console watcher stays silent, `getCapturedErrors()` is empty,
  and no `pageerror` fires across load and scroll-through
