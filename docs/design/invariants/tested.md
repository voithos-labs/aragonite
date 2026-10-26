# Group 2: property and regression tested

The words this catalog leans on, and what the enforcement levels mean, are in [the index](../invariants.md).

No runtime check sees these; the test suite is the whole enforcement. Test files live under
`test/invariants/`, and the arbitraries they draw random documents from live in
`test/invariants/arbitraries/`.

| ID    | What stays true                                                              | Codes |
| ----- | ---------------------------------------------------------------------------- | ----- |
| G2.1  | Any string parses without throwing and serializes back to itself             | P·N   |
| G2.2  | The end-of-file edge states round-trip                                       | P·N   |
| G2.3  | The inline parser holds against its conformance corpus                       | P     |
| G2.4  | A rendered block's DOM text equals its ambient prefix plus its raw           | P     |
| G2.5  | The inline tree's offsets partition the block's raw                          | P·N   |
| G2.6  | Serialization ignores metadata and editor-level fields                       | P     |
| G2.7  | The range coverage partitions a selection cleanly, and the overlay reads it  | P     |
| G2.8  | Split and merge round-trip; ids, refs and children stay aligned              | P·N   |
| G2.9  | Paste emits its op kind by strategy, never by target depth                   | P     |
| G2.10 | Every keydown path hands its key to the caret memory's classifier            | P·A   |
| G2.11 | The inline scan covers every byte with known construct kinds, tiled          | P     |
| G2.12 | A caret placement ends every editor-owned selection, unless it's an extend   | L     |
| G2.13 | An edit leaves a tree whose serialization reparses to the same block shape   | P·N   |
| G2.14 | A format toggle applies exactly where the active-read says it isn't applied  | N     |
| G2.15 | A container rebuilt right after a parse writes back the bytes it read        | P·N   |
| G2.16 | A leaf written its own bytes changes nothing, and a keystroke moves one line | P·N   |
| G2.17 | A commit that throws leaves the document and the undo stacks as they were    | N     |

### The entries

**G2.1 · Round-trip and totality.** `serialize(parse(s)) === s` over piles of arbitrary strings, and
the parser absorbs any input without throwing. `round-trip.property.test.ts`.

**G2.2 · EOF edge states.** An unclosed fence and unterminated HTML round-trip too. Same file, its
G2.2 block.

**G2.3 · Inline conformance corpus.** The inline parser holds against the conformance corpus.
`core/inline/scan/emphasis-flanking.test.ts` and `emphasis-pairing.test.ts`.

**G2.4 · The textContent equation.** `textContent === ambientPrefix + raw` over rendered prose, the
trailing line ending excluded (`docs/design/inline-parsing.md` § The textContent invariant), run in
jsdom. `textcontent-spine.property.test.ts`.

**G2.5 · Inline offset partition.** The inline tree's offsets partition the block's raw.
`inline-offsets.property.test.ts`.

**G2.6 · Serialization purity.** Serialization ignores metadata and editor-level fields.
`serialization-purity.property.test.ts`.

**G2.7 · Selection partition.** Every block strictly between a range's endpoints sits in exactly one
subtree `rangeCoverage` holds whole, inside an endpoint's block, or is an ancestor of the end's
block, and the overlay's class for every block is the one that coverage gives it: a subtree the
range covers end to end paints one box, an endpoint's block included, and nothing under a box
paints. `walkBetween` visits the blocks in order. `selection-partition.property.test.ts`.

**G2.8 · Structural alignment.** Split and merge round-trip, and the id, ref and children arrays
stay aligned, in all scopes. `structural-id-ref-alignment.test.ts`.

**G2.9 · Paste op kinds.** Paste emits its op kind by strategy, never by target depth: the default
structural paste emits `replaceBlock`, container absorb and merge emit `paste`, and the cross-block
inline paste emits `updateContent`. A consumer counting pastes watches all three.
`paste-op-kind.test.ts`.

**G2.10 · Sticky-column keys.** The sticky column (the X position a vertical caret walk tries to
keep across shorter lines) is captured by a vertical arrow, kept through PageUp, PageDown and a
bare modifier, and dropped by any other key. Every keydown path hands its key to the caret
memory's `noteKey` rather than forgetting the memory outright: the behavior matrix plus the keydown
entry guard, run in jsdom. `sticky-column-matrix.test.ts`, `lint/caret-memory-keydown.test.ts`.

**G2.11 · Inline scan coverage.** The inline scan covers every byte, the constructs tile without
gaps, and every node's kind is in the vocabulary: the built-in kinds plus those an installed plugin
declared, so the property also runs with the bundled plugins' inline kinds registered.
`inline-total-coverage.property.test.ts`.

**G2.12 · Caret placement ends the editor's selection.** A placement that isn't an extend ends every
selection the editor owns (a cross-block range, a gap caret, a widget selected whole). The
programmatic route is `BlockComponent.focus`; `selection-claim-table.test.ts` runs every writer over
all three. The scan holds the rest: native placement (pointer entries declared per file), the park
verb's allowlisted callers, and the park verb on each leaf forwarding a shared caret entry point.
`lint/caret-gesture-range-reset.test.ts`; `range-interrupt-ops.spec.ts` uses real gestures.

**G2.13 · Shape fixed point.** An edit on a loaded document leaves a tree whose serialization
reparses to the same block shape and the same blank lines between blocks; G2.1 can't see a lost
block whose bytes were exact. Three lanes: the split, delete, merge, fill, empty, retype and update
gestures; inline-source paragraphs under the live split; and leaves blanked, filled and erased to
an empty last line inside fenced bodies. `shape-fixed-point.property.test.ts`,
`blank-runs.property.test.ts`, example cases in `parse-convergence.test.ts`.

**G2.14 · Toggle and active-read equivalence.** Over a RANGE, the toggle and `isInlineFormatActive`
agree: where the read says active the toggle unapplies, where it says inactive the toggle applies;
the cross-block toggle rests on it. The one branch outside it: where the delimiters paint, the bare
wrap writes unverified, on screen for the reader to fix (live-mode.md § 4.3). Every other branch
checks coverage, the split over every covering run of the kind. A collapsed caret is a different
set of rules entirely. `format-toggle-ladder.test.ts`.

**G2.15 · A container rebuild keeps its bytes.** Rebuild every container of a freshly parsed
document, innermost first, and the bytes come back, line endings included, so a first edit changes
only its lines. The generators spell tables, quotes and list items every way GFM reads alike
(padding, no edge pipes, escaped pipes, lazy lines, tabs, CRLF); a second property writes one cell
and checks only its row moved. `rebuild-keeps-bytes.property.test.ts`. The row writer reads cells as
the reader does (`cellText`); a dev check (`table-row-reads-back`) fails a fallback that misreads.

**G2.16 · An edit moves only its own lines.** Writing a leaf the bytes it already holds leaves the
document as it was, and one letter typed through the keystroke's route changes one line and leaves a
tree that reloads as itself. Both draw the blank-separated corpus and the respelled quotes and lists,
the keystroke the bundled alert and footnote too; a named row pins the retype of a tab-indented item
holding a table. The container kit holds a third-party `rebuildRaw` to the same rule.
`shape-fixed-point.property.test.ts`.

**G2.17 · A throwing commit changes nothing.** A commit mutation that throws publishes no partial
tree, leaves the undo and redo stacks as they were (`UndoManager.restoreStacks`), puts back each
scope's children, child ids and the bytes, metadata and list counts it saved, emits
`error{origin:'commit'}`, then re-throws in dev and swallows in production. A write deeper than a
scope's direct children stays written; only an internal bug reaches it.
`commit-rollback.test.ts`, `commit-rollback-bytes.test.ts`.
