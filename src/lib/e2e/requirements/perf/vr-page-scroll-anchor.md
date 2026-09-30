# Feature: Scroll anchoring in a page-scrolled host embedding

The browser's own scroll anchoring and windowing's manual correction cannot both hold one
scroll position: two writers double-correct (VR-2). Exactly one runs, and the activation
decides which. While windowing runs, the editor corrects by hand and withdraws its own
subtree from the host's anchor candidates (`overflow-anchor: none`); below the budget
it corrects nothing and stays a candidate, so the host's own anchoring holds the
user's place. This is the stated trade of windowing under host scroll.

Fixture: `/test/page-scroll`, sized across the windowing threshold with `?blocks=`. Two growers
of identical size (a 400x300 SVG that decodes on demand): one is an image block inside
the document, mounted under `imageLoadPolicy="placeholder"` until the spec changes the
policy; the other is a plain `<img>` outside the entry.

## Happy paths

- Above the budget, a document image decoding in above the fold leaves the user's top
  visible block the same block at the same viewport offset (within 1px): the
  manual correction holds it, since the editor is no longer an anchor candidate.
- Below the budget, the identical growth holds the user's place too, this time because the
  editor's blocks are still anchor candidates and nothing corrects by hand. A red here
  means the opt-out was applied unconditionally.
- Below the budget with a scroll-into-view request still held (`rects.scrollTo` holds its
  target by default), the identical growth still holds the user's place. That request's
  re-assertion outranks every other anchoring rule and writes an absolute position, so it
  is the one path that would otherwise remain a second writer once the compensation itself
  is switched off.

## Edge cases

- The editor root's computed `overflow-anchor` is `none` exactly when spacers render and
  `auto` when they do not. This is the mechanism the two cases above depend on, asserted
  directly so a regression names itself rather than surfacing as drift.
- The user sits just past the image block, so the growing image is above the fold and
  inside the mounted band: an unmounted image never decodes and grows nothing, which
  would let the windowed case pass for nothing.
- The attribution case on the unwindowed route: the identical image decoding in outside
  the entry holds the user's place, whatever the editor's subtree does. A red here means the
  page has no scroll anchoring at all, which would make the case above red for the wrong
  reason.
- Both cases assert the viewport holds nothing but entry content at the moment of growth
  (a filler still in view is a valid anchor candidate the editor had no part in) and
  that the user is scrolled off offset 0 (anchoring makes no adjustment there).

## Known consequence, not asserted

Withdrawing the editor's subtree leaves the host nothing to anchor on whenever the
viewport holds only editor content, so content of the host's own above a windowing editor
that sizes late goes uncompensated. Deliberate: the alternative is two writers
on one scroll position. Recorded here rather than pinned by a test, because pinning a pixel
jump would cement it against a future improvement.

## Error cases

- No uncaught page errors surface during the decode or the reflow that follows.
