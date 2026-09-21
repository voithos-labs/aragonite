# Feature: `/` showcase paints the occurrence marks

The word this spec clicks is read out of `src/routes/showcase-content.md` at run time and never
named in the spec: the owner rewrites that document by hand, and the version that hard-coded a
word went red the first time the word left the page.

`highlight-occurrences` emits marks carrying its own class, and the library's
`.decoration-overlay` rule is geometry only, so the color is the job of the page using it. The
showcase is that page, and the only spec that can see the paint go missing, since every other
occurrence spec runs on the plugins harness, which styles the class itself. The highlight is off
by default there: the owner found it distracting on a page people read, so the header carries an
`occurrences` toggle that remounts the editor with the plugin's per-editor option on.

Like the other `/` specs, this one has no `window.__test` bridge: the caret arrives by a real
mouse click on the word's own rect, and the paint is read off `getComputedStyle`.

## Happy paths

- with the highlight off, a caret inside the chosen word paints no
  `.decoration-overlay.hl-occurrence` at all; turning the header toggle on and repeating the
  same gesture paints the word's neighbors, each with a background alpha above zero
- the same click in live mode paints the same visible marks, since decorations only affect the
  view and hidden markers change nothing about the overlay's paint

## Edge cases

- the target is the most repeated alphabetic word of four letters or more inside a single plain
  paragraph, split into words the way the plugin splits them. It is kept to one paragraph so
  that both marks live in one mounted block, and the test is skipped with a named reason if the
  document holds none
- the paragraph may be unmounted at the default viewport, and an unmounted host is not in the
  DOM at all, so the spec scrolls the editor until the host mounts, then scrolls it into view
  before measuring the rect, because a rect below the viewport aims the click at nothing. Every
  click is then checked to have landed in a block holding the word: a click that missed leaves
  the caret nowhere, and "no marks painted" would pass for the wrong reason

## Error cases

- no `[invariant:…]` console messages across the gestures (automatic through the shared fixture)
