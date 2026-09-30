# Feature: footnote references jump to their definition, and back

A `[^label]` reference points at its definition, and the definition's own `[^label]` marker
points back at the first reference that gave it its number. Both jumps go through
`rects.navigateTo`, so they mount a target that windowing had left out, scroll it into view, and
put the caret in it; neither writes a byte. Both use the link gesture: a plain click in reading
mode, where there is no caret to place, and Ctrl/Cmd+click in the editing modes. An unmodified
click therefore still means what it always meant, which is to show the `[^label]` source on a
reference and to put the caret in the body on a definition's marker. The way back lands
immediately after the first citation rather than at the start of the block holding it.

The document has a paragraph of references at block 0, deep filler, then the definitions far
below, so every jump crosses what is mounted and a stale target would visibly be unmounted.
(Looking a definition up and where the caret lands have unit tests in `definition-lookup`; this
file covers the gesture the user makes.)

## Happy paths

- **Reading mode, plain click:** clicking a reference mounts its definition and brings it into
  view, from a scroll position where the definition was not mounted
- **Editing mode, Ctrl+click:** the definition comes into view and the caret lands in its body,
  so the next keystroke edits the note rather than going nowhere on the reference
- **The way back:** Ctrl/Cmd+clicking the definition's `[^label]` marker brings the block
  holding the first reference into view and puts the caret immediately past that reference's
  closing bracket
- **The way back in reading mode:** a plain click on the marker brings the referencing block
  into view, where there is no caret to land

## Edge cases

- **A reference numbered by an earlier one:** the second reference jumps to its own definition,
  not to the first's
- **A definition nobody points at:** the marker takes the gesture and answers nothing: no jump,
  and the caret never leaves the orphaned note
- **A plain click on the marker in an editing mode:** the caret lands at the start of the body,
  the clamp the marker prefix has always applied, and nothing navigates
- **The pointer cue follows the mode:** the marker offers a pointer cursor only where a plain
  click acts, and switching mode at runtime moves the cue with it
- **A reference inside a table cell:** the cell is its own editable area, and the jump works
  from it exactly as it does from prose

## User interactions

- **A plain click in an editing mode still shows the source:** the reference's `[^label]` source
  opens for editing, exactly as it did before this feature, and nothing navigates
- **The jump does not open the source:** in a document short enough that nothing is left
  unmounted, a Ctrl+click leaves the reference rendered, since an editable area that opened its
  source under this gesture would unmount the widget mid-click
- **A reference with no definition ignores the gesture:** Ctrl+click neither navigates nor opens
  the source, because the widget takes the gesture whether or not it can answer it
- **Ctrl pressed after the click starts, before it is released:** the click carries the chord,
  so it navigates and nothing opens
- **Ctrl released before the click is released:** the click carries no chord, so it means what a
  plain click means: the source opens and nothing navigates
- **Double-click on a reference:** the first click opens the source and the second takes the
  whole `[^a]` token rather than the `[` the browser's own word rule would take
- **Double-click inside a source that is already open:** the whole-token rule belongs to the
  double-click that opened it, so a later one inside the open source takes the word under the
  pointer
- **The click that outlives its block:** the widget's handler runs first, so a jump can unmount
  the referencing block before the same click reaches that block's editable area; that area
  declines rather than clamping a caret and snapping to a widget edge for a block that is gone
- Every scenario names its presentation mode, so none of them depends on the harness default

## Error cases

- Every scenario asserts the editor's error channel stayed empty: a jump that landed on an
  unmounted block or a stale path would report there

## Miss-analysis

- The landing offset: every back-gesture scenario asserted the block the caret landed in and
  never the offset inside it, so offset 0 and the offset past the citation were the same
  assertion. A path with an offset is two facts, and asserting one of them tests half a landing.
- The double-click: every scenario that opened a source drove a single click, so the second
  click of a gesture that starts with one was never delivered. A gesture whose first event is
  another gesture needs its own scenario. The first fix for it then said "any double-click while
  the source is open" where it meant "the double-click that opened it", because the opening
  gesture was the only one written: a rule stated over a gesture needs a scenario for the same
  gesture repeated.
- The split gesture: every scenario drove the chord with `click({ modifiers })`, which holds one
  chord across the whole gesture and so cannot express a chord that changes mid-click. With the
  editable area reading the chord off the pointerdown and the widget off the click, the two
  disagreed and neither direction had a test. A gesture assembled from one call is a gesture
  whose parts were never varied on their own.
- The table cell: the widget's props reach it through a second editable area, and every scenario
  loaded prose. Forwarding through each editable area is a class of behavior, and the suite
  exercised one member of it.
- The click that outlived its block: five scenarios here drove it and all five passed, because
  the only thing it broke was a Svelte runtime warning no gate read. A channel nothing watches
  is a whole class of defect with no tests at all, whatever the scenarios say.
- Selecting the whole token keyed off where the selection sat, on the assumption that nothing
  between the second press and its click could move it. A root listener that selects the word
  under the second press did move it, and the rule excluded itself from the one gesture it
  exists for; it now keys off the click's point.
