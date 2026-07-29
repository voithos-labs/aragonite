# Feature: Range interrupt — select-all → gesture → keystroke (note-taking simulation)

The precondition no suite had ever built: a live cross-block range, an interrupting
gesture, then ONE printable key. Two whole-document losses hid behind exactly it — the
dead-space click and the render-primary reveal click each placed a caret while the
range stayed live, so the next key type-replaced everything the user could still see.
G2.12 pins the pointer perimeter by source inspection; this is the behavioral half,
and it reads none of that lint's tables, so a reshaping of the perimeter leaves these
probes standing.

Each gesture fires once here over a document shaped to reach it, so coverage never
depends on which seed drew what; the note sessions and the multi-seed fuzz add the
random dimension (`requirements/simulation/multi-seed.md`).

## The oracle

Two legal outcomes, and each gesture is pinned to exactly one:

- **range-replaced** — the gesture left the range live, so the key replaces exactly it:
  the pre-gesture source with the range's byte span spliced out and the key in its
  place.
- **gesture-landing** — the gesture ended the range, so the key lands where the gesture
  left it pointed: one character at the caret, or the whole block the gesture selected,
  or (for a reveal) nothing at all until the escape commits it.

The assertion is byte equality against the pinned one, never membership in the pair.
Membership is the trap this family exists to avoid: with the reset neutered, a
caret-placing gesture's corrupt output IS the other outcome, so an "either is fine"
oracle ships green for the exact bug. Reading the outcome back off the live
cross-block flag after the gesture is the same trap — the neutered path leaves that
flag true and self-confirms.

Two supporting checks bracket the byte oracle: the gesture itself must move no bytes
before the keystroke, and the pinned contract is asserted BEFORE the key so a failure
names the stranded range rather than only showing a wiped document.

## Gesture contracts

Each row states both predictions; the pinned one is in bold. The build is chosen per
gesture on purpose: a caret-pinned gesture prefers select-all, where the corruption is a
one-char document and maximally far from its prediction; a range-pinned gesture must use
a short two-leaf prose range, because there select-all's own prediction would BE the
one-char document and all discriminating power is lost. `escape` is the one caret-pinned
gesture on a prose range: it collapses to the range's anchor, and a select-all anchor is
byte 0 of the document, where the keystroke demotes the first block's kind and enters the
deferred lazy-continuation class (`docs/issues.md`) — a red for a reason this family is
not about.

| Gesture                  | Build       | If the range survived   | If the range ended                         |
| ------------------------ | ----------- | ----------------------- | ------------------------------------------ |
| `dead-space-below`       | select-all  | one-char document       | **key at the caret in the last block**     |
| `dead-space-margin`      | select-all  | one-char document       | **key at the caret at that line's end**    |
| `dead-space-below-table` | prose range | **range span replaced** | key at a caret in the table                |
| `image-click`            | select-all  | one-char document       | **the selected image block replaced**      |
| `drag-handle-press`      | prose range | **range span replaced** | key at the caret the press left            |
| `escape`                 | prose range | range span replaced     | **key at the range's anchor**              |
| `search-round-trip`      | prose range | **range span replaced** | key at the caret the close returned        |
| `inline-reveal-click`    | select-all  | one-char document       | **no byte moves until the escape commits** |
| `block-reveal-click`     | select-all  | one-char document       | **no byte moves until the blur commits**   |
| `toc-entry-click`        | select-all  | one-char document       | **key at the heading it navigated to**     |

Contracts come from observation of each gesture over a live range, not from the lint's
caret/non-caret classification — pinning to that would make this suite a mirror of the
thing it cross-checks. `dead-space-below-table` is today's decline (a table addresses
cells, not characters); teaching that click to land in a table flips its row to a caret
outcome, deliberately and in one line.

## Happy paths

- dead-space click below the last block: the range ends, the caret lands at the last
  block's end, and the key inserts there. Every other byte survives
- dead-space click in the right margin: same contract through the same handler, a
  different band
- Escape: collapses the range to its anchor and the key inserts there
- TOC entry click: the range ends, the caret lands at the target heading, and the key
  inserts there. The landing goes through `rects.navigateTo`, not through any pointer
  door, so it is outside the perimeter the caret-gesture lint can see
- inline reveal click: the range ends, the reveal opens, and the typed key is ephemeral
  DOM — the source holds byte-identical until the caret escapes the reveal, which
  commits it inside the formula
- render-primary block reveal click: the same, committed by a blur onto a sibling leaf
  rather than a caret escape. These are two different doors, and only this one owns the
  reset: an inline island sits inside a text block, so its click reaches the cross-block
  dispatcher that resets on the way past, while a render-primary block offers that
  dispatcher no source text to hit-test and so calls the preamble itself. The pair is
  what discriminates them — neutering the rendered view's reset reds this probe and
  leaves the inline one green, which is exactly the per-file "both doors" claim the
  caret-gesture lint makes. For this gesture the pre-keystroke contract check is the
  deterministic catch, because the open reveal swallows a printable key rather than
  letting it reach the cross-block destroy path

## Edge cases

- image widget click: the click selects the widget rather than placing a caret, and the
  key replaces exactly that block's bytes — its trailing newline is separator, not
  content, so the document's line structure survives
- reorder-grip press with no drag: the range is untouched, endpoints byte-identical, and
  the key replaces exactly the range
- find-bar round trip (open, query, navigate, close): focus leaves the editor for the
  input and comes back on Escape with the range still live, so the key replaces exactly
  the range. The one gesture in the family that takes the caret out of the editor
- dead-space click below a table: declines, so the range survives and the key replaces
  it — today's contract, pinned so the change that lands a caret there is deliberate
- a caret that lands inside a container addresses its leaf's raw, a space the top-level
  spans cannot convert; there the exact check is that the single-character insertion
  falls inside the top-level block the caret is in

## Error cases

- a gesture that moves bytes before the keystroke fails loud rather than being folded
  into the baseline
- a gesture pinned to a caret outcome that leaves the cross-block range live fails
  before the keystroke, naming the stranded range
- a gesture pinned to the range outcome whose endpoints moved fails the same way
- the top-level byte spans are checked against a reconstruction of the source, so an
  arithmetic drift fails loud instead of shifting every prediction by the same offset
- the structural sweep (container parity, nested state, round-trip, selection validity)
  and parse convergence hold after the keystroke
- no console, page, or structured editor error fires, including `[invariant:…]`

## User interactions

- ranges are built by real double Ctrl+A or a real Shift+Click between two top-level
  leaf blocks; the caret they escalate from is placed in a leaf, the one block with no
  render-primary source to reveal under it
- every gesture is a real mouse or keyboard action: clicks at computed dead-space
  points, a hover then press/release on the reorder grip, real chords for the find bar,
  a click on the painted KaTeX glyphs rather than the island center (a center click
  degenerates to a corner outside the hit-test)
- the keystroke is one printable letter chosen absent from the source, so its insertion
  index is unique and no check can latch onto a coincidence
- every probe closes with a real undo back to the pre-gesture source, so the family can
  ride a note session without breaking end-state equality

## Coverage

- every member of the gesture union has a probe: the probe table is keyed by the union,
  so a new gesture without one is a type error, and a runtime test pins the same fact
