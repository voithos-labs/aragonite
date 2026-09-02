# Feature: `/` showcase paints the occurrence marks

`highlight-occurrences` emits marks carrying its own class, and the library's
`.decoration-overlay` rule is geometry only, so the color is the consuming page's job.
The showcase is that consuming page: a caret inside a word has to light the other
occurrences up there, not merely mount four invisible overlays. The showcase document
says so in as many words ("click into a word, say banana, and every banana on this page
lights up"), and it holds exactly four `banana`s in one paragraph with no inline markup,
so the same gesture reads the same in every presentation mode.

Like the other `/` specs this one has no `window.__test` bridge: the caret arrives by a
real mouse click on the word's own rect, and the paint is read off `getComputedStyle`.

## Happy paths

- clicking inside a `banana` in source mode paints four `.decoration-overlay.hl-occurrence`
  elements, each with a background whose alpha is above zero
- the same click in live mode paints the same four visible marks, since decorations are
  view-only and hidden markers change nothing about the overlay's paint

## Edge cases

- the paragraph may be windowed out at the default viewport, and a windowed-out block host is
  not in the DOM at all, so the spec scrolls the page until the host mounts and only then
  scrolls it into view; waiting on the host first hung for the full timeout once the demo
  document grew a longer opening above the paragraph
- the click lands on the center of the word's own client rect, not on a character offset
  counted from the paragraph start, so editing the showcase prose cannot retarget it silently

## Miss-analysis

Every occurrence spec ran on `/test/plugins`, whose harness page styles
`.decoration-overlay.hl-occurrence` itself, so no spec could see a consumer page that
does not style it.
