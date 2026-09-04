# Feature: showcase presentation-mode toggle

Nothing here names a sentence of `src/routes/showcase-content.md`: the owner rewrites that
document by hand, and the version pinned to its prose went red on the rewrite. What the flip
must preserve is read off the rendered document instead.

The `/` showcase header carries a mode toggle wired to the live `presentationMode` prop.
Like the showcase smoke, this route exposes no `window.__test` bridge, so assertions are
rendered-DOM only. The reading rung's promise: markers disappear, whatever the document
renders as an inline widget stays rendered, and flipping back restores the source look.

## Happy paths

- clicking "reading" sets `data-presentation="reading"` on the editor root; clicking
  "source" removes the attribute again
- in reading mode no member of the hidden marker family (`.md-marker` without
  `contenteditable="false"`) is visible anywhere in the mounted document, and every one of
  them paints again on the way back
- every inline widget mounted before the flip is still mounted after it — the rendered half
  of the document survives the rung that hides its syntax
- every block mounted both before and after the round trip carries byte-identical text, compared
  block by block (a windowed editor's text is only its mounted slice, and the reading flip
  re-measures heights, so the window after the trip need not be the window before), so the flip is a view
  change and nothing else

## Edge cases

- the tour's inline widgets sit well below the fold, so the spec parks at the end of the
  document first; "widgets survived" asserted where none are mounted proves nothing
- hiding markers shortens the document, which moves the window: the end of the scrollport is
  the one position a mode flip cannot shift, so the text comparison is made there both times

## User interactions

- toggle by real clicks on the header buttons only — no programmatic prop pokes

## Error cases

- zero `[invariant:…]` console fires across the toggle round-trip (automatic via the shared
  e2e fixture)

## Miss-analysis

The round trip compared the editor's whole mounted text. Run alone, the same window mounted both
times and the comparison held; under the full battery's load the reading flip re-measured heights
and the window landed on other blocks, so identical bytes read as a mismatch. No run of the spec
on its own could show it.
