# Feature: showcase presentation-mode toggle

Nothing here names a sentence of `src/routes/showcase-content.md`: the owner rewrites that
document by hand, and the version pinned to its prose went red on the rewrite. What the mode
switch must preserve is read off the rendered document instead.

The `/` showcase header carries a mode toggle wired to the live `presentationMode` prop.
Like the showcase smoke, this route exposes no `window.__test` bridge, so assertions are
rendered-DOM only. The reading mode's promise: markers disappear, whatever the document
renders as an inline widget stays rendered, and switching back restores the source look.

## Happy paths

- the showcase opens in live mode, which paints no marker, so the round trip below starts by
  clicking "source"
- clicking "reading" sets `data-presentation="reading"` on the editor root; clicking
  "source" removes the attribute again
- in reading mode no member of the hidden marker family (`.md-marker` without
  `contenteditable="false"`) is visible anywhere in the mounted document, and every one of
  them paints again on the way back
- every inline widget mounted before the switch is still mounted after it: the rendered half
  of the document survives the mode that hides its syntax
- every block mounted both before and after the round trip carries byte-identical text, compared
  block by block (a windowed editor's text is only its mounted slice, and the switch into
  reading re-measures heights, so the window after the trip need not be the window before), so
  the switch is a view change and nothing else. A block that does drift is reported with both of
  its texts, since which block moved is a different question from whether it rendered
  differently or was read mid-frame

## Edge cases

- the tour's inline widgets sit well below the fold, so the spec scrolls to the end of the
  document first; "widgets survived" asserted where none are mounted proves nothing
- hiding markers shortens the document, which moves the window: the end of the scroll container
  is the one position a mode switch cannot shift, so the text comparison is made there both
  times
- the first sample waits for a settled document: nothing still announcing itself as rendering,
  and two consecutive reads of the mounted text in agreement. A diagram whose first render pulls
  its library over a cold dev server sits on a stable placeholder while it does, so neither wait
  covers the other

## User interactions

- toggle by real clicks on the header buttons only, never by writing the prop

## Error cases

- zero `[invariant:…]` console fires across the toggle round-trip (automatic via the shared
  e2e fixture)

## Miss-analysis

The first sample was taken the moment the widgets appeared, so a diagram still fetching its
renderer was compared against the same diagram once it had one, and the mode switch took the
blame for a render that had simply not finished when the spec looked. The general answer: a
before/after comparison that never established what "before" was allowed to be.

A drifted block was reported by path alone, so the one signal the failure carried named the block
and not the difference, and two rounds of diagnosis went on a block nobody could see the text of.
The general answer: a comparison whose failure message is narrower than the comparison itself.

The round trip compared the editor's whole mounted text. Run alone, the same window mounted both
times and the comparison held; under the full battery's load the switch into reading re-measured
heights and the window landed on other blocks, so identical bytes read as a mismatch. No run of
the spec on its own could show it.
