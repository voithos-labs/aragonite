# Feature: Range interrupt, select-all → gesture → keystroke (note-taking simulation)

The setup no suite had ever built: a live cross-block range, an interrupting
gesture, then one printable key. Two whole-document losses hid behind exactly that:
the dead-space click and the render-primary reveal click each placed a caret while the
range stayed live, so the next key replaced everything the user could still see.
G2.12 checks the same pointer handlers by reading the source; this is the behavioral
half, and it reads none of that lint's tables, so reshaping those handlers leaves
these tests standing.

Each gesture fires once here over a document shaped to reach it, so coverage never
depends on which seed drew what; the note sessions and the multi-seed fuzz add the
random dimension (`requirements/simulation/multi-seed.md`).

## The reference check

Two legal outcomes, and each gesture is pinned to exactly one:

- **range-replaced**: the gesture left the range live, so the key replaces exactly it:
  the source from before the gesture with the range's byte span cut out and the key in
  its place.
- **gesture-landing**: the gesture ended the range, so the key lands where the gesture
  left it pointing: one character at the caret, or the whole block the gesture selected,
  or (for a reveal) nothing at all until the escape commits it, or (for a gap caret) a
  newly created paragraph at the boundary.

The assertion is byte equality against the pinned outcome, never that the result is one
of the two. Accepting either is the trap this family exists to avoid: with the reset
disabled, a caret-placing gesture's corrupt output is exactly the other outcome, so an
"either is fine" check ships green for the very bug. Reading the outcome back off the
live cross-block flag after the gesture is the same trap: the disabled path leaves that
flag true and confirms itself.

Two supporting checks bracket the byte comparison: the gesture itself must move no bytes
before the keystroke, and the pinned contract is asserted before the key, so a failure
names the stranded range rather than only showing a wiped document.

## Gesture contracts

Each row states both predictions; the pinned one is in bold. The build is chosen per
gesture on purpose: a caret-pinned gesture prefers select-all, where the corrupt result
is a one-character document and as far from its prediction as possible; a range-pinned
gesture must use a short two-leaf prose range, because there select-all's own prediction
would be that one-character document and nothing would tell the two apart. `escape` is
the one caret-pinned gesture on a prose range: it collapses to the range's anchor, and a
select-all anchor is byte 0 of the document, where the keystroke demotes the first
block's kind and runs into the deferred lazy-continuation case (issue #21), a failure
for a reason this family is not about.

| Gesture                | Build       | If the range survived   | If the range ended                         |
| ---------------------- | ----------- | ----------------------- | ------------------------------------------ |
| `dead-space-below`     | select-all  | one-char document       | **key at the caret in the last block**     |
| `dead-space-margin`    | select-all  | one-char document       | **key at the caret at that line's end**    |
| `place-caret-at-point` | select-all  | one-char document       | **key at the caret in the last block**     |
| `image-click`          | select-all  | one-char document       | **the selected image block replaced**      |
| `drag-handle-press`    | prose range | **range span replaced** | key at the caret the press left            |
| `escape`               | prose range | range span replaced     | **key at the range's anchor**              |
| `search-round-trip`    | prose range | **range span replaced** | key at the caret the close returned        |
| `inline-reveal-click`  | select-all  | one-char document       | **no byte moves until the escape commits** |
| `block-reveal-click`   | select-all  | one-char document       | **no byte moves until the blur commits**   |
| `toc-entry-click`      | select-all  | one-char document       | **key at the heading it navigated to**     |
| `gap-caret-click`      | select-all  | one-char document       | **a paragraph created at the boundary**    |

Contracts come from watching each gesture over a live range, not from the lint's
caret/non-caret classification: pinning to that would make this suite a mirror of the
thing it cross-checks.

`dead-space-below-table` is the row that retired at 0.10.3, and it is worth reading as the pattern. A table addresses cells rather than characters, so a click in the dead space beside or below it has no character position to land on; the editor now declines that click outright (it ends the range and focuses nothing), so the gesture has no landing to type at and no longer belongs to this family. The strip under the last block belongs to the trailing insert row, so every dead-space gesture here aims below it.

Its landing is the family's only caret inside a container. The prediction reaches it
because a grid's leaf bytes sit contiguously inside its ancestors' raw (a cell's raw
sits verbatim inside its row's, the row's inside the table's), which is exactly the
property a strip container lacks; the resolver reports null rather than guessing when
that does not hold.

`gap-caret-click` is the row whose landing is outside the selection types entirely. The
gap caret is not a `SelectionPoint`, so `getSelectionPaths` answers null while one is
live and the boundary is read off the gap check instead; a landing that is missing,
inside a container, or past the span table fails loudly rather than being predicted at.
The key does not enter a block there, it creates one, so the prediction is the key's own
line plus the blank line GFM requires between two blocks, inserted at the first byte of
the block the boundary precedes. The strips that route root-level clicks tile flush
against each other, so the editor's leading padding above a first block that declares a
gap is the one strip a pointer can reach that belongs to none of them, which makes the
document's start the only gap boundary this family arrives at by click.

## Happy paths

- dead-space click below the last block: the range ends, the caret lands at the last
  block's end, and the key inserts there. Every other byte survives
- dead-space click in the right margin: same contract through the same handler, a
  different strip
- `placeCaretAtPoint` with a point below the document: the consumer's entry point onto
  the same landing, reached with no click and no click target in front of it, so it
  must end the range by its own route
- Escape: collapses the range to its anchor and the key inserts there
- TOC entry click: the range ends, the caret lands at the target heading, and the key
  inserts there. The landing goes through `rects.navigateTo`, not through any pointer
  entry point, so it is outside the handlers the caret-gesture lint can see
- inline reveal click: the range ends, the reveal opens, and the typed key lives only
  in the DOM: the source holds byte-identical until the caret escapes the reveal, which
  commits it inside the formula
- gap-caret click above a leading table: the range ends, the caret rests at the
  document's own start boundary, and the key creates a paragraph carrying it there.
  Getting the third selection mode under the corruption checks at all is the point,
  because an insert at a boundary no editable area can reach is exactly where a
  separator bug would hide
- render-primary block reveal click: the same, committed by a blur onto a sibling leaf
  rather than a caret escape. These are two different entry points, and only this one
  owns the reset: an inline widget sits inside a text block, so its click reaches the
  cross-block dispatcher that resets on the way past, while a render-primary block
  offers that dispatcher no source text to hit-test and so runs the preamble itself.
  Having both is what tells them apart: disabling the rendered view's reset reds this
  test and leaves the inline one green, which is exactly the per-file claim about both
  entry points the caret-gesture lint makes. For this gesture the check before the
  keystroke is the reliable catch, because the open reveal swallows a printable key
  rather than letting it reach the cross-block destroy path

## Edge cases

- image widget click: the click selects the widget rather than placing a caret, and the
  key replaces exactly that block's bytes: its trailing newline is separator, not
  content, so the document's line structure survives
- a press on the drag handle with no drag: the range is untouched, endpoints
  byte-identical, and the key replaces exactly the range
- find-bar round trip (open, query, navigate, close): focus leaves the editor for the
  input and comes back on Escape with the range still live, so the key replaces exactly
  the range. The one gesture in the family that takes the caret out of the editor
- dead-space click below a table: declines, so the range survives and the key replaces
  it. That is the current contract, pinned so that the change which lands a caret there
  is deliberate
- a caret that lands inside a container addresses its leaf's raw, and a container's raw
  is not the concatenation of its children, so no offset conversion exists. Every gesture
  targets a top-level landing; one inside a container means a fixture moved under the
  test, and it fails loudly rather than being given a guessed prediction that would red
  on a correct editor
- the image gesture is offered only where an image is a block's entire content, because
  the whole-block replacement is what the editor does there; an image mid-prose needs a
  different prediction and is declined rather than guessed at

## Error cases

- a gesture that moves bytes before the keystroke fails loudly rather than being folded
  into the baseline
- a gesture pinned to a caret outcome that leaves the cross-block range live fails
  before the keystroke, naming the stranded range
- a gap-pinned gesture that left no gap caret, or left one inside a container or past
  the span table, fails before the keystroke rather than predicting against a boundary
  nothing sits at
- a gesture pinned to the range outcome whose endpoints moved fails the same way
- the top-level byte spans are checked against a reconstruction of the source, so an
  arithmetic drift fails loudly instead of shifting every prediction by the same offset
- the structural sweep (container parity, nested state, round-trip, selection validity)
  and the reparse comparison hold after the keystroke
- no console, page, or structured editor error fires, including `[invariant:…]`

## User interactions

- ranges are built by real double Ctrl+A or a real Shift+Click between two top-level
  leaf blocks; the caret they escalate from is placed in a leaf, the one block with no
  render-primary source to reveal under it
- every gesture is a real mouse or keyboard action: clicks at computed dead-space
  points, a hover then press and release on the drag handle, real chords for the find
  bar, a click on the painted KaTeX glyphs rather than the widget's center (a center
  click turns into a corner outside the hit-test). `place-caret-at-point` is the one
  exception, and not a shortcut: the public method is the entry point a host shell
  drives, so calling it is the real interaction
- the keystroke is one printable letter chosen absent from the source, so its insertion
  index is unique and no check can latch onto a coincidence
- every test closes with a real undo back to the pre-gesture source, so the family can
  run inside a note session without breaking end-state equality

## Coverage

- every member of the gesture union has a test: the table is keyed by the union,
  so a new gesture without one is a type error rather than a silent hole
- range endpoints and blur targets are chosen from prose leaves only. A render-primary
  leaf would reveal its source instead of anchoring a range (and would swallow the blur
  that is meant to commit an open reveal); a fenced leaf's markers would make the
  collapse something other than the byte splice the `range` prediction assumes
