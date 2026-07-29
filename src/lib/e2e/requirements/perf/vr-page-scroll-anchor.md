# Feature: Scroll anchoring in a page-scrolled host embedding

Self mode turns native scroll anchoring off because windowing corrects the scroll by
hand (VR-2). Host mode has no manual correction — windowing never activates — and the
editor root is not the scrollport, so holding the reader's place under late-sizing
content is entirely the browser's job. `overflow-anchor: none` excludes the editor's
whole subtree from the HOST's anchor candidates, which leaves the host nothing to
anchor on whenever the viewport holds only editor content.

Fixture: `/test/page-scroll`. Two growers of identical size (a 400x300 SVG that
decodes on demand): one is an image block inside the document, mounted under
`imageLoadPolicy="placeholder"` until the spec flips the policy; the other is a plain
`<img>` outside the entry.

## Happy paths

- A document image decoding in above the fold leaves the reader's top visible block at
  the same identity and the same viewport offset (within 1px). Before the host-mode
  anchoring opt-in, the same construction moved the reader ~10 blocks down the
  document — the image's whole height.

## Edge cases

- The control arm: the identical image decoding in OUTSIDE the entry holds the reader
  too, whatever the editor's subtree does — the host's own wrapper is an anchor
  candidate. A red here means the page has no scroll anchoring at all, which would
  make the arm above red for the wrong reason.
- Both arms assert the viewport holds nothing but entry content at the moment of
  growth (a filler still in view is a valid anchor candidate the editor had no part
  in) and that the reader is scrolled off offset 0 (anchoring makes no adjustment
  there).

## Error cases

- No uncaught page errors surface during the decode or the reflow that follows.
