# Group 1: runtime checked

The words this catalog leans on, and what the enforcement levels mean, are in [the index](../invariants.md).

These checks run in three kinds of place:

- **The commit primitive**: `invariants/install.ts :: assertCommittedNodes`, invoked from
  `editor-actions/commit/undo-controller.ts` after each commit's raw rebuild. Anything shaped like
  "a committed node is coherent" runs here.
- **Bootstrap**: the registration-check flush (`schema/registration-checks.ts`), first at Editor
  mount via `runStartupInvariantChecks`, then at the next mount or grammar read
  (`getOrderedOpeners`), never mid-batch, so forward references inside one registration batch stay
  quiet. Registry completeness (G1.2) checks built-ins only, the one closed set of kinds.
- **Its own machinery**: the guard fires inside the code it protects. One exception: G1.33 fires in
  the editor root's focus handler (`components/editor-root/focus.ts`), above every caret entry, so a
  consumer's own caret component inherits it.

| ID     | What stays true                                                                               | Codes   |
| ------ | --------------------------------------------------------------------------------------------- | ------- |
| G1.1   | A strip container's raw and metadata never go stale against its children and bytes            | A·P·N·D |
| G1.2   | Every built-in block kind has a descriptor (its view moved up to G3.15)                       | A·P     |
| G1.3   | _Retired upward_: container-iff-rebuildRaw is now unrepresentable (G3.6)                      | T       |
| G1.4   | No container publishes the undo-history context key                                           | A·L·N   |
| G1.5   | Leaf fields on leaves, container fields on containers                                         | A·P·N   |
| G1.6   | `cloneMetadata` hands back a genuinely independent copy                                       | A·P     |
| G1.7   | Metadata writes that drive raw go through `updateBlockMetadata`                               | A·N     |
| G1.8   | `getContentRange` is well-formed for every kind that has one                                  | A·P·N   |
| G1.9   | No mutation writes bytes through a node an undo entry shares                                  | T·A·P·N |
| G1.10  | Opener priorities are unique (an opener's kind always has a descriptor now)                   | A·N     |
| G1.11  | Every keymap chord is unique per kind and names a known command                               | A·N     |
| G1.12  | An opaque container's raw still reparses to its live children and metadata                    | A·N     |
| G1.13  | An opaque `rebuildRaw` is deterministic over committed state                                  | A·N     |
| G1.14  | A container with a title row holds it at child 0; a `:::` row is the container's first line   | A·N     |
| G1.15  | A plugin opener claims at least one line, and its raw matches the lines it consumed           | A·N     |
| G1.16  | Every coordinate a commit declares is document-absolute                                       | A·N     |
| G1.17  | An opener registered after the grammar was read warns                                         | A·N     |
| G1.18  | A container's `reservedChrome` names a registered chrome kind                                 | A·N     |
| G1.19  | A commit scope's declared path still resolves to its captured node                            | A       |
| G1.20  | An unshared chain is as deep as the path it was asked for                                     | A       |
| G1.21  | A column edit's row scopes are the owned table's own children                                 | A       |
| G1.22  | Every index on an unshare path addresses a live child                                         | A       |
| G1.23  | Decoration sources never run mid-commit                                                       | A       |
| G1.24  | A kind's closure block agrees with the rest of its descriptor                                 | A·N     |
| G1.25  | Widget-pool acquires happen only inside an open render pass                                   | A·N     |
| G1.26  | A fold implies an active reveal, and an open reveal blocks command mutation                   | A·N     |
| G1.27  | `compositionend` lands only inside a composition the surface opened                           | A·N     |
| G1.28  | A code block's render and a painted leaf source carry the block's bytes exactly               | A·N     |
| G1.29  | A selection endpoint's offset means what its own block's coordinate space says                | A·N     |
| G1.30  | Every registered kind declares a `mergeRole` from the known set                               | A·N     |
| G1.31  | The inline-construct policy table is coherent and unambiguous                                 | A·N     |
| G1.32  | _Retired upward_: a content-start Backspace with no range no longer compiles (G3.10)          | T       |
| G1.33  | A block the caret is placed in paints at least one position a caret can land on               | A·N     |
| G1.34  | _Retired_: a split's landing reads the index `splitNode` returned (G4.43)                     | L       |
| G1.35  | A slot that holds exactly one node never takes bytes that reparse to several                  | A·N     |
| G1.36  | A structural change fits the arrays it syncs; ids stay in lockstep with children              | A·N     |
| G1.37  | _Retired upward_: a context-dependent kind with an opener no longer compiles (G3.10)          | T       |
| G1.38  | A spliced container raw equals what a full rebuild would write                                | A·P·N   |
| G1.39  | At most one caret the editor draws shows at a time                                            | L       |
| G1.40  | Every built-in kind declares its page role and its height estimate                            | A·N     |
| G1.41  | A structural edit keeps the final break as it was (a blank last line keeps its own)           | A·P·N   |
| G1.42  | A list item's checkbox and blocks are what its reload reads                                   | A·N     |
| G1.43  | Reading a commit's landing moves no caret                                                     | A·N     |
| G1.44  | The document holds a block, and a commit leaves no container it touched empty                 | A·N     |
| G1.45  | A caret landing's focus scrolls nothing                                                       | A·N     |
| G1.46  | A caret or range the editor puts down leaves no widget selected whole                         | A·N     |
| G1.47  | A windowed child measures into its own block list                                             | A·N     |
| G1.52  | The text `getSource()` serves for an unchanged content version is the document                | A·N     |
| G1.53  | _Retired_: a stale write is refused quietly at the write gate, with nothing left to assert    | none    |
| G1.54  | A commit's mutation leaves the tree's own top-level array as it found it                      | A·N     |
| G1.55  | A top-level block an edit wrote reads back, on its own, as the tree it holds                  | A·N     |
| G1.58  | An indent key over a range keeps every word it holds, in order                                | A·N     |
| G1.61  | A list move keeps the order its text reads in                                                 | A·P·N   |
| G1.71  | A command key over a range runs in the kind of block whose keymap claimed it                  | A·N     |
| G1.75  | No selection endpoint the editor writes sits after an empty block's placeholder `<br>`        | A·N     |
| G1.76  | The drawn caret sits on its caret until the caret moves                                       | A       |
| G1.77  | The mark hiding the browser's caret is on exactly the editable the drawn caret draws for      | A       |
| G1.87  | Nothing an editor started before it unmounted writes, reports or reads its tree after         | N       |
| G1.90  | A plugin component compiled against another Svelte runtime is named as such in dev            | N       |
| G1.91  | A live removal keeps the marks on the visible characters it keeps                             | P·N     |
| G1.94  | One editor per mount target: a second `createEditor` there before `destroy` warns in dev      | A       |
| G1.96  | A plugin's widget, decoration or row view mounts once, updates in place, is destroyed once    | N       |
| G1.97  | A value a Vue app holds in reactive state reaches the editor unwrapped                        | harness |
| G1.99  | A styled editor resolves the host colors, from the theme stylesheet or the page               | A       |
| G1.104 | A plugin registers only from its `definePlugin` setup                                         | N       |
| G1.106 | A range delete takes whole rows from a table it keeps an edge of                              | A·N     |
| G1.110 | A metadata write to a leaf is refused, since a leaf's metadata comes from its bytes           | A·N     |
| G1.112 | A content write inside a commit leaves its fix-up to the commit                               | A·N     |
| G1.113 | A list item's drawn marker is its own opening bytes                                           | A·P     |
| G1.115 | A caret restored inside a widget that can show its source opens the source at that byte       | A·N     |
| G1.116 | A stopped input recording holds no listener                                                   | A       |
| G1.117 | A write never splits a CRLF pair into a lone `\r` or a lone `\n`                              | A·N     |
| G1.118 | A list's marker-width counts are what a recount of its items gives                            | A·N     |
| G1.119 | No caret the editor writes sits between a CRLF pair's `\r` and `\n`                           | A·N     |
| G1.121 | A menu asked to close is gone a tick later                                                    | A·N     |
| G1.122 | A built-in metadata read names the kind the node is                                           | A·N     |
| G1.128 | A caret key a selected widget passes on leaves the widget first                               | A·N     |
| G1.131 | A landing in reading mode leaves no browser selection in the block it landed in               | A·N     |
| G1.132 | A Backspace or Delete at a caret the editor decides never reaches `input` undecided           | A·N     |
| G1.133 | Reading mode leaves one block in the tab order; anything else there is a control              | A·N     |
| G1.136 | A DOM block view that moves or hides the element it was given, or fills its text element      | A·N     |
| G1.138 | A commit never addresses a container state whose component has unmounted                      | A·N     |
| G1.139 | _Retired upward_: a fix-up's blank lines read back through G1.145                             | A·P·N   |
| G1.141 | Asking which line a caret at a soft wrap is on leaves the selection's focus where it was      | A·N     |
| G1.143 | A kind's write rule never deletes bytes outside the written span, but an emptied marker       | A·N     |
| G1.145 | The blocks a fix-up wrote read back as themselves, blank lines included                       | A·N     |
| G1.147 | A render-primary DOM view's rendered half sits in its element; its text comes in time         | A·N     |
| G1.149 | The editor fills a host with a height on every mount route, and grows in one without          | harness |
| G1.150 | A block repaints from its bytes after an input the tree took back                             | A·N     |
| G1.151 | A keystroke written in place leaves no node it wrote shared with an undo entry                | A·N     |
| G1.152 | _Retired_: its premise was wrong; a fold that keeps its index can still move the leaf's bytes | A       |
| G1.154 | A content write's fixed-up window holds the block it wrote                                    | A·N     |
| G1.155 | A block's write puts its caret inside the text it writes                                      | A·N     |
| G1.156 | An undo or redo leaves the document at its entry's bytes; nothing writes while it installs    | A·N     |
| G1.158 | A block a commit splices in holds no opener it wrote that a block below would close           | A·N     |

### The entries

**G1.1 · Container raw not stale.** A strip container's bytes reparse to one block whose stripped
inner bytes equal `serialize(children)`, with the metadata at every depth that reparse gives
(G1.12's compare, `metadata-parity.ts`); a key written through `updateBlockMetadata` for its own
sake fires. Keep it byte-level: a tree compare false-fires on every empty list item and trailing
blank `>`. Grids are exempt; opaque containers are G1.12's and G1.13's. `checkStaleRaw`
(`node-shape.ts`) · commit primitive · `stale-raw.test.ts`, `strip-stale-metadata.test.ts`.

**G1.2 · Registry completeness.** Every `BlockKind` resolves to a descriptor, the kinds enumerated
from the union-derived manifest (`core/nodes.ts :: BLOCK_KIND_TABLE`, `ALL_BLOCK_KINDS`). Predicate
`checkRegistryCompleteness` (`registry.ts`) · bootstrap · `registry.test.ts`.

**G1.4 · No container history context.** No container `setContext`s `HISTORY_KEY`. Predicate
`checkNoContainerHistoryKey` (`context-keys.ts`) · run in
`editor-actions/nested/nested-actions.ts :: setNestedActionsContexts` · `context-keys.test.ts`,
`lint/file-rules.test.ts`.

**G1.5 · Category and field legality.** Leaf fields appear only on leaves, container fields only on
containers, and a wrap-less container carries no `innerPrefix`. Predicate `checkCategoryFields`
(`node-shape.ts`) · commit primitive · `category-fields.test.ts`.

**G1.6 · Clone-safe metadata.** A kind's `cloneMetadata` returns a copy that's safe to mutate
independently, checked at both places a node is copied: `tree-operations/clone.ts :: cloneNode` and
`tree-operations/unshare.ts :: copyNode`. Predicate `checkCloneSafeMetadata` (`node-shape.ts`) ·
`clone-safe-metadata.test.ts`.

**G1.7 · Metadata writes route through `updateBlockMetadata`.** No predicate of its own; the rule is
enforced by routing. `editor-actions/block-edit-core.ts :: updateBlockMetadata` rebuilds raw after
the merge, and both factories delegate to the shared core, so metadata and bytes can't drift apart.
A leaf has no rebuild, so the core refuses it (G1.110). G1.1 is the runtime backstop for a bypass. Test `test/editor-actions/update-block-metadata.test.ts`.

**G1.8 · Well-formed content ranges.** `getContentRange` is well-formed for every kind that has one:
the prose kinds, plus any non-prose kind declaring its own (the directive leaf does), because the
range is consumed without asking `supportsInline` first. Predicate `checkContentRange`
(`descriptor.ts`) · commit primitive · `descriptor.test.ts`.

**G1.9 · Snapshot aliasing.** No mutation writes bytes through a node an undo or redo entry shares;
moving one within the live tree is fine. Readers and plugins hold bytes-readonly views (G3.8; G4.13
guards the casts), and a writer copies the path, then re-reads the copy through the `$state` tree
(`tree-operations/unshare.ts` header); the table rebuild alone writes a child's bytes, to a row the
edit already copied. Dev hashes every node's bytes. `checkSnapshotIntegrity` ·
`snapshot-integrity.test.ts`, `undo-restoration.property.test.ts`; a throwing commit is G2.17.

**G1.10 · Unique opener priorities.** No two openers share a priority: a tie still dispatches by
kind name, but it's almost always a mistake.
Predicate `checkOpenerRegistry` (`registry.ts`) · bootstrap · `opener-registry.test.ts`.

**G1.11 · Keymap coherence.** Every keymap chord names a known command id, and chords are unique
per kind. A malformed chord throws earlier, at `registerBlockKind` or `augmentBlockKind`, in every
build; the command check waits for bootstrap because a plugin can register its kind before the
command its keymap binds. Predicate `checkKeymapCoherence` (`registry.ts`) · bootstrap ·
`keymap-coherence.test.ts`.

**G1.12 · Opaque container raw not stale.** An opaque container's raw reparses to children that
byte-match the live ones (chrome compared by position for `reservedChrome` declarers), every
metadata key equal (`metadata-parity.ts`), so a rebuild that skips the re-read fires at the next
commit. Raw no longer reading as one block of its kind fires for a kind with an opener or directive,
and is skipped otherwise. `checkOpaqueStaleRaw` (`node-shape.ts`) · commit primitive ·
`opaque-contract.test.ts`, `opaque-stale-raw-directive.test.ts`, `opaque-stale-metadata.test.ts`.

**G1.13 · Opaque rebuild determinism.** `rebuildRaw` is deterministic over committed state, checked
probe-vs-probe: run it twice, require the same bytes. Predicate `checkOpaqueRebuildDeterminism`
(`node-shape.ts`) · commit primitive · `opaque-rebuild-determinism.test.ts`.

**G1.14 · Reserved-chrome slot.** A container with a title row holds a leaf of the row's kind at
child 0: the kind its `reservedChrome` declares, or `directiveOpenerLine` for a `:::` container,
whose row must also hold the container's first line byte for byte. Other kinds are exempt. Predicate `checkReservedChromeSlot`
(`node-shape.ts`) · commit primitive · `reserved-chrome-slot.test.ts`.

**G1.15 · Opener return trust.** A plugin opener claims at least one line (`consumed >= 1`). A
return claiming none is **declined in every build** (the line falls through to the next opener) and
warns `opener-advance`. The returned `node.raw` must byte-match the consumed lines, else
`opener-raw` warns, since serialize reads `raw` only and the drift breaks round-trip. Inline guards,
module-private to `core/parser.ts`, driven through `parse()` in
`test/core/parser-opener-guards.test.ts`.

**G1.16 · Commit paths are document-absolute** (`commit-path-dialect`). Every coordinate a commit
declares (`op.eventPath`, `snapshot.path`) resolves from the document root, prefix by prefix; the
final index may name the one-past-end insert slot (append-shaped ops). Predicate
`checkCommitPathAddressable` (`commit-paths.ts`) · commit primitive, before the mutation, via
`invariants/install.ts :: assertCommitPaths` · `commit-paths.test.ts`.

**G1.17 · No late opener.** A kind registered with an opener after the grammar was read warns:
parsed documents never re-parse, so the kind would miss every open document. Register before the
first editor mounts. Predicate `checkLateOpenerRegistration` (`registry.ts`) · bootstrap ·
`test/schema/registration-checks.test.ts`.

**G1.18 · Reserved-chrome coherence.** The chrome kind a container's `reservedChrome` names (its
title row) is registered, which `registerChromeLeaf` does, and a registered kind always carries its
view (G3.15, which retired this check's component half). The bootstrap counterpart to G1.14's
per-commit slot check. Predicate `checkReservedChromeCoherence`
(`registry.ts`) · bootstrap · `reserved-chrome-coherence.test.ts`,
`test/schema/registration-checks.test.ts`.

**G1.19 · Multi-scope commit path.** A scope's declared path still resolves to its captured node,
checked over all scopes _before_ any spine is copied, since a stale-but-in-range path would copy and
rebuild the wrong spine. Inline closure, watcher-netted. In `editor-actions/commit/structural-commit.ts`.

**G1.20 · Unshared-spine depth.** The chain the keystroke's in-place write copies is as deep as
the leaf path it was given; a short chain means the write would change a node it doesn't own, so it
writes nothing. Inline closure, watcher-netted. In `editor-actions/commit/leaf-commit.ts`.

**G1.21 · Column-scope alignment.** Each row scope in a column edit IS the corresponding child of
the owned table, so the id/ref sync lands on the rows the splice actually walked. Its tag is
`column-scope-alignment`. Inline closure, watcher-netted. In `editor-actions/table-context.ts`.

**G1.22 · Unshare path in range.** Every index on an unshare path addresses a live child; an
out-of-range index silently truncates the chain. Inline closure, watcher-netted. In
`tree-operations/unshare.ts :: ensureUnsharedPath`.

**G1.23 · No decoration sources mid-commit.** A decoration source running mid-commit would read a
half-written tree, so `notifyEdit` and `runAll` assert no commit is open, and a source handle's
`invalidate()` waits until the last one ends. The commit helper opens and closes the scope in
`src/lib/commit-scope.ts`. Inline closure, watcher-netted. In
`decorations/decoration-state.svelte.ts`.

**G1.24 · Closure-block coherence.** A kind's closure block (its answer to each editor system)
agrees with its descriptor: no `inherit-default` for a container's `roundTrip` (its `rebuildRaw` is
the round trip), a `not-mergeable` kind's `mergeBackspace` or a `reservedChrome` kind's `clipboard`,
and a cell claiming focus-then-delete needs `blockFocus: 'whole-block'`. A `conformanceFixture` must
parse to its kind, checked in the unit sweep since a `parse` import in the flush is a cycle.
`checkClosureCoherence` · bootstrap · `closure-coherence.test.ts`, `closure-fixtures.test.ts`.

**G1.25 · Widget-pool pass bracket.** Inline widgets (the rendered stand-ins for inline constructs)
are recycled through a pool, one bracket per render pass: every `acquire` sits inside an open
`beginPass`/`sweep` bracket, `beginPass` never opens over an unswept pass, and `sweep` never closes
one that isn't open. Outside a bracket, byte-identical duplicate widgets can't be told apart.
Predicate `checkPoolBracket` (`inline-transitions.ts`) · run in `components/blocks/widget-portal.ts` ·
`inline-transitions.test.ts`, `test/blocks/widget-portal-bracket.test.ts`.

**G1.26 · Reveal transition legality.** A reveal swaps an inline widget for its source; a close
swaps back. A close needs a reveal (`closeShownSource`): a fire is a caller that skipped its
pre-guard. A command can't mutate during one (`command-during-reveal`): a fire is a command path
that skipped the close. `startReveal` isn't re-entered in its own microtask, and the source length
holds at entry. A blur with no reveal or in a cross-block range is silent. `widget-interaction.ts`,
`inline-commands.ts`, `reveal-source.ts` · `widget-reveal-transitions.test.ts`.

**G1.27 · Composition window.** `compositionend` lands only inside a composition the surface
opened, at its start or, when a range across blocks was live at the start, at its first composed
character. An unpaired end means `compositionend` was wired without `compositionstart`, and every
composed keystroke committed mid-IME. Predicate `checkCompositionEndPaired`
(`inline-transitions.ts`) · run in `components/blocks/editable/editable-surface.ts :: onCompositionEnd` ·
`inline-transitions.test.ts`, `test/blocks/editable/editable-surface-composition.test.ts`.

**G1.28 · Rendered text fidelity.** A code block's rendered fragment carries its bytes exactly
(`textContent === trimTrailingLineEnding(raw)`), since `template.innerHTML` can drop a byte (U+0000,
say) the next keystroke reads back. A painted editable-leaf source, from any plugin, is held to the
same, since blur commits its `textContent`. `checkRenderedTextFidelity` · in `renderCodeBlock` and
`paintSource` · `render-fidelity.test.ts`, `editable-leaf-painted-fidelity.test.ts`.

**G1.29 · Selection endpoint coordinates.** An endpoint's offset is in its own block's space. On a
table it's a cell index flagged `cellCoordinate: true` at every point, corners too; readers trust
the flag, so a bare offset makes copy slice the table as text. A cell index on a cell-less block
fires; any other endpoint sits in its raw, at an end for a childless `whole-block` kind.
`clampCellIndex` clamps, and `countsCells` says which blocks count cells. `selection-endpoints.ts` ·
`enterCrossBlock`, `extendFocus` · `selection-endpoint-coordinates.test.ts`.

**G1.30 · Merge-role vocabulary.** Every registered kind declares a `mergeRole` from the known set;
an unknown role makes the merge dispatcher fall through silently on every gesture that reaches the
kind. Predicate `checkMergeRoleVocabulary` (`registry.ts`) · bootstrap · `category-fields.test.ts`.

**G1.31 · Inline-construct policy coherence.** Each policy row (how an inline kind splits, unwraps,
reveals) names a kind the inline vocabulary holds (a typo silently keeps the defaults), gives the
`close-and-reopen` split and the empty auto-unwrap only to a revealable kind, and claims a nesting
rank and command no other mark row does; a plugin row can't take a built-in command id. Checked at
mount, once the hooks load. `checkInlineConstructPolicy` · `runStartupInvariantChecks` ·
`inline-construct-policy-coherence.test.ts`, `inline-construct-policy.test.ts`.

**G1.33 · The caret can land.** In a mode that hides markers and edits (live, preview-inline), a
block holding the caret paints a spot the caret can land on; one that's all hidden markers takes the
next key between `display:none` spans, on either side. Built-ins hold by construction
(`docs/design/live-mode.md` § 4.1), so this catches a plugin drawing its own marker chrome. It fires
from the root's `focusin`, so a consumer's caret component is covered. `checkLandableCaret` ·
`editor-root/focus.ts` · `landable-caret.test.ts`, `landable-caret-doors.test.ts`.

**G1.35 · Single-node sink.** A slot that installs exactly one node never installs bytes that
reparse to several (bytes arriving plural are fine). Every join (Backspace, Delete, the list-item
merge) writes through `joinIntoLeaf`, which refuses a join whose bytes read as two blocks: nothing
changes, and the caret moves across the boundary instead. Predicate `checkSingleNodeSink`
(`single-node-sink.ts`) · `tree-operations/node-ops.ts :: mergedLeafFor` ·
`test/tree-operations/merge-multi-block-refusal.test.ts`.

**G1.36 · Structural-descriptor coherence.** A `StructuralChange` (a splice's record for the id and
ref arrays) fits its array, and a commit leaves one id and one `childSpans` pair per child at every
depth. It's checked where applied and where the commit publishes ids (a record can fit and name the
wrong window) and, over the whole document, at e2e teardown. `applyStructuralChangeToIdsRefs`,
`assertCommittedNodes` · `structural-descriptor.test.ts`, `child-spans.test.ts`,
`cross-block-delete-seam-fold.test.ts`, `child-id-parity.test.ts`.

**G1.38 · Faithful container splices** (`child-spans-faithful`). After every one-region splice, dev
re-derives the container raw on a scratch node and, on a difference, names the kind and refuses the
splice for the full rebuild. Code moving bytes beside the spliced child (a separator the fix-up
retires, a borrowed wrap slot) retires the spans itself in `schema/child-spans.ts`; this is the
backstop, and the only guard seeing a stale container raw between commits. `spliceIsFaithful` there
· `child-spans.test.ts`, `child-spans-settle.test.ts`, `child-spans.property.test.ts`.

**G1.39 · One synthetic caret.** Beside a non-editable inline widget and at a gap between blocks the
browser draws no caret, so the editor draws one, and at most one shows. That holds by construction:
the drawn caret is one element per editor that each paint moves into the host it draws in, so an
unmounting block takes nothing with it, and a paint reads a widget edge only through the focused
editable's owner, which an unmounted block can't be. `caret/drawn-caret.svelte.ts` · G4.141's and
G4.144's scans · `e2e/tests/blocks/image/caret-synthetic-indicator.spec.ts`.

**G1.40 · Built-in presentation facts** (`builtin-presentation-facts`). A plugin kind may leave
`pageRole` and `estimateHeight` out and take the defaults; a built-in must declare both, so nobody
gets the defaults without deciding to. Predicate `checkBuiltinPresentationFacts` (`registry.ts`) ·
bootstrap · `test/invariants/builtin-presentation-facts.test.ts`.

**G1.41 · The open last line** (`last-line-kept`). Only the document's last line may lack a line
ending, and a structural edit keeps that as it found it unless the new last line is blank. The check
fails an open file that gained a break on a text line, a closed one that lost it, and an unended
line above the last at any depth, reading "open" off the bytes. The commit owns the rule
(`fix-up/last-line.ts`); no edit writes the tail by hand (G4.258). `checkLastLineKept`
· `last-line-kept.test.ts`, `open-last-line.test.ts`, `open-last-line.property.test.ts`.

**G1.42 · A list item's checkbox and blocks say what its reload reads** (`task-marker-slot`). The
checkbox is item metadata, but a write changes the block behind it, so both must match a reload: a
heading behind a checkbox (`- [ ] # b` read plain) fails, and so does a plain item whose text now
opens `[ ] `. Write an item's first slot through `writeKeepingTaskMarker` (G4.82); a block replacing
a to-do's text gives the box up only where the bare bullet holds it (`landAtTaskStart`). An empty
item is G1.44's. `checkTaskMarkerSlot` · the commit · `task-marker-slot.test.ts`.

**G1.43 · A landing is a value** (`landing-is-a-value`). A commit's `landing` says where the caret
goes and places nothing; the commit puts the caret down after its tick through the one caret landing
(`selection/caret-landing.ts`). A landing read that moved focus or the selection fails here.
Predicate `invariants/landing-value.ts :: checkLandingIsAValue` · run by
`editor-actions/commit/undo-controller.ts` · `test/invariants/landing-value.test.ts`.

**G1.44 · The document keeps a block** (`keeps-a-block`). A structural commit never leaves the
document, or a container it touched, with no children, unless the kind holds none on purpose (a
diagram; `mustHoldChild`). The commit gives an emptied document one empty paragraph
(`keepOneBlock`), and an edit emptying a container removes it (`cascadeCleanupEmptyAncestors`,
`removeEmptiedContainer`), so this fires for a new route that skips both. `checkKeepsABlock` · both
commit branches in `undo-controller.ts` · `keeps-a-block.test.ts`, `document-keeps-a-block.test.ts`.

**G1.45 · A landing's focus scrolls nothing** (`landing-focus-scrolls-nothing`). The caret
landing's reveal is the one scroll a landing makes, through the scroll owner, so a focus call
without `preventScroll` that moved the scroll position fails here. Predicate
`invariants/landing-focus-scroll.ts :: checkLandingFocusScrollsNothing` · run by
`selection/caret-landing.ts` · `test/selection/caret-landing.test.ts`; G4.91 is the source half.

**G1.46 · A placed caret leaves no widget selected** (`placement-ends-widget`). Once a block's
`focus`, a range in one block or a restore puts its caret down, no inline widget is still selected
whole, or it would look selected while keys go to the caret. `placeCaret`, `selectInBlock` and
`applySelectionToDom` check it inside their batch. Predicate `checkPlacementEndsWidget` ·
`place-caret.ts`, `native-bridge.ts` · `placement-ends-widget.test.ts`; G4.94 is the source half.

**G1.47 · A child measures into its own list** (`measures-in-own-list`). Each block list gives its
direct children one measure channel, which they join through `useMeasuredChild` with their own path.
The channel refuses any other path: a list item calling the hook after providing its own inner list
would put its height in a table that doesn't index it. Predicate `isOwnChild` ·
`use-container-windowing.svelte.ts` · `measured-child-routes.svelte.test.ts`; G4.97 is the source
half.

**G1.52 · The cached text is the document** (`current-source`). `getSource()` serializes once per
content version, and a `source` prop write is compared with that string, so a write that skips the
version bump (G4.52) reports text the editor no longer holds. In dev the first reuse of a version's
text re-serializes and compares, except with the perf instruments armed and in the `source` swap
compare, which an echoing host hits every keystroke. `invariants/current-source.ts` ·
`commit/current-source.ts :: createCurrentSource` · `current-source.test.ts`.

**G1.54 · The tree's top-level array comes back untouched** (`top-level-untouched`). A commit with
the document among its scopes hands its mutation a copy of the top-level array and installs it at
publish, so a write to the tree's own array is thrown away; the commit fails when that array was
replaced or written (not with the perf instruments armed). Predicate `checkTopLevelUntouched` ·
`structural-commit.ts` · `top-level-untouched.test.ts`, `top-level-splice-writes.test.ts`.

**G1.55 · A written block reads back as itself** (`reads-back`). After a keystroke's rebuild and
every commit, dev reads each top-level block the edit names alone, as a file opens (`readAsOpened`,
so a bare `- ` keeps its empty paragraph), and compares kinds, child counts and metadata: a dropped
space that re-nests a list, a paragraph that reloads as a heading, or a container left with no bytes
fails. Skipped: a top-level keystroke (it takes the reparsed kind), a block over 16K characters,
perf-timed runs. `checkReadsBack` · `commit-frame.ts` · `reads-back.test.ts`.

**G1.58 · An indent key over a range keeps every word, in order** (`range-indent-keeps-text`). Tab,
Shift+Tab or a rebound indent key over a range moves list items, shifts code lines, or does what a
kind's `registerRangeIndent` says, and nothing else. After each press dev compares the spanned
blocks' leaf text (`leafTexts`, shared with G1.61), whitespace aside: a renumbered marker or an
added tab passes, a lost or moved word fails. `checkIndentKeepsText` · `range-indent.ts` ·
`range-indent-keeps-text.test.ts`.

**G1.61 · A list move keeps the order** (`list-move-keeps-order`). Every nest, lift, unwrap and
merge that moves blocks between list levels (Tab, Shift+Tab, Backspace at a sublist's start or on a
first item, Enter in an empty item) keeps the list's leaf text in order, read as G1.58 reads it. A
merge reads only the two lines it joins, since a live join can drop markers.
`checkListMoveKeepsOrder`, run by `keeping-order.ts` · `item-moves.ts`, `item-partition.ts` (G4.123), `unwrap-merge.ts` ·
`list-move-keeps-order.test.ts`, `indent-keeps-order.property.test.ts`.

**G1.71 · A command key over a range runs where it was claimed** (`command-key-landing`). Over a
range, a key is a command key when the keymap of the block the removal leaves the caret in binds it
(`selection/removal-landing.ts :: removalLanding` picks that block before anything moves), and after
the removal the command must run in a block of that kind (kinds only, since a join can move the
offset). Predicate `invariants/command-key-landing.ts :: checkCommandLanding` ·
`selection/cross-block/range-replace.ts` · `test/invariants/command-key-landing.test.ts`.

**G1.75 · The caret goes before an empty block's `<br>`** (`caret-before-break`). An empty editable
holds one `<br>`, and a caret looks the same on either side, but in Chromium a composition started
after it is dropped after its first update, losing or doubling the text. Every caret and range the
editor writes passes `browser/caret-writer.ts :: writeSelection`, which checks both ends in dev (G4.270
keeps every selection write there). `checkCaretBeforeBreak` · `caret-before-break.test.ts`.

**G1.76 · The drawn caret agrees** (`drawn-caret-agrees`). At a `selectionchange` with no paint
pending, a caret still where the last paint drew it must measure within a pixel of the bar. A fire
means something moved the caret's line without writing the caret: call
`EditorServices.drawnCaret.request()` where that happens. Skipped: a typed key, click or press (each
asks for a paint), a reflow, a code chip's stop. `checkDrawnCaretAgrees` · `drawn-caret.svelte.ts` ·
the e2e invariant watcher, `drawn-caret.spec.ts`.

**G1.77 · One caret showing** (`one-caret-showing`). After every paint, `data-caret-drawn` (which
hides the browser's caret) sits on exactly the editable the bar draws for, and none while it draws
nothing. A press whose click will move the caret (beside a widget, in a marker prefix) sets it
early, so the browser's caret doesn't flash. It's an attribute because Svelte rewrites an editable's
whole class list when its kind changes. Predicate `checkOneCaretShowing` · after each paint in
`drawn-caret.svelte.ts` · `drawn-caret.spec.ts` (`caretsShowing` in every row).

**G1.87 · Nothing outlives the unmount.** Unmounting ends the document in place, so a write still in
flight (an `insertMarkdown` awaiting a tick, a paste awaiting its clipboard) is refused quietly at
the write gate, like one for a swapped-out document. Events go quiet at once, and a caret landing
stops at its next await. Nothing is asserted, since unmounting mid-write is ordinary. `admitsWrite`,
`document-stamp.ts :: end`, `child-list.ts :: descendTo` · `destroy-mid-write.test.ts`,
`document-stamp.test.ts`, `child-list.test.ts`, `caret-landing.test.ts`.

**G1.90 · A foreign Svelte runtime is named.** A plugin component compiled against a second copy of
Svelte (a precompiled plugin on the prebuilt build, say) fails the moment the editor mounts it.
Every route mounting one (the block's error boundary, `mountPluginView`, the inline menu's row
boundary) asks `isForeignRuntimeError`, warns `foreign-runtime` in dev and names the cause in the
block's notice; G4.178 holds new routes to it. The match reads the message, so a plugin's own
`undefined.call` can match too. `foreign-runtime.test.ts` mounts on a second runtime.

**G1.91 · A live removal keeps the marks it keeps.** A live-mode delete, cut or typed-over range
that cuts a format run closes it before the cut and reopens it after, so each kept character keeps
its marks, checked against each side's render. Where no spelling can close the run (the closer would
touch a run of its own character), it drops the run and the text shows unmarked.
`live-join.ts :: cleanLiveJoinSeam` · `live-seam.property.test.ts`,
`live-gesture-fuzz.property.test.ts` (the drop held to a small share), `live-join.test.ts`.

**G1.94 · One editor per target.** A wrapper that skips `destroy` on unmount stacks a second editor
in the same element, and React's StrictMode (which mounts every component twice in dev) shows it at
once. `createEditor` remembers which targets hold an editor it hasn't destroyed and warns
`target-occupied` in dev on a second mount there. `editor-root/create-editor.test.ts`.

**G1.96 · One lifecycle for every plugin view.** Inline widgets, decoration widgets and badges, and
menu rows are each a `PluginView` mounted through `mountPluginView`: mounted once, updated through
`update`, destroyed once. A throw is reported once, the view is never called again, and the slot
draws its fallback. A pooled widget or badge that stays put mounts nothing new, and one showing its
source stays alive undrawn; a decoration widget is drawn afresh with its block, so a throwing one
reports per rebuild. `lifecycle.test.ts`, `failure.test.ts`; G4.186 holds routes to it.

**G1.97 · Vue hands over the real object.** A value a Vue app keeps in `ref` or `reactive` reaches a
component as a proxy, and the editor keeps a plugin by identity, so a proxied plugin would count as
a second plugin of the same name. The Vue wrapper's one options builder passes every option through
`toRaw`, each `plugins` entry and the plugin inside it too, since a plain list built from reactive
state still holds proxies. The adapter suite's `vue.spec.ts` mounts editors sharing a plugin out of
reactive state and fails on the `plugin-install` warning.

**G1.99 · The host colors resolve.** A host color read inside the editor carries no fallback
(G4.189), since `editor.css` resolves each to the page's value or the `editor-theme.css` palette, so
an app that forgets the theme stylesheet on a colorless page gets menus painted with none. A
mounting editor with its stylesheet applied checks that `--md-color-bg` resolves on its root, and
warns `invariant:host-colors-resolve`, naming the import, when it doesn't.
`invariants/theme-stylesheet.ts`; `e2e/tests/theme-stylesheet.spec.ts`.

**G1.104 · Registered from a setup.** A register or declare call outside a plugin's setup and the
editor's own `registerAsCore` bootstraps throws in a dev build, naming `definePlugin` and, for a
test on another runner, `configureEditorEnv({ isTest: true })`; test runs are exempt, production
unchecked. Every registry's store checks it (`rejectRegistrationOutsideSetup`). No key is exempt, so
the editor's load-time registrations run under `registerAsCore` too, and only those replace a
duplicate on a dev server. `register-in-setup.test.ts`, `dev-server-load.test.ts`.

**G1.106 · A kept table edge loses whole rows.** A selection that starts or ends inside a table
and runs past it deletes whole rows of that table, never part of one. `coverRange` in
`selection/range-coverage.ts` snaps both ends to a row's edge first. If a run that splits a row
still shows up (only an end that skipped the snap could hand one over), `rangeCoverage` warns
`invariant:kept-table-edge`. `test/selection/range-coverage.test.ts`.

**G1.110 · A leaf takes no metadata write.** A leaf's metadata is what its opener reads from its
bytes (a heading's level, a code block's language), so a metadata-only write is gone on reload.
`updateBlockMetadata` refuses any non-container before writing (no bytes, no undo entry, no edit
event); dev warns `invariant:metadata-without-rebuild` naming the kind, and every build reports an
`error` event (`origin: 'commit'`) pointing at `replaceRaw`, the bytes write to use instead.
`update-block-metadata.test.ts`.

**G1.112 · One fix-up per list.** A commit fixes up (`fixUpEdit`) each list it wrote once, so a
mutation writes with `writeNodeContent`, reports through its scope's `describeEdit`, and leaves the
fix-up to the commit; one using `updateNodeContent` and reporting there gets it twice, and dev warns
`invariant:settle-once`. Unseen: two edits calling a separator helper by hand (codebase-map § Blank
lines and separators). A scope's `writeLeaf` fixes up its slot as it lands and the commit the rest,
so the check skips its lists. `settle-once.test.ts`, `settle-passes.test.ts`.

**G1.113 · The marker is the item's bytes.** A list item draws its marker in a cell of its own,
built from its metadata, and source mode shows that cell as the item's first bytes, so its text must
be what the item's raw opens with, past up to three spaces of indent. A rewrite that moves the
metadata without the bytes would show a marker the file doesn't hold. The item checks each time it
builds the cell (`invariants/item-marker-bytes.ts`), and dev warns `invariant:item-marker-bytes`.
`test/invariants/item-marker-bytes.test.ts`, over generated documents too.

**G1.115 · A caret inside a source-showing widget stays put** (`widget-caret-landing`). An edit or
arrival putting the caret strictly inside a `revealSource` widget (a `#` typed before `few` makes a
tag of it) opens its source with the caret at that byte, or the next key types after the widget.
Both prose blocks place such a caret through `restoreCaret` (after an edit, via `parkCaret`, on
undo, redo or `setSelection`); a rebuild's carried caret predates the edit and opens nothing. One
off its byte must sit at a sourceless widget. `checkWidgetCaretLanding`; G4.211 covers every kind.

**G1.116 · A stopped recording listens to nothing** (`recorder-listener-after-stop`). An input
recording's listeners on the editor root and `document` all take one abort signal, which `stop()`
and the editor's teardown abort, so recording costs nothing once it ends. A listener added without
the signal would run after the stop; the recorder warns when one does. `debug/input-recorder.ts` ·
`input-recorder.test.ts`.

**G1.117 · A CRLF pair stays whole** (`line-ending-pairs`). WebKit and Firefox stop a caret between
a line's `\r` and `\n`. The DOM-to-raw read rounds a position inside a pair to before it
(`domTextOffsetAtNode`), the editor's delete takes a pair whole, and the read-back moves an edit
inside one before it (`keepLineEndingPairs`), as `canonicalizeCaret` does a caret. Any other write
(a tree op, a plugin rule) warns after its commit or in-place keystroke if a pair went while a lone
`\r` or `\n` came. `checkLineEndingPairsKept` · `line-ending-pairs.test.ts`.

**G1.118 · A list's marker counts match its items** (`list-marker-widths`). The list node counts the
items opening with a marker of each width, for the marker column (G4.215), and only the parse and
the list's rebuild write them. At G1.55's moments and size limit, dev recounts every list in the
blocks an edit wrote and fails absent or wrong counts, the trace of a route that changes items
without rebuilding the list. A failed commit restores them with its bytes
(`commit-rollback-bytes.test.ts`). `checkListMarkerWidths` · `list-marker-widths.test.ts`.

**G1.119 · No caret inside a CRLF pair** (`caret-in-line-ending-pair`). A caret written between
`\r` and `\n` would edit inside the pair in WebKit and Firefox, so every selection write checks both
endpoints. Arrows cross a pair in one press (`handleUnitStep`), and a Shift+Arrow moves an anchor
the browser parked inside one to before it (`extendSelectionToRaw`).
`checkCaretOutsideLineEndingPair` · `line-ending-pairs.test.ts`.

**G1.121 · A menu asked to close is gone** (`menu-closes`). Each menu closes through its own
callback, so one that ignores a cause (an Escape, a press outside) would stay on screen after the
editor closed it. A tick after the menu presence asks, dev checks the menu unmounted.
`checkMenuClosed` · `menu-presence.test.ts`.

**G1.122 · A metadata read names the node's kind** (`metadata-of-kind`). `metadataOf(node, kind)`
is for a caller that already knows the node is a `kind` (it checked, or found the node where only
that kind lives), and dev fails when it isn't. A node that might be something else, plugin
containers included, is read with `metadataIfKind`, which gives undefined there. That's what keeps
a container whose metadata has an `ordered` field from renumbering like a list.
`core/nodes.ts` · `plugin-metadata.test.ts`.

**G1.128 · A caret key on a selected widget leaves it** (`selected-widget-motion`). Selecting a
widget clears the browser's range, so a key that moves or extends the caret, passed on to the
shared keydown or the browser, needs a real selection first: a caret at the edge the key moves
toward, or for an extend the widget as a range anchored at its far edge. Dev fails a caret key the
widget's handler passed on with the widget still selected. `checkMotionLeftWidget` ·
`selected-widget-motion.test.ts`.

**G1.131 · A reading-mode landing leaves no caret** (`reading-landing-leaves-no-caret`). Reading
mode has no caret, so a landing there (a footnote jump, an outline entry, `navigateTo`) moves focus
to its target and clears the selection: Firefox starts Tab from a selection, the others from focus.
Dev fails a selection still in the landed block once the landing has scrolled (only that block, so a
click elsewhere mid-scroll passes).
`checkReadingLandingLeavesNoCaret` · `caret-landing.test.ts`, `reading-jump-focus.spec.ts`.

**G1.132 · The editor's delete runs, not the browser's** (`collapsed-delete-decided`). A collapsed
Backspace or Delete in any editable block is written by the editor at `beforeinput`
(`components/blocks/editable/collapsed-delete.ts`), so every engine takes the same bytes. Dev fails
the `input` after one unless its `beforeinput` was declined for a named reason (a composition, a
range, a soft keyboard's wider delete, a shown widget source).
`checkDeleteDecided` · `collapsed-delete.test.ts`.

**G1.133 · Reading mode has one block stop** (`reading-tab-stops`). In reading mode Tab is the
page's focus walk, so the editor keeps one block in it, the one whose own element last took focus
(`components/editor-root/reading-focus.svelte.ts`), and every other block's focus element sits at
-1. Dev fails a second element in the tab order that isn't a control (one left editable counts,
the host's header doesn't). The same check ships as `readingTabOrderProblem` for a plugin's tests.
`checkReadingTabStops` · `reading-focus.test.ts`, `reading-keyboard.spec.ts`.

**G1.136 · A DOM view fills the element it was given** (`dom-view-content`). A `defineBlockView`
view draws into a `div` under the block's host, which rects and the drag handle measure as the
block, so it stays the host's first content child and never turns `display: contents`. A leaf
view's text element sits inside it holding no element of its own. `blockContentElAt` hands every
caret route that text element and `blockBoxElAt` hands rects and scrolling the `div`, so chrome
beside the text moves no offset and no rect. `checkDomViewContent` · `block-view-leaf.test.ts`.

**G1.138 · A commit addresses live container states** (`block-list-state-mounted`). A container's
state leaves the registry when it unmounts, and a commit reaching an unmounted one uses its node's
ids (`scopeStateFor`). The check is for what the registry can't see: a state looked up before an
`await` and committed after its container unmounted, whose getters read the dead component's
props. `isUnmountedBlockListState` · `state-registry-lifetime.svelte.test.ts`,
`range-edit-unmounted-container.spec.ts`.

**G1.141 · Asking for the caret's line moves nothing** (`line-read-restores-focus`). At a soft wrap
the caret writer's `focusEndsLine` moves the focus to its line's end and back, which keeps the side
of the wrap the browser shows it on. Dev fails when the move back doesn't return the focus, since
the writer then puts it back by hand and loses that side. `checkLineReadRestored` · `line-read-restores.test.ts`,
`caret-line-at-wrap.spec.ts`.

**G1.143 · A kind's write rule never deletes bytes outside the written span**
(`write-rule-keeps-bytes`). A `rawWrite` may add bytes (a closer, a longer run), but every byte the
write shares with the block around the span stays, in order, so a broken fence opener keeps its
closer. One exception: a block the write emptied gives up its own marker, as a blank setext title
loses its underline. Dev checks every run through `kindWriteRule` (G4.245).
`checkWriteRuleKeepsBytes` · `node-primitives.ts` · `write-rule-keeps-bytes.test.ts`.

**G1.145 · A fixed-up window reads back as itself** (`settled-window-reads-back`). A window a
fix-up reports, with one block either side, reparsed as one stretch gives the same blocks and the
same hidden lines above each block of each blank run (a leaf's own trailing blank line counts as
one), so no fence keeps an old pairing and no separator sits on the wrong block. A list item, which
reads otherwise alone, is skipped; unseen: a body's lines beside its own fence lines.
`checkSettledWindowReadsBack` · `fix-up/apply.ts` · `settled-window-reads-back.test.ts`, `blank-run-layout.test.ts`.

**G1.147 · A render-primary view hands over both halves in time** (`render-primary-attach`). A
`defineBlockView({ surface: 'render-primary' })` view's rendered element sits inside the element
it was given, since that's where a click opens the text and a chord runs at the block. Its text
element arrives inside the `update` that reveals it. One that arrives later still gets the caret,
but only when it attaches, so dev warns. `checkRenderedInTarget`, `checkRevealAttached` ·
`DomBlockView.svelte` · `block-view-render-primary.test.ts`.

**G1.149 · The editor fills its host.** Every mount route (the Svelte component, `createEditor`, the
React and Vue wrappers) puts the editor root straight into an element the consumer owns, so the
root's own rule is the one place a host's height can reach it: `height: 100%` beside `flex: 1`, and
`height: auto` in host scroll mode. A sized host keeps the scroll and windowing inside it.
`Editor.svelte` · `e2e/tests/host-fill.spec.ts` (Svelte, `createEditor`),
`examples/adapter-suite/tests/host-fill.spec.ts` (every framework app).

**G1.150 · A rolled-back input repaints from the tree** (`repaint-reads-tree`). When an input the
browser already drew writes nothing (a keystroke the tree rolled back after a container's rebuild
threw), the block repaints from its bytes, and its element then reads back as those bytes, so the
drawn character is gone. `checkRepaintReadsTree` · `editable-surface.ts` ·
`keystroke-rollback.spec.ts`.

**G1.151 · A keystroke owns what it wrote** (`written-unshared`). After a keystroke written in
place, no node it wrote (the leaf and its ancestors) is still shared with an undo entry, since a
write through a shared node rewrites history (G1.9). It runs on every key, over the nodes that key
wrote; the whole-entry digest still runs at the next commit. `checkWrittenUnshared` · `leaf-commit.ts` ·
`keystroke-commit-frame.test.ts`.

**G1.154 · The caret's window holds the write** (`write-in-window`). When a content write's fix-up
reports a replaced window, that window holds the written block, since the caret is placed by
reading that window's blocks. A fix-up that moved no block reports no window at all.
`checkWriteInWindow` · `content-write.ts :: settledCaretPosition` ·
`structural-descriptor.test.ts`, `replacement-focus-target.test.ts`, the simulation.

**G1.155 · A write's caret sits in its text** (`caret-in-written-text`). Every write of a block's
text puts its caret between the text's start and its end, since the fix-up places that caret by
counting through the written block and on into the next. An input read that drops bytes the
browser left (a hidden `#` marker) moves the caret with them. `checkCaretInWrittenText` ·
`block-edit-core.ts :: contentUpdate` · `write-caret.test.ts`, `editable-surface-caret.test.ts`,
`atx-closing-run.spec.ts` on Firefox.

**G1.156 · An undo puts back its entry, nothing more** (`history-install`). Once an undo or redo
has installed its entry and placed the caret, the document's bytes are the entry's. A write in
between (a block tidying itself up as the caret leaves it) would be a new edit inside the undo, and
would clear the redo stack, so the write gate declines every write while the install runs.
`checkInstalledEntry` · `history.ts :: restore` · `history-install.test.ts`, the behavior rows.

**G1.158 · A spliced opener takes in no block below** (`spliced-opener-closed`). A block a commit
splices or moves in holds no opener it wrote (a `$$`, a `:::note`, a fence) that a block further
down would close, since that opener would read in blocks the edit never touched. Every write route
closes one first (`legalizeWrite`, `closeWrittenOpeners`); a content write and a removal aren't
asked, and a range delete's survivor lands outside a commit's list, where the route rows hold it.
`checkSplicedOpenersClosed` · `fix-up/apply.ts` · `written-opener-routes.test.ts`.
