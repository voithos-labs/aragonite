# Feature: Search highlights over image widgets

An image renders as an atomic widget with no visible text, but its markdown —
alt text, width, url — is still searchable. A match landing entirely inside an
image used to collapse to a zero-width sliver and paint nothing; the highlight
must instead cover the widget's box so the user can see where the match lives.

## Happy paths

- Searching a word that appears only in an image's alt text counts one match
  and paints a visibly wide highlight over the image; as the sole match it also
  carries the active-match tint.
- Searching text that appears only in the image's url paints the same visible
  highlight over the widget — the match exists nowhere in the on-screen text.

## User interactions

- In the default demo document, stepping through the matches for "list" to the
  ones inside the list's image: the highlight paints with real width over the
  image and exactly one match shows the active tint.
