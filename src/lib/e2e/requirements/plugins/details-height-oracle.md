# Feature: Plugin Container — `<details>` Height-Oracle Drift at Scale

Spec §8.3, CHARACTERIZATION (pin the observed, do not force a fix). The per-kind
height oracle estimates an unmounted block from its full `raw`. A collapsed
details carries its whole hidden body in `raw`, yet renders as one summary row, so
the oracle over-estimates every off-window collapsed details. In a large doc with
top-level windowing active this inflates the scroll height until each details is
scrolled into view and measured.

Judgment: NOT material — the drift is absorbed by the existing scroll-anchor
correction (the same machinery the VR suite proves for lists / tables /
blockquotes where estimate ≠ measured). A bounded fix — an open-aware height hook
the oracle consults — is a pre-freeze descriptor widening, deferred to the
controller. This suite records the accepted limit and guards the absorbed
behavior.

## Characterization

- over-estimate exists: with a run of collapsed details and top-level windowing
  active, the load-time scroll height exceeds the fully-measured scroll height;
  scrolling through (mounting + measuring each details) corrects it downward. The
  observed drift is logged and pinned; the fixed floor sits far below it so
  viewport-width variance does not flake the assertion

## Edge cases

- correctness under the drift: no BlockListState desync and no render throw while
  the estimated and measured heights disagree at scale

## Material judgment (absorbed)

- anchor absorption is NOT re-proven here: `correctAnchor` is sign-symmetric and
  scope-generic, so the VR suite's general anchor tests (the top-level `deep jump …
holds the viewport via scroll-anchor correction (VR-2)` and its nested-scope twin)
  already prove the over-estimate is absorbed. A local details mid-jump assertion is
  vacuous with this fixture: the real measured height (~2416px) is shorter than a
  viewport, so a jump to the estimated middle lands past the true end and settles at
  the top via the browser's scrollTop clamp — a clamp, not the anchor correction
  (byte-identical with `correctAnchor` neutered)

## Error cases

- the `[invariant:…]` console watcher stays silent, `getCapturedErrors()` is empty,
  and no `pageerror` fires across load and scroll-through
