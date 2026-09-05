# Feature: the `/changelog` route at phone width

A reader following a release link on a phone reaches every release family, both presentation
modes and the way back to the showcase. The route is unchanged apart from what a 320px column
and a device with no hover force, so this file owns only the geometry the pinned 1280 viewport
cannot see. Everything else about the route lives in `plugins/changelog-route.md`.

Measured at 320x640 with touch, the narrowest phone worth serving. Like its sibling specs the
route exposes no `window.__test` bridge, and nothing here quotes a release note.

## Happy paths

- Nothing pans sideways: neither the page (`documentElement.scrollWidth` against `innerWidth`)
  nor the header (`scrollWidth` against `clientWidth`). The header wraps instead, because a row
  clipped on a page that cannot pan is a set of controls nobody can reach.
- Every release-family chip, both mode chips and the showcase link lie fully inside the
  viewport.
- A tap on the oldest family's chip makes it the active one and swaps the document to that
  family's title. Both reads happen before the tap as well: the newest family's title carries
  the oldest one's as a prefix, so only an anchored match read from both sides discriminates.
- Every chip and the link clears 24 CSS px on both axes, the WCAG 2.2 AA minimum. 44 is not the
  target: the header carries a chip per release family, and 44 apiece costs the document more
  rows than the condensed header saves.
- With the outline open, every entry in it clears 24 CSS px too. The outline is the toc
  plugin's own chrome, and this route is where it meets a thumb.

## User interactions

- Every gesture is a real tap under touch emulation.

## Error cases

- Zero `[invariant:…]` console fires across the interactions (automatic via the shared e2e
  fixture).

## Miss-analysis

- Route: the mobile pair was scoped to `/`, and no spec had ever loaded `/changelog` below
  1280, so a header row wider than the phone clipped the older families, both mode chips and
  the link with no pan to bring them back.
- Target size: nothing had ever measured the toc's outline entries against a minimum, on any
  pointer, so rows sized for a mouse cursor were never asked what a thumb needs.
