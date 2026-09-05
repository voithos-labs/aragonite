# Feature: the `/` showcase at phone width

A visitor arriving from a shared link on a phone gets the same demo a desktop gets: the
document first, every presentation mode reachable, find and reorder operable by touch. The
route is unchanged apart from what a 320px column and a device with no hover force, so this
file owns only the geometry the pinned 1280 viewport cannot see. Everything else about the
route lives in `showcase-chrome.md`, `plugins/showcase-route.md` and
`presentation/presentation-showcase.md`.

Measured at 320x640 with touch, the narrowest phone worth serving. Like its sibling specs
the route exposes no `window.__test` bridge, and nothing here quotes the demo document,
which the owner rewrites by hand.

## Happy paths

- Nothing pans sideways: neither the page (`documentElement.scrollWidth` against
  `innerWidth`) nor the editor (`scrollWidth` against `clientWidth`). Blocks wider than the
  column scroll inside their own box, so the prose beside them stays where it was.
- Every presentation-mode pill lies fully inside the viewport, and a tap on `live` — the
  far end of the group, and the one an unwrappable strip loses first — flips the editor to
  that mode.
- The find bar opens fully inside the viewport, and a tap on its field followed by typed
  text reports matches.
- With the drag-handles toggle on, the grips are opaque with nothing hovering them, and a
  tap lands on the grip rather than falling through to the editor.
- Every header button and link, and every find-bar button, clears 24 CSS px on both axes, the WCAG
  2.2 AA minimum. 44 is not the target: the header carries eleven controls, and 44 apiece
  puts back over the document every row the condensed header saves.
- The header leaves the document at least three quarters of the screen. A quarter, not the
  fifth the condensed header alone reaches: thumb-sized controls cost two rows back, and a
  header nobody can operate is not a saved row.

## User interactions

- Every gesture is a real tap under touch emulation, and text reaches the find field by
  keystroke.

## Error cases

- Zero `[invariant:…]` console fires across the interactions (automatic via the shared
  e2e fixture).

## Miss-analysis

- Width: `playwright.config.ts` pins one 1280 viewport, and the handful of specs that
  override it widen or shorten for windowing reasons only. No spec had ever laid the route
  out in a column narrower than its chrome, so a control off the right edge, a bar off the
  left one and a block panning the document were all invisible to the suite.
- Touch: no spec had ever run with `hasTouch`, so an affordance revealed by `:hover` alone
  read as present in every run — `toBeVisible()` passes on an `opacity: 0` element, and
  only a hit test names the `pointer-events: none` half.
- Target size: nothing in the suite had ever measured a control's box against a minimum,
  on any pointer, so chrome sized for a mouse cursor was never asked what a thumb needs.
- Target-size census: the first pass matched `.showcase-header button`, and the header's two
  links are anchors, so the census closed the class everywhere except at the elements its
  selector could not name.
