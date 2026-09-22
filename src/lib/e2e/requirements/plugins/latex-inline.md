# Feature: Plugin Inline Math, Select → Reveal-Source Editing

Inline `$…$` math renders as a KaTeX widget the caret cannot enter. Focusing it, by clicking it
or by moving the caret sideways against its edge, shows the editable `$…$` source in place, so
the caret never sits in an invisible widget-selected state. The full set of caret-entry gestures
(arrow, backspace and delete, at both edges, inside a block and across blocks, plus the contrast
with an image, which selects) lives in `latex-inline-caret-entry.md`. The edit lives in DOM the
tree has not seen, with no commit per keystroke (design axis A2, "re-render on commit, not
keystroke"), and it re-renders when it commits, on blur or when the caret walks out of the
source. Enter is not a commit gesture: it is the block's split key, and the command dispatch
commits the shown source before splitting (`latex-inline-reveal-commands.md`). Escape discards
the edit and brings the rendered widget back. The caret lands in the source across that swap,
and at the math's trailing edge across the re-render on commit (flagship axis A1). IME
composition while the source is being edited is the spec's named highest risk, driven through
the suite's shared CDP driver so the events are the browser's own.

Seed (`?seed=math`): `Before $x^2$ after` in block [0], and a `Next` paragraph in [1] to blur
to. Seed (`?seed=math-multiline`): a paragraph two visual lines tall with the math on line 1 and
text lining up under it on line 2, to test where a click lands.

## Happy paths

- click the rendered math: the `$…$` source appears in place, the KaTeX widget is gone, and the
  serialized source is unchanged, since only what is shown has changed
- move the caret in from the left (Home, ArrowRight to the widget's leading edge, one more to
  enter it): the source appears in place at the leading edge, with no invisible select-then-Enter
  step, and a typed character lands before the opening `$`
- edit the shown source and walk the caret out of it (End): KaTeX re-renders and the edited
  `$…$` bytes are in the source, round-trip stable
- double-click the rendered math: the first click shows the source and the whole `$x^2$` token
  is selected, not the `$` the browser's own word rule would take

## Edge cases

- the caret lands where the click did, inside the delimiters
  (`latex-inline-click-caret.md` owns where it lands): a character typed after a click at the
  formula's tail continues the formula, neither at a block edge nor past the closer
- after the commit the caret sits at the math's trailing edge: a character typed then appears
  immediately after the re-rendered math, because the caret's own position as it leaves does not
  survive the commit but the widget's trailing edge does
- Escape after editing: the rendered widget comes back carrying the original source and the
  serialized source is byte-identical to the seed, so the edit is discarded
- double-click inside a source that is already open (`$alpha beta gamma$`): the word under the
  pointer is taken, not the whole token, because the whole-token rule belongs to the double-click
  that opened it
- a third click on the shown source: the block's own selection takes the paragraph, because the
  widget's gesture ends at the second click
- a selected range that holds the shown source inside it leaves the source shown: the caret has
  not left it, and hiding it would rebuild the block under the range
- click on real text on another visual line that lines up under the widget: the caret lands in
  that text and the widget stays rendered, because the hit test is a point inside a rect, both x
  and y, not x alone
- after a commit caused by blurring away, with focus moved to another block, the selection stays
  in the block that took focus: the math block just blurred does not pull the caret back
- a cross-block selection swept down from the caret in the shown source, with its anchor staying
  inside that source, survives a blur without closing it: the commit backs off on a cross-block
  selection rather than closing the widget out from under the anchor. The source block is one
  visual line, so the sweep is two Shift+ArrowDown presses, the first extending to the end of
  the line inside the block, which keeps the source shown, and the second crossing the boundary

## User interactions

- a real mouse click on the widget; real Home, End, ArrowRight, Escape and typing, with no
  programmatic selection or caret placement
- real CDP IME composition (a genuine compositionstart, update and compositionend) into the
  shown source commits nothing per keystroke; the composed math commits only when focus leaves
  the block

## Miss-analysis

- The double-click inside a source that is already open: the whole-token rule shipped with one
  scenario, the gesture that opens the source, so "any double-click while the source is open" and
  "the double-click that opened it" passed the same test. A rule stated over a gesture needs a
  scenario for that gesture repeated.

## Error cases

- the `[invariant:…]` console watcher stays silent across showing the source, editing, committing,
  canceling, and the IME path
