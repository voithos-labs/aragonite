# Feature: Render-primary ops — math + mermaid (note-taking simulation)

Three loaded-ops sessions on the plugins route, over the render-primary block and
inline-widget surfaces the LaTeX and mermaid extensions add. Math is the first
nonzero-interior inline widget (KaTeX renders real glyph text nodes) and the first
render-primary block; mermaid is the first opaque childless whole-block-focus
container; the ` ```math ` fence is a distinct kind riding the same render-primary
component. Their mount/unmount churn and reveal↔source swaps are exactly the
silent-corruption class the simulation's oracle stack — structured error +
`[invariant:…]` console watcher, live-CST round-trip, nested BlockListState audit —
exists to catch. Every session re-checks all three oracles after every move, with a
fixed seed for determinism.

## Math session — happy paths

- inserting inline `$…$` at the caret in a prose block recognises and mounts the
  widget at render time; the host paragraph keeps the caret so editing continues
- clicking the rendered widget reveals its editable source, an interior edit typed
  in, and Enter re-renders KaTeX and persists the edit as one undo entry
- promoting an empty line to a `$$…$$` block focuses the new block, and blurring
  folds it to the rendered display
- editing the block through its source reveal and blurring commits one undo entry;
  undo across the reveal→commit and the promotion each restore the prior source

## Math session — caret-entry reveal (0.9.18)

- arrow-walking into a block-final inline widget from its trailing edge opens the
  source reveal in place; walking out the leading edge folds it back to the
  rendered island. An unedited entry+fold changes no bytes — the source is
  byte-identical after the round trip
- Backspace at the trailing edge of a reveal-capable widget opens the reveal
  rather than deleting the widget
- an edit typed into a revealed widget is ephemeral DOM until commit — the CST
  source holds unchanged while the source is shown
- moving the caret out past the trailing edge commits the ephemeral edit (the
  commit-on-escape path, distinct from the click→Enter/blur commit); the insert
  lands inside the fence, not as loose text after the widget
- deleting text flanking a surviving widget round-trips (nonzero-interior byte
  survival); deleting the widget itself via atomic selection extension removes its
  bytes in one entry

## Mermaid session — whole-block focus (0.9.18)

- ArrowUp from the prose below the diagram stops on it (whole-block focus) without
  changing the source; ArrowDown steps back out below
- Enter while the diagram is focused inserts an empty paragraph below it — the one
  structural mutation the whole-block-focus model offers a childless container; one
  undo removes it and restores the byte-exact source
- Backspace at offset 0 in the block below the diagram focuses it without deleting
  (the two-step guard); a second Backspace deletes it in one commit; one undo
  restores the diagram byte-exactly

## Math-fence session — structural moves over an opaque leaf

- Alt+Arrow moving the prose above a ` ```math ` fence down past it and back leaves the
  fence's raw bytes and `mathFence` kind untouched at both positions, its render
  mounted, and the document byte-identical after the round trip. A permutation that
  rebuilt the fence as a plain `fencedCode` or dropped an info-string or body byte
  fails loud
- a cross-block range built from mid-prose above the fence to mid-prose below it holds
  the fence wholly interior; Backspace collapses it to exactly the head of the block
  above joined to the tail of the block below, byte for byte. A surviving fence
  FRAGMENT (a stray backtick, half an info string, a clipped formula) fails there, and
  it is the shape worth catching, since a fragment reparses as another kind
- one undo restores the deleted fence byte-exactly and remounts its render

## Edge cases

- neither fence gesture ever focuses the fence: its render reveals the source on
  pointerdown, so a gesture that clicked it would drive the reveal rather than the
  block. Both act from a flanking prose block, which is also how the two structural
  moves reach an opaque leaf in practice
- the fence is not authored by typing. A multi-line fence does not form from live
  single-block typing (the same constraint that routes directive-container inserts
  through paste), so it arrives by load, as the mermaid diagram does
- every reveal/edit lands mid-block, not the end-of-document append the expectation
  tracker predicts, so each auto-behavior gesture settles on an observable widget /
  focus / structural signal and resyncs from observed state
- the reveal state is not printable-predictable: entry and fold are auto-behavior
  resync points, never per-keystroke predictions
- known-uncovered sub-case: Backspace-entry followed by further Backspaces eating
  source bytes ephemerally then Escape-discarding (the documented
  "backspace-backspace never changes `getSource()`" property). The committed edit
  variant covers Backspace-entry + ephemeral edit + commit; the eat-then-discard
  path is left for a later inline-widget simulation pass

## User interactions

- inline insert types `$…$` character-by-character and gates on the mounted widget;
  caret-entry uses real Arrow/Backspace presses against the widget edge
- rendered KaTeX is clicked at its painted `.katex-html` glyphs, not the island
  center — the clipped `.katex-mathml` half degenerates a center click to a corner
  outside the hit-test
- the mermaid diagram is focused by a real click on its viewport or by arrow/
  Backspace entry from an adjacent block; delete and Enter use real key presses;
  undo uses the real cross-platform shortcut
- the fence's range is built by a real Shift+Click from the prose above to the prose
  below, and the reorder by real Alt+Arrow chords on the prose above; the reorder
  keeps its block focused, so the return press needs no second click

## Error cases

- no console, page, or structured editor error fires across any session,
  including the `[invariant:…]` channel
- the live serializer round-trips the current CST at every oracle checkpoint
- the nested-state audit finds no BlockListState desync after any insert, reveal,
  edit, delete, promotion, focus, whole-block delete, or undo
