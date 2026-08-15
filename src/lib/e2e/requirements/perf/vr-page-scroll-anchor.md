# Feature: Scroll anchoring in a page-scrolled host embedding

Native scroll anchoring and windowing's manual correction cannot both hold one scroll
position — two writers double-correct (VR-2). Exactly one runs, and the activation
decides which. While windowing runs, the editor corrects by hand and withdraws its own
subtree from the host's anchor candidates (`overflow-anchor: none`); below the budget
it corrects nothing and stays a candidate, so the host's native anchoring holds the
reader. This is the stated trade of windowing under host scroll.

Fixture: `/test/page-scroll`, sized across the watermark with `?blocks=`. Two growers
of identical size (a 400x300 SVG that decodes on demand): one is an image block inside
the document, mounted under `imageLoadPolicy="placeholder"` until the spec flips the
policy; the other is a plain `<img>` outside the entry.

## Happy paths

- Above the budget, a document image decoding in above the fold leaves the reader's top
  visible block at the same identity and the same viewport offset (within 1px) — the
  manual correction holding it, since the editor is no longer an anchor candidate.
- Below the budget, the identical growth holds the reader too, this time because the
  editor's blocks are still anchor candidates and nothing corrects by hand. A red here
  means the opt-out was applied unconditionally.
- Below the budget with a reveal claim still HELD (`rects.scrollTo` pins by default),
  the identical growth still holds the reader. The claim's re-assertion outranks every
  other anchor rule and writes an absolute position, so it is the one path that would
  otherwise stay a second writer after the compensation itself was gated.

## Edge cases

- The editor root's computed `overflow-anchor` is `none` exactly when spacers render and
  `auto` when they do not. This is the mechanism the two arms above depend on, asserted
  directly so a regression names itself rather than surfacing as drift.
- The reader is parked just past the image block, so the grower is above the fold AND
  inside the mounted band — a windowed-out image never decodes and grows nothing, which
  would make the windowed arm pass vacuously.
- The attribution arm on the unwindowed route: the identical image decoding in OUTSIDE
  the entry holds the reader, whatever the editor's subtree does. A red here means the
  page has no scroll anchoring at all, which would make the arm above red for the wrong
  reason.
- Both arms assert the viewport holds nothing but entry content at the moment of growth
  (a filler still in view is a valid anchor candidate the editor had no part in) and
  that the reader is scrolled off offset 0 (anchoring makes no adjustment there).

## Known consequence, not asserted

Withdrawing the editor's subtree leaves the host nothing to anchor on whenever the
viewport holds only editor content, so late-sizing content in the HOST's own chrome
above a windowing editor goes uncompensated. Deliberate: the alternative is two writers
on one scroll position. Recorded here rather than pinned, because pinning a pixel jump
would cement it against a future improvement.

## Error cases

- No uncaught page errors surface during the decode or the reflow that follows.
