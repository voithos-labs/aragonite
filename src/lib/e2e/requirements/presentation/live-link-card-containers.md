# Feature: live-mode link card inside containers

A link does not only live in a top-level paragraph. The card resolves its target from the DOM the
same way wherever the link is — a table cell path, a nested list item's leaf path — and its write
crosses the same shared inline-range commit, which routes the splice through the LEAF'S OWN
raw-write rule. That last part is what makes a table cell safe: a destination carrying a `|` would
otherwise cut the row in half, and the cell's rule escapes it in the same commit. Driven on
`/test/editor` via `?presentationMode=live` with real clicks, real typing and a real `Mod+Z`; the
SOURCE is the oracle.

## Happy paths

- a link inside a table cell opens the card carrying its destination, and Enter rewrites only that
  destination — the row's other bytes, its pipes and its alignment line are untouched
- a link inside a NESTED list item does the same through the container commit ceremony rather than
  the top-level one, and the item's indentation survives
- one `Mod+Z` puts either back, so a container commit is one undo entry like any other

## Edge cases

- a destination carrying a `|` is escaped by the cell's own raw-write rule on the way in, and the
  table still parses as one cell rather than splitting into two
- remove-link in a cell unwraps to the text the reader was already seeing and leaves the row whole

## User interactions

- Real clicks on the rendered link, real clicks into the card's field, real typing, real `Mod+Z`

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss analysis

The batch's first report claimed these paths DECLINED, on a reading of the code rather than a run:
the cell path resolves through `findCellPathForElement` and the container arm of the commit
primitive was already covered by unit tests, so the behavior worked the whole time and only the
documentation was wrong. The lesson is the standing one — a claim about behavior gets a run, not an
argument — and this file is the run.
