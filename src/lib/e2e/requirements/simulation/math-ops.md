# Feature: Render-primary ops, math + mermaid (note-taking simulation)

Three loaded-ops sessions on the plugins route, over the render-primary blocks and
inline widgets the LaTeX and mermaid extensions add. Math is the first inline widget
with a nonzero interior (KaTeX renders real glyph text nodes) and the first
render-primary block; mermaid is the first opaque childless whole-block-focus
container; the ` ```math ` fence is a distinct kind built on the same render-primary
component. Their mounting and unmounting, and the swaps between the rendered view and
the source, are exactly the silent corruption the simulation's reference checks (the
structured-error and `[invariant:…]` console watcher, the live-CST round-trip, the
nested `BlockListState` audit) exist to catch. Every session runs all three again
after every move, with a fixed seed so runs repeat.

## Math session: happy paths

- inserting inline `$…$` at the caret in a prose block recognises and mounts the
  widget at render time; the host paragraph keeps the caret so editing continues
- clicking the rendered widget shows its editable source, an edit is typed in, and
  Enter re-renders KaTeX and saves the edit as one undo entry
- promoting an empty line to a `$$…$$` block focuses the new block, and clicking away
  collapses it to the rendered display
- editing the block through its revealed source and clicking away commits one undo
  entry; undo across the reveal then commit, and across the promotion, each restore
  the prior source

## Math session: caret-entry reveal (0.9.18)

- arrow-walking into a block-final inline widget from its trailing edge shows its
  source in place; walking out the leading edge collapses it back to the rendered
  widget. Entering and leaving without editing changes no bytes: the source is
  byte-identical after the round trip
- Backspace at the trailing edge of a reveal-capable widget opens the reveal
  rather than deleting the widget
- an edit typed into a revealed widget lives only in the DOM until it commits: the
  CST holds unchanged while the source is shown
- moving the caret out past the trailing edge commits that edit (the
  commit-on-escape path, distinct from the click-then-Enter-or-blur commit); the
  insert lands inside the fence, not as loose text after the widget
- deleting text on either side of a surviving widget round-trips, so a widget with a
  nonzero interior keeps its bytes; deleting the widget itself by extending the
  selection over it removes its bytes in one entry

## Mermaid session: whole-block focus (0.9.18)

- ArrowUp from the prose below the diagram stops on it (whole-block focus) without
  changing the source; ArrowDown steps back out below
- Enter while the diagram is focused inserts an empty paragraph below it, the one
  structural change the whole-block-focus model offers a childless container; one
  undo removes it and restores the byte-exact source
- Backspace at offset 0 in the block below the diagram focuses it without deleting
  (the two-step rule); a second Backspace deletes it in one commit; one undo
  restores the diagram byte-exactly

## Math-fence session: structural moves over an opaque leaf

- Alt+Arrow moving the prose above a ` ```math ` fence down past it and back leaves the
  fence's raw bytes and `mathFence` kind untouched at both positions, its render
  mounted, and the document byte-identical after the round trip. A reorder that
  rebuilt the fence as a plain `fencedCode`, or dropped a byte of the info string or
  body, fails loudly
- a cross-block range built from mid-prose above the fence to mid-prose below it holds
  the fence wholly interior; Backspace collapses it to exactly the head of the block
  above joined to the tail of the block below, byte for byte. A surviving fragment of
  the fence (a stray backtick, half an info string, a clipped formula) fails there,
  and that is the case worth catching, since a fragment reparses as another kind
- one undo restores the deleted fence byte-exactly and remounts its render

## Edge cases

- neither fence gesture ever focuses the fence: its render shows the source on
  pointerdown, so a gesture that clicked it would drive the reveal rather than the
  block. Both act from a prose block beside it, which is also how the two structural
  moves reach an opaque leaf in practice
- the fence is not authored by typing. A multi-line fence does not form from live
  single-block typing (the same constraint that sends directive-container inserts
  through paste), so it arrives by loading, as the mermaid diagram does
- every reveal or edit lands mid-block, not at the end-of-document append the
  expectation tracker predicts, so each automatic-behavior gesture waits for a widget,
  focus or structural signal it can observe and re-reads the state it actually got
- whether a widget is revealed cannot be predicted from the keystrokes: entry and
  collapse are points where the gesture re-reads the state rather than predicting it
- known-uncovered sub-case: Backspace-entry followed by further Backspaces eating
  source bytes in the DOM only, then Escape discarding them (the documented
  "backspace-backspace never changes `getSource()`" property). The committed-edit
  variant covers Backspace-entry, a DOM-only edit, and the commit; the eat-then-discard
  path is left for a later inline-widget simulation pass

## User interactions

- inline insert types `$…$` character-by-character and waits for the mounted widget;
  caret-entry uses real Arrow/Backspace presses against the widget edge
- rendered KaTeX is clicked at its painted `.katex-html` glyphs, not at the widget's
  center: the clipped `.katex-mathml` half turns a center click into a corner outside
  the hit-test
- the mermaid diagram is focused by a real click on its viewport or by arrow/
  Backspace entry from an adjacent block; delete and Enter use real key presses;
  undo uses the real cross-platform shortcut
- the fence's range is built by a real Shift+Click from the prose above to the prose
  below, and the reorder by real Alt+Arrow chords on the prose above; the reorder
  keeps its block focused, so the return press needs no second click

## Error cases

- no console, page, or structured editor error fires across any session,
  including the `[invariant:…]` channel
- the live serializer round-trips the current CST at every checkpoint
- the nested-state audit finds no `BlockListState` out of sync after any insert,
  reveal, edit, delete, promotion, focus, whole-block delete, or undo
