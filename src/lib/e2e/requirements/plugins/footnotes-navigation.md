# Feature: footnote references jump to their definition, and back

A `[^label]` reference points at its definition, and the definition's own `[^label]`
marker points back at the first reference that minted its number. Both jumps ride
`rects.navigateTo`, so they reveal a windowed-out target, scroll it into view, and land
the caret in it; neither writes a byte. Both take the link gesture (plain click in
reading mode where there is no caret to place, Ctrl/Cmd+click in the editing modes), so
an unmodified click still means what it meant before: reveal the `[^label]` source on a
reference, seat the caret in the body on a definition's marker. The way back lands
immediately after the first citation, not at the referencing block's start.

Document: a paragraph of references at block 0, deep filler, then the definitions far
below, so every jump crosses the window and a stale target would be visibly unmounted.
(The definition-path and landing walks are unit-pinned in `definition-lookup`; this file
covers the user-facing gesture.)

## Happy paths

- **Reading mode, plain click:** clicking a reference mounts its definition and brings it
  into view, from a scroll position where the definition was windowed out
- **Editing mode, Ctrl+click:** the definition comes into view and the caret lands in its
  body, so the next keystroke edits the note rather than dying on the reference
- **The way back:** Ctrl/Cmd+clicking the definition's `[^label]` marker brings the block
  holding the first reference into view and lands the caret immediately past that
  reference's closing bracket
- **The way back in reading mode:** a plain click on the marker brings the referencing
  block into view, where there is no caret to land

## Edge cases

- **A reference numbered by an earlier one:** the second reference jumps to its own
  definition, not the first's
- **A definition nobody points at:** the marker takes the gesture and answers nothing:
  no jump, and the caret never leaves the orphan
- **A plain click on the marker in an editing mode:** the caret seats at the body's start,
  the clamp the ambient marker has always done, and nothing navigates
- **The pointer cue follows the mode:** the marker offers a pointer only where a plain click
  acts, and a runtime mode flip moves the cue with it
- **A reference inside a table cell:** the cell is its own editable surface, and the jump
  works from it exactly as it does from prose

## User interactions

- **Plain click in an editing mode still reveals:** the reference's `[^label]` source folds
  out for editing, exactly as before this feature, and no navigation happens
- **The jump does not reveal:** on a document short enough that nothing windows out, a
  Ctrl+click leaves the reference rendered — a surface that revealed under the gesture would
  unmount the widget mid-click
- **A reference with no definition ignores the gesture:** Ctrl+click neither navigates nor
  reveals the source — the widget claims the gesture whether or not it can answer it
- **Ctrl pressed after the press, before the release:** the click carries the chord, so it
  navigates and nothing reveals
- **Ctrl released before the release:** the click carries no chord, so it means what a
  plain click means: the source folds out and nothing navigates
- **Double-click on a reference:** the first click reveals the source and the second takes
  the whole `[^a]` token, not the `[` the browser's word rule would take on its own
- **Double-click inside an already-open reveal:** the whole-token rule belongs to the
  double-click that opened the reveal, so a later one in the revealed source takes the word
  under the pointer
- Every scenario names its presentation mode, so none of them rides the harness default

## Error cases

- Every scenario asserts the editor's error channel stayed empty: a jump that lands on an
  unmounted block or a stale path would surface there

## Miss-analysis

- The landing offset: every back-gesture scenario asserted the block the caret landed in and
  never the offset inside it, so offset 0 and the offset past the citation were the same
  assertion. A path with an offset is two facts; asserting one of them tests half a landing.
- The double-click: every reveal scenario drove a single click, so the second click of a
  gesture that opens with one was never delivered. A gesture whose first event is another
  gesture needs its own scenario. Its first fix then read "any double-click while a reveal is
  open" for "the double-click that opened it", because the only scenario written was the
  opening one: a rule stated over a gesture owes a scenario for the same gesture repeated.
- The split gesture: every scenario drove the chord with `click({ modifiers })`, which holds
  one chord across the whole gesture and so cannot express a chord that changes mid-press.
  With the surface reading the chord off the pointerdown and the widget off the click, the
  two disagreed and neither direction had a test. A gesture assembled from one call is a
  gesture whose parts were never varied independently.
- The table cell: the widget's props reach it through a second surface, and every scenario
  loaded prose. A per-surface forward is a class, and the suite exercised one member.
