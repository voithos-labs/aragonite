# Feature: the `/changelog` route at phone width

Someone following a release link on a phone reaches every release family, the way back to the
showcase and the theme switch. The route is unchanged apart from what a 320px column and a device
with no hover force, so this file owns only the geometry the pinned 1280 viewport cannot see.
Everything else about the route lives in `plugins/changelog-route.md`.

Measured at 320x640 with touch, the narrowest phone worth serving. Like its sibling specs the
route exposes no `window.__test` bridge, and nothing here quotes a release note.

## Happy paths

- Nothing pans sideways: neither the page (`documentElement.scrollWidth` against `innerWidth`)
  nor the header (`scrollWidth` against `clientWidth`). A control clipped on a page that cannot
  pan is a control nobody can reach.
- The release families fold into one chip, as the showcase's modes do. The wordmark, that chip,
  the showcase link and the theme switch all show, and every link and button the header shows
  lies fully inside the viewport.
- A tap on the chip opens a list holding every release family, each option inside the viewport.
  A tap on the oldest family's option closes the list, names that family on the chip and swaps
  the document to its title. Both reads happen before the tap as well: the newest family's title
  carries the oldest one's as a prefix, so only a match anchored at both ends tells them apart.
- Every header control, and every option of the open list, clears 24 CSS px on both axes, the
  WCAG 2.2 AA minimum the rest of the demo's phone layout holds to.
- With the outline open, every entry in it clears 24 CSS px too. The outline is the toc
  plugin's own UI, and this route is where it meets a thumb.

## User interactions

- Every gesture is a real tap under touch emulation.

## Error cases

- Zero `[invariant:…]` console fires across the interactions (automatic via the shared e2e
  fixture).

## Miss-analysis

- Route: the mobile pair was scoped to `/`, and no spec had ever loaded `/changelog` below
  1280, so a header row wider than the phone clipped the older families and the link with no
  pan to bring them back.
- Target size: nothing had ever measured the toc's outline entries against a minimum, on any
  pointer, so rows sized for a mouse cursor were never asked what a thumb needs.
