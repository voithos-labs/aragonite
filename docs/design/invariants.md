# Editor invariants

Most rules in a codebase are preferences. A handful of the ones here will cost somebody their file,
and this doc is the list of that second kind.

Three examples. A container's raw never disagrees with its children. A block's DOM text equals its
ambient prefix plus its raw bytes. Every block kind has a descriptor. Break one of those and nothing
shouts at you. The damage shows up three layers downstream, in a component that did nothing wrong,
hours after the commit that caused it, and by then good luck.

So every rule of that kind gets a **G-number**, a place where it's checked, and something that fails
when it breaks. The aim is that a violation fails **loudly** (you see it) and **locally** (at the
code that broke it, not the poor code that noticed). It also matters more than it used to: the
plugin API freezes at 1.0, and other people's code is about to bind to these.

Before anything else, the words the catalog leans on, each glossed once here (if you know them, skip
ahead):

- **raw**: a node's verbatim source bytes, markers included.
- **kind**: the string on a node that says what block it is.
- **descriptor**: the per-kind metadata record: how the kind merges, edits, renders.
- **seam**: a boundary where responsibility passes from one piece of code to another.
- **opener**: the part of the parser that recognizes the syntax a block starts with.
- **chrome**: the parts of a block that are furniture rather than content (a title row, a table
  border).
- **ambient prefix**: the read-only marker a container lends its first child (a list's `- `).
- **scope**: one block list and its children; the unit of addressing and windowing.
- **path**: the child indices from the document root down to a block.
- **commit ceremony**: the fixed steps a commit always runs.
- **spine**: the chain of parents from the root down to the edited node.
- **settle**: the pass that re-derives the blank-line separators between blocks after a splice.

Everything rarer is glossed where it first shows up. The map:

- [The enforcement ladder](#the-enforcement-ladder): the three strengths a rule can be held at, and
  why prose is the last resort.
- [How a guard is built](#how-a-guard-is-built): one pure check shared by the running editor and the
  tests, what a fire looks like, and which test runs fail on one.
- [Adding a guard, retiring a guard](#adding-a-guard-retiring-a-guard): the procedure, numbers
  included.
- [Reading the catalog](#reading-the-catalog): the enforcement codes and where the files live.
- [Group 1: runtime checked](#group-1-runtime-checked): rules a dev build checks while the editor
  runs.
- [Group 2: property and regression tested](#group-2-property-and-regression-tested): rules only the
  test suite checks.
- [Group 3: compile time](#group-3-compile-time): rules the compiler enforces; the violation doesn't
  build.
- [Group 4: source scans](#group-4-source-scans): rules enforced by reading the source text itself.
- [Accessibility](#accessibility): the WCAG target and the gate that holds it.

## The enforcement ladder

**Unrepresentable > guarded > documented.** Every contract climbs as high as it can:

| Rung                | Means                                              | You'll find it in               |
| ------------------- | -------------------------------------------------- | ------------------------------- |
| **Unrepresentable** | The compiler rejects the violation. Nothing to run | Group 3                         |
| **Guarded**         | A check fires at the seam, in dev or in CI         | Groups 1, 2, 4                  |
| **Documented**      | Prose plus per-instance regression tests           | The `D` code (rare, on purpose) |

Prose is the bottom rung, and it's the last resort. Whenever you touch a rule, ask whether it can
climb one.

## How a guard is built

One predicate, two consumers. The check is written once, as a pure function, and the running editor
and the test suite both call that same function, so the logic never exists twice:

```
              ┌──────────────────────────────┐
              │  predicate                   │   pure, no side effects:
              │  src/lib/invariants/*.ts     │   node → violation | null
              └──────────────┬───────────────┘
                  ┌──────────┴──────────┐
                  ▼                     ▼
        runtime DEV assertion      property / negative test
        at the breaking seam       (imports the predicate directly)
```

### How a guard fires

Here's the whole shape on G1.1, the check that a container's raw still agrees with its children:

```ts
// src/lib/invariants/node-shape.ts: pure, node in, violation or null out
export function checkStaleRaw(node: CstNode): InvariantViolation | null {
	if (getBlockKindDescriptor(node.kind).containerContract !== 'strip') return null;
	const correspondent = soleCorrespondent(parse(node.raw, { scope: 'document' }).children, node);
	if (!rawFaithful(correspondent, node)) {
		return {
			code: 'stale-container-raw',
			message: `${node.kind} raw is stale relative to its children`,
			detail: { kind: node.kind, raw: clampForDetail(node.raw) }
		};
	}
	return null;
}

// src/lib/invariants/install.ts: the runtime consumer, run after every commit's raw rebuild
assertInvariant('stale-raw', () => checkStaleRaw(node));

// src/lib/test/invariants/stale-raw.test.ts: the test consumer, importing the predicate directly
expect(checkStaleRaw(parse('> hello\n> world\n').children[0])).toBeNull();
```

A violation is `{ code, message, detail? }` (`InvariantViolation`, in `src/lib/assert.ts`). When one
comes back, the runtime side prints it as one tagged console warning, tag first:

```
[aragonite:invariant:stale-raw] blockquote raw is stale relative to its children {kind: 'blockquote', raw: '> hello\n'}
```

`assertInvariant` lives in `src/lib/assert.ts`, beside `dev-warn.ts`, a dependency-free leaf every
subsystem can import (`invariants/` included). It's dev-only and it **never throws**, because a
false positive mustn't crash a real editor. In production it returns before even calling the
predicate, so the whole thing tree-shakes to nothing and costs zero shipped bytes. The per-commit
checks are scoped to the nodes a commit touched, never the whole document, which is what keeps them
safe inside the large-document workflow the project targets.

That `[aragonite:invariant:<tag>]` string is what every gate watches, and
`docs/contributing/warnings.md` § What fails on what lists the watchers and what each one reds. One
of them gets a name here: the shared e2e `test` fixture (`src/lib/e2e/fixtures.ts`), which fails any
spec whose page emits a fire, is the **e2e invariant watcher** the entries below lean on. A spec
whose whole subject is a fire declares it by tag (`test.use({ expectInvariants: [tag] })`), and the
declaration cuts both ways: the named fire must arrive, or the spec fails on that instead. No
`invariant:` fire may be waived run-wide; a test that provokes one claims it locally, and
`docs/contributing/warnings.md` § Claiming a fire in a unit test is the ladder.

### Where the shape doesn't hold, and why

A minority of runtime guards are inline closures at their own seam rather than shared predicates:
G1.15, the five commit-and-parse guards G1.19 through G1.23, and the interaction halves of G1.26.
What they check isn't a CST node's shape but a transient value the machinery builds mid-flight (a
prepared commit scope, an unshare chain, an owned table view, an in-flight reveal). Those exist only
mid-commit, mid-parse or mid-gesture. There's no stable object to hand a pure predicate, and no way
for a test to reconstruct the exact state on its own.

So they're guarded through the machinery that produces them, or through the console channel above,
which every e2e spec fails on (for G1.19 through G1.23 that channel is the whole net). G1.15's tests
drive the real `parse()` into the illegal returns. G1.26's settle-window half is driven through the
real interaction factory; its fold-without-reveal and mutation-with-reveal halves have no
test-reachable driver and are netted by the e2e invariant watcher, where the mutation half was
confirmed to actually fire (bypassing the fold in `runCommand` reds the reveal-command specs on
`command-during-reveal`). And `column-scope-alignment` (G1.21's tag) is the reason the watcher
exists at all. Before it, that guard was observable by no gate.

The rule of thumb: **if a test can construct the subject, the predicate is shared.** If only the
machinery can, the guard lives where the machinery is.

## Adding a guard, retiring a guard

The catalog is a convention anyone extends, so here's the whole procedure:

1. Ask which rung the contract can sit on. If a type can make the violation impossible, write the
   type and claim a Group 3 number; the runtime check you didn't have to write is the best kind
   (G1.3 died this way, happily).
2. Otherwise pick the group by where the check can run: Group 1 if a runtime seam sees the
   violation, Group 2 if only a test can, Group 4 if the rule is a pattern in the source text. A
   Group 4 scan lands in `test/invariants/lint/`, or in `e2e/lint/` if it scans the e2e tree.
3. Claim the next free number in that group. Numbers are never reused, so an old citation in git
   history keeps meaning what it meant.
4. If a test can construct the subject, write the predicate in `src/lib/invariants/` (pure: node in,
   violation or null out, the `checkStaleRaw` shape above) and wire both consumers: the DEV
   assertion at the breaking seam through `assertInvariant`, and a property or negative test in
   `src/lib/test/invariants/` that imports the predicate directly. If only the machinery can
   construct the subject, write the guard inline at its seam and let the e2e invariant watcher net
   it.
5. Add the row to the group's index table and the entry below it. The row is one line a person can
   read cold; the entry carries the seam, the predicate, the tests, and whatever nuance will bite
   the next person.
6. Cite the G-number from the guard and its tests, so a grep for the id lands here and at the code
   in one pass.

Retiring one: G1.3 is the pattern. When a stronger rung makes a check redundant, delete the guard
and its tests, and keep the number. The row stays, marked retired, saying what superseded it.

## Reading the catalog

Enforcement codes, used in every index table: `A` runtime DEV assertion · `P` property test
(fast-check) · `N` negative fixture · `T` compile-time type guard · `L` lint/source-scan · `D` doc.

Predicates live in `src/lib/invariants/`; property tests and their arbitraries (the random-CST
generators fast-check draws from) in `src/lib/test/invariants/`, run by
`npm run test:editor:invariants`. A path below is relative to `src/lib/` unless it starts with
`src/`, `docs/` or `scripts/`. The catalog references files, never line numbers. Everything below
has landed; nothing is aspirational.

One standing rule about the predicate directory: the Group 2 predicates are test-only and never
exported through `src/lib/index.ts`. The checkable rule underneath is the real one: **no
`invariants/` module takes a runtime dependency on `selection/`**. (The barrel already reaches
`selection/` transitively through the component tree, so "exporting them would add the edge" was
never the reason; keeping the predicate directory off the selection model is.)

Each group below is a short index table, then one prose entry per id. The row tells you whether you
care, and the entry tells you everything the row compressed.

## Group 1: runtime checked

Three families of seam run these checks:

- **The commit primitive**: `invariants/install.ts :: assertCommittedNodes`, invoked from
  `editor-actions/commit/undo-controller.ts` after each commit's raw rebuild. Anything shaped like
  "a committed node is coherent" runs here.
- **Bootstrap**: the registration-check flush (`schema/registration-checks.ts`). The first flush, at
  Editor mount via `runStartupInvariantChecks`, sweeps the live registry (built-ins plus any plugin
  kind registered pre-mount) for the descriptor-bearing checks (keymap, reservedChrome); registry
  completeness stays built-in-scoped, since a plugin kind's component may register on its own
  schedule. Later registrations are validated at the next mount or grammar read
  (`getOrderedOpeners`), never mid-registration-batch, so forward references inside one batch stay
  warn-free.
- **Own seam**: the guard fires inside the machinery it protects. One deliberate exception: the
  landable-caret guard (G1.33) fires at the editor root's focus seam, above every caret entry it
  guards, which is what lets a consumer's own caret component inherit it.

| ID    | What stays true                                                                     | Codes   |
| ----- | ----------------------------------------------------------------------------------- | ------- |
| G1.1  | A container's raw never goes stale: `strip(raw) === serialize(children)`            | A·P·N·D |
| G1.2  | Every block kind has a descriptor and a component                                   | A·P     |
| G1.3  | _Retired upward_: container-iff-rebuildRaw is now unrepresentable                   | T       |
| G1.4  | No container publishes the undo-history context key                                 | A·L·N   |
| G1.5  | Leaf fields on leaves, container fields on containers                               | A·P·N   |
| G1.6  | `cloneMetadata` hands back a genuinely independent copy                             | A·P     |
| G1.7  | Metadata writes that drive raw go through `updateBlockMetadata`                     | A·N     |
| G1.8  | `getContentRange` is well-formed for every kind that has one                        | A·P·N   |
| G1.9  | No mutation writes bytes through a node an undo entry shares                        | T·A·P·N |
| G1.10 | Every opener's kind has a descriptor; opener priorities are unique                  | A·N     |
| G1.11 | Every keymap chord is well-formed, unique per kind, and names a known command       | A·N     |
| G1.12 | An opaque container's raw still reparses to its live children                       | A·N     |
| G1.13 | An opaque `rebuildRaw` is deterministic over committed state                        | A·N     |
| G1.14 | A container declaring `reservedChrome` holds its chrome leaf at child 0             | A·N     |
| G1.15 | A plugin opener claims at least one line, and its raw matches the lines it consumed | A·N     |
| G1.16 | Every coordinate a commit declares is document-absolute                             | A·N     |
| G1.17 | An opener registered after the grammar was read warns                               | A·N     |
| G1.18 | A `reservedChrome` declarer is a container with a fully registered chrome kind      | A·N     |
| G1.19 | A commit scope's declared path still resolves to its captured node                  | A       |
| G1.20 | An unshared chain is as deep as the path it was asked for                           | A       |
| G1.21 | A column edit's row scopes are the owned table's own children                       | A       |
| G1.22 | Every index on an unshare path addresses a live child                               | A       |
| G1.23 | Decoration sources never run mid-commit                                             | A       |
| G1.24 | A kind's closure block agrees with the rest of its descriptor                       | A·N     |
| G1.25 | Widget-pool acquires happen only inside an open render pass                         | A·N     |
| G1.26 | A fold implies an active reveal, and an open reveal blocks command mutation         | A·N     |
| G1.27 | `compositionend` lands only inside a composition the surface saw start              | A·N     |
| G1.28 | A code block's rendered text carries the block's bytes exactly                      | A·N     |
| G1.29 | A cross-block endpoint's offset means what its own block's coordinate space says    | A·N     |
| G1.30 | Every registered kind declares a `mergeRole` from the known set                     | A·N     |
| G1.31 | The inline-construct policy table is coherent and unambiguous                       | A·N     |
| G1.32 | A kind declaring `contentStartBackspace` also declares `getContentRange`            | A·N     |
| G1.33 | A block the caret is seated into paints at least one landable position              | A·N     |
| G1.34 | A split's caret lands on the index `splitNode` returned                             | A·N     |
| G1.35 | A slot that holds exactly one node never takes bytes that reparse to several        | A·N     |
| G1.36 | A structural change fits the arrays it syncs; ids stay in lockstep with children    | A·N     |
| G1.37 | No descriptor declares field pairs that cannot mean anything together               | A·N     |
| G1.38 | A spliced container raw equals what a full rebuild would write                      | A·N     |

### The entries

**G1.1 · Container raw not stale.** The check is byte-level, on purpose: `strip(raw)` (the re-parsed
correspondent's stripped-inner bytes) compared against `serialize(children)`, exactly the documented
invariant. It deliberately doesn't compare the re-parsed tree to `node.children` structurally. An
empty editable container holds a single empty-paragraph placeholder so it has a focusable leaf,
which the parser instead emits as `innerSuffix`/trivia for byte-identical output (`- \n`, a trailing
blank `>` line), and both forms satisfy the invariant. Don't re-tighten it to a structural tree
compare; it false-fires on every empty list item and every trailing blank quoted line, and that
false positive went unseen until the simulation was wired to the invariant channel. What the check
does require is that the reparse comes back as a SINGLE block (for `listItem`, a wrapping list
holding it alone), which a structural compare isn't: bytes belonging to a following sibling leave
the first block's inner content intact, so without the single-block rule a container whose raw has
grown reads as faithful. Non-strip containers are exempt, grid outright and opaque via G1.12 and
G1.13. Predicate `checkStaleRaw` (`node-shape.ts`) · commit primitive · `stale-raw.test.ts`.

**G1.2 · Registry completeness.** Every `BlockKind` resolves to a descriptor and a component, the
kinds enumerated from the union-derived manifest (`core/nodes.ts :: BLOCK_KIND_TABLE`,
`ALL_BLOCK_KINDS`). One exemption, `listItem`: it has no component-registry entry by design (items
render inside their parent `ListBlock`, never via a `BlockHost` kind lookup), so the predicate skips
the component check for it (`NO_STANDALONE_COMPONENT`), which keeps the bootstrap channel free of a
benign per-mount warning; the `BlockHost` visible-raw fallback still covers any stray lookup.
`tableRow` and `tableCell` are registered as raw-block fallbacks, so `listItem` is the sole
exemption. Predicate `checkRegistryCompleteness` (`registry.ts`) · bootstrap · `registry.test.ts`.

**G1.3 · Retired upward.** The rule was: `isContainer` iff `rebuildRaw`. The grouped registration
shape (G3.6) derives `isContainer` from the `container` group, whose `rebuildRaw` is required, so
the pairing violation became unrepresentable, and the runtime guard and its tests are deleted.
Superseded by G3.6 (`BlockKindRegistration`).

**G1.4 · No container history context.** No container `setContext`s `HISTORY_KEY`. Predicate
`checkNoContainerHistoryKey` (`context-keys.ts`) · seam
`editor-actions/nested/nested-actions.ts :: setNestedActionsContexts` · `context-keys.test.ts`,
`lint/no-container-history-key.test.ts`.

**G1.5 · Category and field legality.** Leaf fields appear only on leaves, container fields only on
containers, and a wrap-less container carries no `innerPrefix`. Predicate `checkCategoryFields`
(`node-shape.ts`) · commit primitive · `category-fields.test.ts`.

**G1.6 · Clone-safe metadata.** A kind's `cloneMetadata` returns a copy that's safe to mutate
independently, checked at both copy seams: `tree-operations/clone.ts :: cloneNode` and
`tree-operations/unshare.ts :: copyNode`. Predicate `checkCloneSafeMetadata` (`node-shape.ts`) ·
`clone-safe-metadata.test.ts`.

**G1.7 · Metadata writes route through `updateBlockMetadata`.** No predicate of its own; the rule is
enforced by routing. `editor-actions/block-edit-core.ts :: updateBlockMetadata` rebuilds raw after
the merge, and both factories delegate to the shared core, so metadata and bytes can't drift apart.
G1.1 is the runtime backstop for a bypass. Test `test/editor-actions/update-block-metadata.test.ts`.

**G1.8 · Well-formed content ranges.** `getContentRange` is well-formed for every kind that has one:
the prose kinds, plus any non-prose kind declaring its own (the directive leaf does), because the
range is consumed without asking `supportsInline` first. Predicate `checkContentRange`
(`descriptor.ts`) · commit primitive · `descriptor.test.ts`.

**G1.9 · Snapshot aliasing.** Bytes-scoped: no mutation writes serialized bytes through a node an
undo/redo entry shares. Live-tree moves of shared nodes are exempt (the inline cache is an external
WeakMap, so node writes never touch it). Most of the rule is a type now. Internal readers and the
public plugin surface hold bytes-readonly views (`core/node-views.ts`), so a reader-side byte write
is a compile error, and G4.13 guards the casts that would strip the view. The DEV check stays
anyway, because runtime JS bypasses types. The copy-path-on-write behind all this follows the
`$state` canonical-reference discipline (re-read a spliced copy through the tree before using it
further); the header of `tree-operations/unshare.ts` owns the full statement. Predicate
`checkSnapshotIntegrity` (`snapshot-integrity.ts`) · commit primitive (top undo entry) plus
undo/redo restore (`editor-actions/commit/history.ts`) · `snapshot-integrity.test.ts`,
`test/undo/undo-restoration.property.test.ts`.

The **commit-rollback companion** lives here too. Where G1.9 guards a mutation corrupting a _shared_
snapshot, this guards a _dangling_ one: a commit mutation that throws must leave the undo/redo
stacks byte-identical to their pre-commit state and mustn't publish a partial tree. `__commit`
captures both stacks before the snapshot push and, on throw, restores them via
`UndoManager.restoreStacks` (a wholesale restore that also recovers an entry the push evicted at
`MAX_UNDO`), emits `error{origin:'commit'}` on the event seam, then re-throws in DEV and swallows in
production. The two commit branches keep the tree intact differently:

- The **document branch** mutates a detached children copy and publishes it only on success, so a
  throw leaves the live tree untouched.
- The **container/multi-scope branch** mutates the live tree in place (its scope views are windows
  onto live nodes), so `__commit` captures the top-level children array before the mutation and
  swaps it back on throw. Copy-path-on-write guarantees the pre-mutation array still reaches an
  intact tree at every depth, discarding every copy the mutation dirtied.

The array swap alone can't reach a `snapshot:'skip'` container commit whose scope node was already
unshared earlier in the same undo unit: copy-path-on-write is then a no-op, so the mutation's
structural splice lands in place on a node the pre-mutation array still references. That's reachable
through cross-block paste, where one snapshot push joins a delete and a paste that both commit as
`snapshot:'skip'` structural splices. `__commit` closes it by also capturing each prepared scope's
pre-mutate children/childIds arrays and reinstating them on throw (doc-scope skip commits were
already recovered; there the mutated array is `deps.doc.children` itself).

One residual is open by design. The frame's byte registers reach each prepared scope's spine and its
direct children (`savedRaws`) and the document's folded trailing line (`savedDocSuffix`), so what
stays uncovered is narrow: a write deeper than an owned node's direct children, node metadata, and
`leadingTrivia` on a node the document branch already owns. For a scope already unshared earlier in
the same undo unit, copy-path-on-write is a no-op, so such a write leaves those bytes changed after
a throw rolls the structure back, and structure and bytes then disagree. It's out of scope for
pre-publish corruption (the user mutation and the arity check both throw before any byte write) and
only reachable via an internal malformed-change bug, which DEV re-throws. Covered by
`test/editor-actions/commit/commit-rollback.test.ts` and `commit-rollback-bytes.test.ts`.

**G1.10 · Opener-registry coherence.** Every opener's kind has a descriptor, and opener priorities
are unique. Predicate `checkOpenerRegistry` (`registry.ts`) · bootstrap · `opener-registry.test.ts`.

**G1.11 · Keymap coherence.** Every keymap chord is well-formed (Mod/Alt/Shift plus a non-empty key)
and names a known command id, and chords are unique per kind. Predicate `checkKeymapCoherence`
(`registry.ts`) · bootstrap · `keymap-coherence.test.ts`.

**G1.12 · Opaque container raw not stale.** The raw reparses to children that byte-match the live
children, chrome compared positionally for `reservedChrome` declarers. A kind with a standalone
recognizer whose raw no longer reparses to its own kind fires; a kind with no recognizer bails; a
directive kind counts as recognized, so that branch does fire for one. Predicate
`checkOpaqueStaleRaw` (`node-shape.ts`) · commit primitive · `opaque-contract.test.ts`,
`opaque-stale-raw-directive.test.ts`.

**G1.13 · Opaque rebuild determinism.** `rebuildRaw` is deterministic over committed state, checked
probe-vs-probe: run it twice, require the same bytes. Predicate `checkOpaqueRebuildDeterminism`
(`node-shape.ts`) · commit primitive · `opaque-rebuild-determinism.test.ts`.

**G1.14 · Reserved-chrome slot.** A container declaring `reservedChrome` holds a chrome leaf of the
declared kind at child 0; kinds with no declaration are exempt. Predicate `checkReservedChromeSlot`
(`node-shape.ts`) · commit primitive · `reserved-chrome-slot.test.ts`.

**G1.15 · Opener return trust.** At parse, a plugin opener must claim at least one line
(`consumed >= 1`). A return claiming none is **declined in every build**, so the line falls through
to the next opener and ultimately the paragraph fallback instead of spinning the parse loop, and
`opener-advance` warns naming the kind and the decline. The returned `node.raw` must also byte-match
the consumed source lines, else `opener-raw` warns; serialize reads `raw` only, so that drift
silently breaks round-trip. These are inline guards, module-private to `core/parser.ts`. There's no
importable predicate, and the test drives them through `parse()`. The decline is unconditional; the
warn and the raw check are DEV-gated. Seam: parser dispatch, per block ·
`test/core/parser-opener-guards.test.ts`.

**G1.16 · Commit path dialect.** Every coordinate a commit declares (`op.eventPath`,
`snapshot.path`) is document-absolute: each prefix resolves from the document root, and the final
index may name the one-past-end insert slot (append-shaped ops). Predicate
`checkCommitPathAddressable` (`commit-paths.ts`) · commit primitive, pre-mutate, via
`invariants/install.ts :: assertCommitPaths` · `commit-paths.test.ts`.

**G1.17 · No late opener.** An opener registered after the grammar was consumed warns, because
parsed documents never re-parse, so the kind would silently miss every open document. Predicate
`checkLateOpenerRegistration` (`registry.ts`) · bootstrap ·
`test/schema/registration-checks.test.ts`.

**G1.18 · Reserved-chrome coherence.** A `reservedChrome` declarer is a container, and its chrome
kind resolves to a descriptor and a component (both registered by `registerChromeLeaf`). The
bootstrap counterpart to G1.14's per-commit slot check. Predicate `checkReservedChromeCoherence`
(`registry.ts`) · bootstrap · `reserved-chrome-coherence.test.ts`,
`test/schema/registration-checks.test.ts`.

**G1.19 · Multi-scope commit path.** A scope's declared path still resolves to its captured node,
checked over all scopes _before_ any spine is unshared, since a stale-but-in-range path would
unshare and rebuild the wrong spine. An inline-closure guard (see How a guard is built), netted by
the e2e invariant watcher. Seam `editor-actions/commit/undo-controller.ts`.

**G1.20 · Unshared-spine depth.** The chain `withUnsharedSpine` hands back is as deep as the leaf
path it was given. A short chain means the caller is about to mutate a node it doesn't own. Inline
closure, watcher-netted. Seam `editor-actions/nested/nested-block-edit.ts`.

**G1.21 · Column-scope alignment.** Each row scope in a column edit IS the corresponding child of
the owned table, so the id/ref sync lands on the rows the splice actually walked. This guard's tag,
`column-scope-alignment`, is the one the e2e invariant watcher was built for. Before the watcher, a
fire here was observable by no gate at all. Inline closure. Seam `editor-actions/table-context.ts`.

**G1.22 · Unshare path in range.** Every index on an unshare path addresses a live child; an
out-of-range index silently truncates the chain. Inline closure, watcher-netted. Seam
`tree-operations/unshare.ts :: ensureUnsharedPath`.

**G1.23 · No decoration sources mid-commit.** `notifyEdit` and `runAll` assert the commit ceremony's
in-progress flag is clear, because a decoration source running mid-commit would read a
half-published tree. The flag is set by the commit helper and read from
`invariants/commit-scope.ts`. Inline closure, watcher-netted. Seam
`decorations/decoration-state.svelte.ts`.

**G1.24 · Closure-block coherence.** A kind's required closure block (its written answer to every
cross-cutting editor system) has to agree with the rest of its descriptor. The rules: a container
(anything declaring `container.contract`) can't claim `roundTrip: inherit-default`, because its
`rebuildRaw` IS the round-trip mechanism; a `not-mergeable` kind can't claim
`mergeBackspace: inherit-default`, there being no default merge to inherit; a cell claiming the
focus-then-delete model must be backed by `blockFocus: 'whole-block'`, the declaration that routes
the caret-adjacent merge fallbacks to a focus move; and a `reservedChrome` declarer can't leave
`clipboard: inherit-default`, its chrome bytes living in the container's own opener line. A declared
`conformanceFixture` must parse to a tree containing its kind; that rule runs in the unit sweep, not
the flush, because a `parse` import there would close a `schema → core/parser → schema` cycle.
Predicate `checkClosureCoherence` (`registry.ts`) · bootstrap (registration rules) plus the unit
sweep (fixture rule) · `closure-coherence.test.ts`, `closure-fixtures.test.ts`.

**G1.25 · Widget-pool pass bracket.** Inline widgets (the rendered stand-ins for inline constructs)
are recycled through a pool, one bracket per render pass. Every `acquire` sits inside an open
`beginPass`/`sweep` bracket, `beginPass` never opens over an unswept pass, and `sweep` never closes
one that isn't open. Outside a bracket, adoption flags and pass tallies are meaningless, and
byte-identical duplicate widgets are indistinguishable. Predicate `checkPoolBracket`
(`inline-transitions.ts`) · seam `components/blocks/widget-portal.ts` ·
`inline-transitions.test.ts`, `test/blocks/widget-portal-bracket.test.ts`.

**G1.26 · Reveal transition legality.** A reveal, for this entry: the surface swaps a rendered
inline construct for its editable source in temporary DOM, and the fold swaps it back, committing or
discarding what was typed. The fold and the reveal must each imply the other, so the id carries both
directions. **No fold without a reveal**: a fold entry (`commitReveal`, `cancelReveal`,
`foldRevealNoEdit`) runs only with an active reveal; every caller pre-guards, so a bare fold is a
caller that skipped the guard. **No mutation with a reveal** (`command-during-reveal`): no branch of
a block's command dispatch mutates while a reveal is open, because the reveal holds the block's live
bytes in ephemeral DOM the CST hasn't seen, and every branch reads `node.raw`; a fire is a command
entry path that skipped the fold. Also: `startReveal` is never re-entered inside the reveal's own
settle window (a microtask-long span while the reveal finishes, nothing to do with the separator
settle; no user gesture can land there), and the kernel's source-length precondition holds at reveal
entry. Legal bails stay silent by design: blur with no reveal, the cross-block keep-revealed bail,
entry while a reveal is already active. Inline closures at
`components/blocks/text/widget-interaction.ts` (the fold halves) and
`components/blocks/text/TextEditableBlock.svelte :: performBlockCommand` (the mutation half), plus
`checkRevealSourceLength` (`inline-transitions.ts`) at the kernel (`cursor/reveal-source.ts`) ·
`test/blocks/text/widget-reveal-transitions.test.ts`.

**G1.27 · Composition window.** `compositionend` lands only inside a composition the surface saw
start. Browsers pair the events per element, so an unpaired end means a consumer wired
`compositionend` without `compositionstart`, and every composed keystroke committed to the CST
mid-IME. Predicate `checkCompositionEndPaired` (`inline-transitions.ts`) · seam
`components/blocks/editable-surface.ts :: onCompositionEnd` · `inline-transitions.test.ts`,
`test/blocks/editable-surface-composition.test.ts`.

**G1.28 · Rendered text fidelity.** A code block's rendered fragment carries the block's bytes
exactly: `textContent === trimTrailingLineEnding(raw)`. The body round-trips through
`template.innerHTML`, and the HTML parser's normalizations (U+0000 dropped outright, engine-defined
line-ending and surrogate handling) could silently eat a byte the CST still holds, while the block
reads `textContent` back on every keystroke commit (the indent, dedent and cut gestures read
`node.raw` instead). Predicate `checkRenderedTextFidelity` (`render-fidelity.ts`) · seam
`components/blocks/code/code-renderer.ts :: renderCodeBlock` · `render-fidelity.test.ts`.

**G1.29 · Cross-block endpoint coordinates.** An endpoint's offset means what its own block's
coordinate space says. A table endpoint carries `cellCoordinate: true`, so it reads as a cell index
and never as a character count: a table path IS cell space, and a char offset stored there routes
rangeDelete down the generic branch and corrupts the grid. Both directions fire, since a cell index
stored against a block with no cells is the same corruption from the opposite producer. Every other
char endpoint must land inside its block's raw, and inside a kind with no character positions
(childless `blockFocus: 'whole-block'`) on one of the two ends, because an interior offset there
slices an opaque unit in half, so copy truncates the syntax and delete destroys it. Same-path pairs
are exempt (an intra-table rectangle's focus is unflagged by convention). Each rule has a normalizer
meant to make it unfireable, and each has been missed once (a length-1 table path; a character
hit-test over a rendered diagram). The producers are fixed, and this is the backstop for producer
N+1. Predicate `checkCrossBlockEndpointCoordinates` (`selection-endpoints.ts`) · seam
`selection/selection-state.svelte.ts :: enterCrossBlock` and `extendFocus` ·
`selection-endpoint-coordinates.test.ts`.

**G1.30 · Merge-role vocabulary.** Every registered kind declares a `mergeRole` from the known set;
an unknown role makes the merge dispatcher fall through silently on every gesture that reaches the
kind. It's a per-kind fact, so it's checked once per registration rather than once per committed
node, where it used to re-run a constant per commit and still missed a bad registration until the
first edit. Predicate `checkMergeRoleVocabulary` (`registry.ts`) · bootstrap ·
`category-fields.test.ts`.

**G1.31 · Inline-construct policy coherence.** The inline-construct policy table (one row per inline
kind: how it splits, unwraps, reveals) has to be coherent. A row must name a kind the inline
vocabulary holds, because a mistyped one is silent: the construct just keeps the absent-row
defaults. The marker-rewriting behaviors (the `close-and-reopen` split, the empty auto-unwrap)
belong only to a revealable kind, whose markers a caret can bring back on screen. No two mark rows
may claim one nesting rank or one command, since a tie would leave which mark wraps the other, or
which one a press toggles, to registration order. And a plugin row's mark may not claim a built-in
command id: the id already answers somewhere, and the surfaces rank the mark lookup differently, so
a `link.openCard` claim would shadow the card on cells but not on prose. That last rule guards an
entry that isn't even open yet. The policy registrar is on no public barrel at 1.0, so a row on a
plugin-declared inline kind is reachable only from inside the repo
(`docs/design/plugin-contract.md`, § Inline authoring). Checked at the editor-mount flush alone: the
rows register with the descriptors, but the policy's function hooks patch in from the component
layer, which a parse-only unit test never loads, even though the parser drains the same registration
queue. The built-in-command rule is also refused outright at `schema/inline-construct-policy.ts`
registration; this check is the backstop behind that refusal. Predicate `checkInlineConstructPolicy`
(`registry.ts`) · mount (`invariants/install.ts :: runStartupInvariantChecks`) ·
`inline-construct-policy-coherence.test.ts`, `test/schema/inline-construct-policy.test.ts`.

**G1.32 · Content-start Backspace coherence.** A kind declaring `contentStartBackspace` also
declares `getContentRange`. Without the hook its content starts at raw 0, where the demote branch
never fires, so the declaration is silently inert, observable only as a keystroke that merged when
it should have demoted. Predicate `checkContentStartBackspace` (`registry.ts`) · bootstrap ·
`content-start-backspace.test.ts`.

**G1.33 · Landable caret.** A block a caret is seated into, under an editable marker-hiding mode
(live, preview-inline), paints at least one landable position. A surface whose every byte is a
hidden marker run takes the next keystroke at an element boundary between `display:none` spans, and
the engine picks the side; that's how a typed `#` once came back as `a#`. Built-ins hold by
construction (chrome standing over no content paints; live-mode.md § 4.1), so the guard exists for a
plugin surface that builds its own marker chrome. It fires from the editor root's `focusin` seam,
never from inside any caret entry's own body: every caret entry seats a caret by focusing its
surface, so a caret component a consumer owns inherits the guard instead of routing around it. The
seam is per focus arrival, so a re-seat into a surface that already holds focus fires nothing.
Reading mode is out of scope, since it takes no keystrokes. Predicate `checkLandableCaret`
(`landable-caret.ts`) · seam `components/Editor.svelte`, the editor root's `focusin` handler ·
`landable-caret.test.ts`, `landable-caret-doors.test.ts`.

**G1.34 · Split landing.** The index a split's caret lands on is the one `splitNode` returned, never
a re-derived `blockIndex + 1`. The top-level path seats the caret at it and the list-item path
splices at it, so both cross the seam on their way to using it. The constant is the second half only
while the first half stays ONE block: bytes that reparse plural (a blank line inside indented code)
push the second half down, and the constant seated the caret on the first half's tail (GH #98). The
`tree-ops` warn beside this guard reports that the plural shape occurred, which is legal; this guard
reports that a landing disagreed, which isn't. Predicate `checkSplitLanding` (`split-landing.ts`) ·
seam `tree-operations/node-ops.ts :: assertSplitLanding`, crossed by
`editor-actions/block-edit-core.ts` and `editor-actions/list-context.ts` · `split-landing.test.ts`.

**G1.35 · Single-node sink.** A sink (a slot that installs exactly one node) never installs bytes
that reparse to several. Both merge routes reach one: the forward merge reparses the concatenation,
and the deep-leaf merge writes the previous block's leaf. A join whose bytes read as two blocks is
refused there rather than truncated to the first (a line vanishes from the document) or written
whole into the surviving slot (the tree stops agreeing with its own reload); both routes then return
noop and the caret moves across the boundary instead (GH #166). The question is asked at the WRITE,
over the nodes going into the slot, so the guard answers for sink N+1: one that skips the refusal
its siblings make, or splices a plural replacement where one node belongs. Arriving plural is legal;
installing plural is the fire. Predicate `checkSingleNodeSink` (`single-node-sink.ts`) · seam
`tree-operations/node-ops.ts :: reparseAsNode` and `mergedLeafFor` ·
`test/tree-operations/merge-multi-block-refusal.test.ts`.

**G1.36 · Structural-descriptor coherence.** A `StructuralChange` (the record a mutation publishes
so the id and ref arrays can follow a splice) must fit the array it syncs, no negative slot count
and no window past the end, and every publish seam must leave one id per child.
`Array.from({length: -1})` is `[]`, so a record derived from a LENGTH DIFF over a fixed window
desyncs ids from children in silence the moment a splice moves slots the window never named. A
settle folding a separator above a range delete is exactly that shape, and it shipped unobserved
because nothing compared the published id array against the children. The producer half fires at the
applicator, which every record crosses; the consumer half fires at the two commit publish seams,
because a record can fit its own array while describing the wrong window. `childSpans` is the same
shape of parallel array and gets the same reading, one span PAIR per child, over the nodes a commit
touched: a rebuild seeding the wrong length, or a shape change that outlived its drop, is a
stale-region splice waiting for the next keystroke. Predicates `checkStructuralDescriptor`,
`checkIdsChildrenLockstep`, `checkChildSpansLockstep` (`structural-descriptor.ts`) · seams
`tree-operations/structural-change.ts :: applyStructuralChangeToIdsRefs`, the commit primitive
(`editor-actions/commit/undo-controller.ts`), and the per-commit node check
(`invariants/install.ts :: assertCommittedNodes`) · `structural-descriptor.test.ts`,
`test/schema/child-spans.test.ts`,
`test/selection/cross-block/cross-block-delete-seam-fold.test.ts`.

**G1.37 · Descriptor-field coherence.** Field pairs the registration shape can represent and no kind
can mean together, checked against the declarations alone. `contextDependentKind` beside a
registered opener suppresses the reparse for a kind the parser CAN recognize, so its bytes stop
re-deriving. `blockFocus: 'whole-block'` beside `supportsInline` parses inline constructs into a
surface whose only addressable offsets are 0 and its display length. `blockFocus` beside
`reservedChrome` declares the focus-then-delete model on a kind the chrome slot keeps from ever
being childless. The last pair reads `unwrapRole.firstChildBackspace` against `reservedChrome` in
both directions: a lifting strategy would carry the chrome row out of its own container, and the
`'keep-reserved-chrome'` decline on a container whose child 0 is body makes Backspace there a dead
key. Each is silently inert rather than loud, so nothing fails until a gesture reaches
the kind. G1.24 is the sibling over the closure cells; this one never reads them. Predicate
`checkDescriptorFieldCoherence` (`registry.ts`) · bootstrap · `descriptor-field-coherence.test.ts`.

**G1.38 · Faithful container splices.** After every one-region splice, dev re-derives the whole
container raw on a scratch node and refuses the splice on any difference: the node takes the full
rebuild instead, and the guard names the kind. The region check inside the splice reads the NAMED
child only, and the bytes a container holds beside it move for reasons no hint carries (a sibling
separating line a settle retires, a wrap slot it borrows). Those seams retire the spans themselves
(`schema/child-spans.ts`); this is the backstop under them, and the only guard that sees a stale
container raw living BETWEEN commits, where G1.1 never runs. Dev pays one re-derive per spliced
keystroke, which lands a hinted rebuild back at about the full one it replaced (1.9 ms against 1.7
ms on the 1MB interior bench row); production pays nothing, and neither does an instrumented run.
Predicate `schema/child-spans.ts :: spliceIsFaithful`, the one predicate living outside
`invariants/` · seam: the splice path · `test/schema/child-spans-settle.test.ts`,
`child-spans.property.test.ts`.

## Group 2: property and regression tested

No runtime seam sees these; the test suite is the whole enforcement. Test files live under
`test/invariants/`, and the arbitraries they draw random documents from live in
`test/invariants/arbitraries/`.

| ID    | What stays true                                                             | Codes |
| ----- | --------------------------------------------------------------------------- | ----- |
| G2.1  | Any string parses without throwing and serializes back to itself            | P·N   |
| G2.2  | The end-of-file edge states round-trip                                      | P·N   |
| G2.3  | The inline parser holds against its conformance corpus                      | P     |
| G2.4  | A rendered block's DOM text equals its ambient prefix plus its raw          | P     |
| G2.5  | The inline tree's offsets partition the block's raw                         | P·N   |
| G2.6  | Serialization ignores metadata and editor-level fields                      | P     |
| G2.7  | A selection partitions cleanly, and `walkBetween` visits in order           | P     |
| G2.8  | Split and merge round-trip; ids, refs and children stay aligned             | P·N   |
| G2.9  | Paste emits its op kind by strategy, never by target depth                  | P     |
| G2.10 | The sticky column resets everywhere it is captured                          | P·A   |
| G2.11 | The inline scan covers every byte with known construct kinds, tiled         | P     |
| G2.12 | A caret placement ends a live cross-block range, unless it is an extend     | L     |
| G2.13 | An edit leaves a tree whose serialization reparses to the same block shape  | P·N   |
| G2.14 | A format toggle applies exactly where the active-read says it isn't applied | N     |

### The entries

**G2.1 · Round-trip and totality.** `serialize(parse(s)) === s` over piles of arbitrary strings, and
the parser absorbs any input without throwing. `round-trip.property.test.ts`.

**G2.2 · EOF edge states.** An unclosed fence and unterminated HTML round-trip too. Same file, its
G2.2 block.

**G2.3 · Inline conformance corpus.** The inline parser holds against the conformance corpus.
`inline-conformance.test.ts`.

**G2.4 · The textContent equation.** `textContent === ambientPrefix + raw` over rendered prose, the
trailing line ending excluded (`docs/design/inline-parsing.md` § The textContent invariant), run in
jsdom. `textcontent-spine.property.test.ts`.

**G2.5 · Inline offset partition.** The inline tree's offsets partition the block's raw.
`inline-offsets.property.test.ts`.

**G2.6 · Serialization purity.** Serialization ignores metadata and editor-level fields.
`serialization-purity.property.test.ts`.

**G2.7 · Selection partition.** A selection partitions the document cleanly, and `walkBetween`
visits its blocks in order. `selection-partition.property.test.ts`.

**G2.8 · Structural alignment.** Split and merge round-trip, and the id, ref and children arrays
stay aligned, in all scopes. `structural-id-ref-alignment.test.ts`.

**G2.9 · Paste op kinds.** Paste emits its op kind by strategy, never by target depth: the default
structural paste emits `replaceBlock`, container absorb and merge emit `paste`, and the cross-block
inline paste emits `updateContent`. A consumer counting pastes watches all three.
`paste-op-kind.test.ts`.

**G2.10 · Sticky-column resets.** The sticky column (the X position a vertical caret walk tries to
keep across shorter lines) resets everywhere it's captured: the behavior matrix plus the
capture-without-reset and keydown entry guards, run in jsdom. `sticky-column-matrix.test.ts`,
`lint/sticky-column-capture-reset.test.ts`.

**G2.11 · Inline scan coverage.** The inline scan covers every byte, the constructs tile without
gaps, and every node's kind is in the vocabulary: the built-in kinds plus those an installed plugin
declared, so the property also runs with the bundled plugins' inline kinds registered.
`inline-total-coverage.property.test.ts`.

**G2.12 · Caret placement ends a range.** A caret placement ends a live cross-block range, unless
it's an extend. The programmatic side is one route: `BlockComponent.focus` is built over each
surface's park primitive and ends the range itself. The scan carries the three parts that can't be
routed: NATIVE caret placement (a click's own default moves the caret, so per-file pointer-entry
declarations still apply), the park verb's caller allowlist (legitimacy is the caller's intent, and
no position test separates the uses), and the park verb's presence on every LEAF that forwards a
shared caret seam (the method is optional on the contract, so a missing forward type-checks).
Containers left that class: each publishes its whole surface as one `containerApi` instance export,
so the scan asserts that publication instead of a per-member pairing. Behavioral complement: the
simulation's range-interrupt family drives the same precondition through real gestures.
`lint/caret-gesture-range-reset.test.ts`, plus
`src/lib/e2e/tests/simulation/range-interrupt-ops.spec.ts` (outside this group's root).

**G2.13 · Shape fixed point.** An edit on a loaded document leaves a tree whose serialization
reparses to the SAME block shape. It's the complement of G2.1, which a shape loss passes untouched
(the bytes were exact and one block was gone). Two lanes of input, two suites: blank-line-separated
documents under the split, delete and commit gestures, the surface the blank-line rule governs; and
inline-source paragraphs under the live split, the differential that judges the rebalancer.
`shape-fixed-point.property.test.ts`, `parse-convergence.test.ts`.

**G2.14 · Toggle and active-read equivalence.** Over a RANGE, the toggle and `isInlineFormatActive`
agree: where the read says active the toggle unapplies, where it says inactive the toggle applies.
The cross-block direction rests on this equivalence, and one side growing a fourth branch misroutes
writes in silence. It holds with one branch outside it, in one mode: where the delimiters PAINT, the
bare wrap writes its literal bytes unverified, on screen for the reader to see and fix (live-mode.md
§ 4.3). Split, absorb, the flank strip and the marker-hiding wrap all coverage-verify, the split
over every covering run of the kind rather than the innermost alone. The aligned strip verifies
coverage in no mode: it fires only where the block's own parse holds the construct at exactly the
selection and no second run of that kind covers it, with a screen check where the delimiters don't
paint. A collapsed caret is a different ladder entirely. `format-toggle-ladder.test.ts`.

## Group 3: compile time

The top rung: the violation doesn't compile. Enforced by `npm run check`; there's no runtime seam.
Each entry says what the type retired, since that list is the receipts.

| ID   | What no longer compiles                                                           | Codes |
| ---- | --------------------------------------------------------------------------------- | ----- |
| G3.1 | An untyped metadata access (`as` cast) on a block node                            | T     |
| G3.2 | A component publishing anything but the two sanctioned export shapes              | T     |
| G3.3 | A cell selection point where a character point belongs, or the reverse            | T     |
| G3.4 | A magic number standing in for "end of block"                                     | T     |
| G3.5 | A container without a declared contract                                           | T     |
| G3.6 | A container registration missing its rebuild, or a leaf claiming container fields | T     |
| G3.7 | Arithmetic across two different coordinate spaces                                 | T     |
| G3.8 | A reader writing a node's serialized bytes                                        | T     |

### The entries

**G3.1 · Typed per-kind metadata.** `BlockMetadataByKind` plus `metadataOf<K>`. Retired: `as`
metadata casts.

**G3.2 · Sanctioned component exports.** `defineBlockComponent`, whose exports parameter is the two
sanctioned publication shapes (`BlockComponentExports`): a leaf's own surface, or a container's
single `containerApi`. Retired: `as unknown as` casts, and a container that publishes no surface at
all.

**G3.3 · Discriminated selection points.** `SelectionPoint` is a discriminated union
(`CharSelectionPoint | CellSelectionPoint`) on `cellCoordinate`: a cell point needs the literal
`true`, and a char-typed slot rejects a cell point. Retired: the optional-boolean flag's
construction and assignment ambiguity. `offset` keeps its name, so a wrong-space READ narrows to the
`charOffsetOf`/`cellIndexOf` runtime backstop rather than to the compiler.

**G3.4 · Branded end markers.** Branded `CURSOR_END` and `SELECTION_END`. Retired: the `999999`
magic number.

**G3.5 · Declared container contracts.** `containerContract: 'strip' | 'grid' | 'opaque'`. Retired:
the implicit table exemption.

**G3.6 · The container registration group.** `BlockKindRegistration`'s `container` group:
container-only fields register as one unit with `contract` and `rebuildRaw` required and
`isContainer` derived; a leaf augment carrying a `container` group throws. Retired: G1.3, the
runtime pairing guard.

**G3.7 · Branded coordinate spaces.** `cursor/coordinate-spaces.ts`: `RawOffset`, `DomTextOffset`,
`EditorX`, `ViewportX`, `CellIndex`, `DocPath`, each minted only at its home module with named
conversions per direction ("minted", here and in G4.15, in the strict sense: created by the one
authorized place, and a duplicate throws). Public entries keep `number` and brand once at the
boundary. Cross-space arithmetic is a type error. Retired: offset-space mixing, the audit's second
bug class; `charOffsetOf`'s read-space check narrows to the runtime backstop.

**G3.8 · Bytes-readonly node views.** `core/node-views.ts :: NodeView` and `DocumentView`:
serialized bytes deep-readonly, the `childIds`/`childSpans`/`ownerEpoch` bookkeeping writable. This
is G1.9 stated as a type: readers hold views, constructors and writers keep `CstNode`, and the
unshare seam is the only way back to mutable (G4.13 scans for the casts). Retired: reader-side byte
writes, and the "read-only by contract" prose on `BlockComponentProps.document`.

## Group 4: source scans

These are tests that read the source text itself. They catch what a type can't express and a runtime
seam can't see: a pattern anywhere in the tree, or a published table drifting from the code that
backs it.

The scans live in TWO homes, and the split decides which script runs one. Scans over the LIBRARY
source live in `test/invariants/lint/` and ride `npm run test:editor:invariants`. Scans over the E2E
TREE live in `e2e/lint/` (G4.22, G4.23, G4.49) and do **not** ride that script, which is
path-scoped; they ride `npm test` through vitest's second include glob, and you iterate on them with
`npx vitest run src/lib/e2e/lint/` (same command in bash and PowerShell).

One caveat before the table: this is the catalogued set, not the whole of `test/invariants/lint/`. A
scan guarding one seam's own local rule earns a file without earning a G-number, so read the
directory as well as this table before assuming a rule is unguarded.

| ID    | What stays true                                                               | Codes   |
| ----- | ----------------------------------------------------------------------------- | ------- |
| G4.1  | `createBlockListState` takes getters, never values                            | L       |
| G4.2  | The render path computes inline content, never reads the cache                | L       |
| G4.3  | Every container passes the conformance kit, and its declarations resolve      | harness |
| G4.4  | No timing hacks for sequencing                                                | L       |
| G4.5  | No synthetic `KeyboardEvent` in editor runtime source                         | L       |
| G4.6  | Editor CSS and tokens live where the ownership rules say                      | L       |
| G4.7  | A render memo keys on every input its built DOM embeds                        | D·N     |
| G4.8  | Every documented chord resolves in the surface that dispatches it             | L       |
| G4.9  | Every published theme token is declared, with light and dark values           | L       |
| G4.10 | Every bundled plugin directory is exported, and the pack carries it           | L       |
| G4.11 | Exactly the two sanctioned paste routes apply paste transforms                | L       |
| G4.12 | Caret-edge destructive keys route through the one edge-policy dispatch        | L       |
| G4.13 | No view-stripping cast outside `tree-operations/` and the commit ceremony     | T·L     |
| G4.14 | Every component prop reading the CST is typed as a readonly view              | L       |
| G4.15 | Coordinate brands are minted only at their home modules                       | L       |
| G4.16 | Bundled plugins import only the public authoring barrel                       | L       |
| G4.17 | Every perf spec is collected by exactly one Playwright project                | L       |
| G4.18 | The inline trigger set, the scan switch, and the reserved routes agree        | L       |
| G4.19 | Every command dispatch site threads the reading-mode gate                     | L       |
| G4.20 | A reattached line ending is read from the bytes, never a newline literal      | L·N     |
| G4.21 | Image bytes are written only through the one seam module                      | L       |
| G4.22 | An e2e wait predicate must describe the post-operation shape                  | L       |
| G4.23 | Every e2e spec pairs with a requirement file, and vice versa                  | L       |
| G4.24 | The code surface commits through exactly one `updateBlockContent` call        | L       |
| G4.25 | No `import.meta` env read anywhere under `src/lib`                            | L       |
| G4.26 | Comment blocks stay inside the budget                                         | L       |
| G4.27 | Every `parse` call outside the parser declares its scope                      | L       |
| G4.28 | Leaf raw writes reach bytes through the two sanctioned readers                | L       |
| G4.29 | Every file claiming a hardcoded chord is manifested with its chords and keys  | L       |
| G4.30 | Hidden-marker classification has one rule, applied in both spaces             | L       |
| G4.31 | Edge affinity and the pending marks reset wherever the sticky column does     | L       |
| G4.32 | Every non-render inline read goes through `resolvedInlineContent`             | L       |
| G4.33 | Live-mode byte candidates verify against what actually paints                 | L       |
| G4.34 | Link bytes are written only through the one seam module                       | L       |
| G4.35 | A construct stamps its markers exactly when its policy row says revealable    | L       |
| G4.36 | Caret positions are written only at the named write sites                     | L       |
| G4.37 | Every surface rendering into a caret-walk container stamps content-empty      | L       |
| G4.38 | Every editable surface publishes `insertMarkdown`                             | L       |
| G4.39 | Every command surface publishes `runCommand`                                  | L       |
| G4.40 | The three rewrite-claim lists are one set                                     | N       |
| G4.41 | No test file mocks `dev-warn` or spies `console.warn`                         | L       |
| G4.42 | No module writes a sibling's `leadingTrivia` by hand                          | L       |
| G4.43 | Every `splitNode` caller asserts its landing                                  | L       |
| G4.44 | Every prose surface resolves native ranged edits through the one resolver     | L       |
| G4.45 | Every bare tree-op caller is declared with the commit that settles its writes | L       |
| G4.46 | Every ancestry-rebuild caller states its fold-sink stance                     | L       |
| G4.47 | Every contenteditable read routes through the host-aware predicate            | L       |
| G4.48 | Wall-clock budgets outside the perf projects use the growth harness           | L       |
| G4.49 | E2E composition rides the shared IME driver                                   | L       |
| G4.50 | Every block command id is classified for cross-block ranges                   | L       |
| G4.51 | A typing-checkpoint push always arms the pause window                         | L       |
| G4.52 | The content version is announced at every place that writes document bytes    | L       |
| G4.53 | The descriptor type and the published field table are one set                 | L       |
| G4.54 | A published entry barrel is never imported by its own import closure          | L       |
| G4.55 | Docs name the package `@voithos-labs/aragonite`, never bare `aragonite`       | L       |
| G4.56 | Inline-tree and rendered-DOM walks are iterative, never recursive             | L       |
| G4.57 | The source-scan lexer agrees with TypeScript's                                | L       |
| G4.58 | One commit-message rule, enforced at the hook and in CI                       | L       |
| G4.59 | The VR tag catalog and the tags cited in source are one set                   | L       |
| G4.60 | Every spread into a call's argument list declares what bounds its count       | L       |

### The entries

**G4.1 · Getter-fed block-list state.** No by-value `createBlockListState`: it takes getters only.
`lint/createblockliststate-getters.test.ts`.

**G4.2 · Render path skips the inline cache.** The render path computes inline content via
`computeInlineContent`, never the caching `getInlineContent` accessor. Perf hygiene, since the cache
is a non-reactive WeakMap. `lint/render-inlinecontent.test.ts`.

**G4.3 · Container conformance kit.** The kit plus declaration sanity: `unwrapRole` strategies
resolve, `containerPaste` has the right shape, `rebuildRaw` runs. Built-ins are swept
registry-derived; a plugin container opts in with its own profile through `runContainerConformance`
(`@voithos-labs/aragonite/testing`). Kit: `$lib/testing/container-conformance.ts` · tests
`container-conformance.test.ts` (built-ins), `test/plugins/container-conformance.test.ts` (plugin
containers).

**G4.4 · No timing hacks.** No timing primitive is used for sequencing. The allowlist is short and
closed, and anything else trips the scan: the rAF throttles in `selection/autoscroll.ts`
(frame-paced autoscroll) and `selection/pointer-session.ts` (pointermove coalescing, the one home
every drag lifecycle rides); the `setTimeout` wall-clock undo debounce in
`editor-actions/commit/text-batch.ts` (a tick-grained microtask can't express "the user stopped
typing"); the `setTimeout` scan deadline in `search/regex-executor.ts` (a cancellation budget,
not an ordering primitive, since nothing awaits the timer); and the `setInterval` frame cadence in
`plugins/parrot/ParrotBlock.svelte` (an animation, sequencing nothing). `lint/timing-hacks.test.ts`.

**G4.5 · No synthetic keyboard events.** No synthetic `KeyboardEvent` in editor runtime source. The
cross-block redispatch hack is retired and stays that way.
`lint/no-synthetic-keyboard-event.test.ts`.

**G4.6 · CSS ownership.** `app.css` holds no editor rules or tokens; every editor-owned token read
is declared in `editor-theme.css`; every host-token read carries a fallback; and host-chrome
defaults sit behind the opt-in theme class alone (G4.6d), so a themed host's cascade reaches the
editor unbridged. The same rule extends to the dogfood and reference plugins, which may also read
tokens they declare themselves. `lint/css-ownership.test.ts` (editor),
`lint/plugin-css-ownership.test.ts` (plugins).

**G4.7 · Render-memo completeness.** A block's render memo key includes every input its built DOM
embeds; no live value (tree path, index, load policy, checkbox state) is baked in as a build-time
snapshot the key omits. Resolve it live, or key on it. Concretely, a prose block's render is
memoized on `renderKey`: `ambientPrefixText` + `raw` + the link-reference-definition signature epoch
(a compact stamp that changes exactly when the signature string does) + the image-load policy, and
the inline DOM must depend on nothing outside that key. The incident that named the rule: the image
widget baked the paragraph's path into a `data-*` attribute and its click handler at build time, but
the key omitted the path, so a block whose index shifted without a raw/ambient/link change never
re-baked, and click-to-select resolved a stale node. Fixed by resolving the path live from the
host's reactive `data-block-path` at event time. Two latent siblings closed the same way:
`imageLoadPolicy` is now keyed when the block holds an image, and the task checkbox's `aria-checked`
derives from the keyed `taskMarker` rather than the parallel `taskChecked` field. G4.2 is the one
automated proxy (it keeps the non-reactive inline cache off the render path); the general contract
is doc-enforced (`D`) with per-instance regression tests (`N`):
`src/lib/e2e/tests/blocks/image/widget-path-restability.spec.ts` (path),
`test/blocks/text/render-image-policy.test.ts` and `test/blocks/list/task-checkbox.test.ts` (policy,
checkbox).

**G4.8 · Documented-chord dispatch.** Every chord the consumer guide's keyboard table lists resolves
in the surface that actually dispatches it: the keymap registry (which the table's structural chords
joined at 0.9.36), the search components, or the clipboard seams (the whole-block key tail and the
text block's clipboard seam). `lint/consumer-guide-chords.test.ts`.

**G4.9 · Theme-token manifest.** Every token the consumer and plugin guides publish is declared in
`editor-theme.css`, and a themed token carries both a light and a dark value.
`lint/theme-token-manifest.test.ts`.

**G4.10 · Plugin package and pack parity.** Every `src/lib/plugins/<name>` directory is exported as
`./plugins/<name>`, and verify-pack derives its REQUIRED manifest from that (`index.js` plus
`index.d.ts`, via `scripts/pack-manifest.mjs`); a plugin module with a top-level CSS import is
declared in `sideEffects`. Subset, not equality: the `/renderer` engine subpaths are extra.
`lint/plugin-pack-parity.test.ts`.

**G4.11 · Paste-transform two-site parity.** Exactly the two sanctioned clipboard-to-parse routes
call `applyPasteTransforms`; a third route born without it silently drops plugin transforms. Two
halves, because caller parity alone can't see the shape it names (a route that never mentions the
symbol contributes nothing to the caller set), so every clipboard or drop read is also enumerated
and required to reach a sanctioned route. `lint/paste-transform-sites.test.ts`.

**G4.12 · Caret-edge destructive keys.** Every plain Backspace or Delete intercepted at a caret edge
in a prose block routes through the one edge-policy dispatch, which resolves what sits at the edge
(a CST widget, a decoration island, an ambient-prefix overlap) against declarative policies, and
commits via `updateBlockContent`. The only carve-out is the selected-widget second-press delete. No
other `blocks/text/` file intercepts a plain destructive key without being allowlisted.
`lint/caret-edge-seams.test.ts`.

**G4.13 · The view-to-mutable boundary.** No `as CstNode` or `as Document` view-stripping cast
outside `tree-operations/` and the commit ceremony. Readers hold bytes-readonly views
(`core/node-views.ts`, G1.9 as a type) and re-enter mutability only through the unshare/clone seam
or a commit scope's owned view. `lint/view-stripping-casts.test.ts`; type pins in
`test/core/node-views.test.ts`.

**G4.14 · Readonly-view prop parity.** Every `.svelte` component prop reading the CST is typed
`NodeView` or `DocumentView`. The registration boundary erases prop types, so a `node: CstNode`
drift compiles; only the doc-owning root (`Editor.svelte`) holds a mutable `Document`.
`lint/readonly-view-prop-annotations.test.ts`.

**G4.15 · Coordinate-brand mint discipline.** `as <Brand>` casts and the `as*` boundary mints appear
only in `cursor/coordinate-spaces.ts` and the allowlisted public-entry files; everywhere else
arrives at a brand through a mint or a named conversion. G3.7's runtime-source complement.
`lint/coordinate-brand-mints.test.ts`.

**G4.16 · Bundled-plugin import boundary.** Every file under `src/lib/plugins/**` imports only the
public authoring barrel (`$lib/plugin`), its own plugin directory, `svelte`, or, for a
`renderer.ts`, its one declared rendering engine. This is the dogfood proof that the authoring
barrel is complete. `lint/plugin-import-boundary.test.ts`.

**G4.17 · Perf spec glob partition.** Every `*.spec.ts` under `e2e/tests/perf/` is collected by
`e2e-vr` or by `e2e-perf`/`e2e-perf-prod`; a spec matching neither runs in no Playwright project and
is silently never executed. Classified by path relative to the perf directory, not by basename,
because the two projects differ in depth: `e2e-vr`'s `vr-*.spec.ts` can't cross a `/`, while
`e2e-perf`'s `*.perf.spec.ts` matches at any depth. `lint/perf-glob-partition.test.ts`.

**G4.18 · Inline-trigger parity.** `BUILTIN_TRIGGERS` (`core/inline/scan/plugin-syntax.ts`) equals
the `scanInline` switch's `case` labels (`core/inline/scan/index.ts`); a trigger the switch claims
but the set omits would be accepted by `registerInlineSyntax` and then silently shadowed. The scan
also partitions every reserved trigger across the three routes that reach the scan (scan-visible
`SPECIAL_CHARS`, scan-probed `SCAN_PROBED_RESERVED`, rejected `REJECTED_RESERVED`), so a trigger
with no route, two routes, or a route it doesn't qualify for fails here; and it pins the pre-switch
prefix consultation to one site ahead of the switch. `lint/inline-trigger-parity.test.ts`.

**G4.19 · Reading-gate parity.** Every `dispatchKeyCommand`, `dispatchKindCommand`,
`runCommandById`, `runGlobalChord`, `runGlobalChordOnKind` and `getCommand`-direct construction site
either threads `getPresentationMode` (the seam dead-keys reading mode) or carries a local
reading/readOnly guard in its handler, allowlisted with the guard token; the dispatcher definitions
and the seam's post-gate `getCommand` are excluded. Threading resolves from the CALL SITE (the
getter inline in the argument list, or inside the object literal a named context argument binds), so
a `runCommand` entry rewired to a context that skips the getter fails. A new editable surface
skipping the gate trips the file-set check. `lint/reading-gate-parity.test.ts`.

**G4.20 · Trailing-line-ending parity.** A site that reattaches or creates a line ending reads it
from the bytes it's standing in for (`trailingLineEnding`), never a bare newline literal, which
downgrades a CRLF block to LF and breaks byte round-trip. Five scan branches: no
`updateBlockContent` content argument reconstructs with a string-literal newline; every
`commitInput` route reaching `updateBlockContent` appends the ending (table cells allowlisted, since
a GFM cell holds no raw newline); no container `rebuildRaw` emits a newline literal into the bytes
it re-derives; the ending ternary and the complement reading what a block's own bytes carry both
live in `core/lines.ts` alone, so neither inline idiom can seed the next copy; and no write to a
node's `raw` creates a newline literal at all. That last one is the domain branch, which reaches the
rebuilders, the list terminator and the range-delete branches that sit outside both routes, with
legitimately-literal writes allowlisted by reason AND count. The scans see literal shapes only, so
an outcome-level check runs each gesture over an LF fixture and its CRLF mirror and requires the
results to mirror. It catches the creation sites no shape matches (defaulted parameters, placeholder
paragraphs), and fires for gesture N+1 untaught. `lint/trailing-line-ending-parity.test.ts`
(branches); `crlf-edit-mirror.test.ts` (the outcome check).

**G4.21 · Image byte-write seam.** A name-presence file-set scan, not a behavioral one: the GFM
serializer is named in code only inside the seam module, and exactly the documented write paths name
`buildImageEditBytes`; the popover is checked separately for naming neither, since it takes the
seam's answer as a prop rather than by import. It catches the shape that shipped (three write sites,
commit, keyboard resize and the popover dirty check, each reaching for the serializer directly and
each re-emitting GFM over bytes an inline plugin kind claimed, and a fourth path joining the route
undocumented). It does NOT catch a path that hand-rolls the GFM bytes from a template; no name scan
can. Scanned rather than typed because the serializer carries its own unit suite and so can't be
unexported. `lint/image-bytes-write-seam.test.ts`.

**G4.22 · E2E wait predicates describe the outcome.** Inside one `test()` body, a `waitForSource*`
predicate must describe the POST-operation shape. One that's already true on the document the test
loaded returns on its first poll, so it synchronizes on nothing, and a gesture that silently no-ops
satisfies the whole chain. (The "settle" in this scan's filename is the e2e kind, waiting for the
document to reach a shape, not the separator pass.) `e2e/lint/settle-predicate-vacuity.test.ts`.

**G4.23 · Requirement and spec lockstep.** Every spec under `e2e/tests/` pairs with a requirement
file under `e2e/requirements/` and vice versa (`.perf` stripped from the stem, no two specs claiming
one file); each requirement carries a title, a section and a scenario, each spec a `test()`; and a
requirement list three times longer than its spec's test count is named with a reason in the scan's
allowlist. Count EQUALITY is refuted by measurement, most pairs diverge legitimately; the dated
survey is in the file header. `e2e/lint/requirement-spec-lockstep.test.ts`.

**G4.24 · Code-surface commit route.** `CodeBlock.svelte` holds exactly one `updateBlockContent`
call, and it's `commitDisplay`'s, so the fence write reconciliation (escalate a body line the parser
would read as this block's closer; drop a backtick the info string can't hold) runs on every display
commit rather than at the gestures that remembered it. Two gestures that predated the seam (Enter
splitting a line around a mid-line run, and Shift+Tab dedenting an indented line to column 0) split
the block by moving bytes while adding no character. `lint/code-commit-funnel.test.ts`.

**G4.25 · No `import.meta` env reads.** Nowhere under `src/lib`. It's a Vite-only extension, so
outside a Vite bundle the object is undefined and a module-scope read throws at import time; the
library wouldn't load at all under another bundler. Toolchain flags come from `esm-env`, whose
export conditions every bundler resolves and whose `DEV` still folds away in a production build.
This is the one scan covering the test tree too, because `svelte-package` inspects everything it
copies and warns on the token wherever it sits, and it only warns, so a test-tree read would rot the
packaging claim unwatched. Library-scoped rather than repo-wide: the reference plugins and the
consumer example are Vite APPS, where the read is legitimate. `lint/no-import-meta-env.test.ts`.

**G4.26 · Comment budget.** A file's first comment block (the header) holds at most about seven text
lines, any other block at most six. The stated budget (1-2 lines, headers ~5) was documented-only
and drifted exactly as the enforcement ladder predicts; this gate catches the essay class and leaves
the finer register to review. A why that needs more lines belongs in a design doc, a requirement
file, or the commit. `lint/comment-budget.test.ts`.

**G4.27 · Parse-scope declaration.** Every call of the core `parse` entry outside `core/parser.ts`
passes an explicit `scope`. The default is `'document'`, so a silent fragment caller (a commit
reparse, a clipboard parse, a container body) hands one block's bytes to the openers as a whole
document, and a position-scoped kind appears wherever the edited block sat (issue #52). Scope is the
caller's knowledge alone, nothing in `parse` can recover it, so the declaration lives at the call.
Scanned over the library and the plugin-route author stand-in; the consumer example is excluded (it
writes the documented whole-document default), as are the published kits (fixtures are whole
documents). `lint/parse-scope-sites.test.ts`.

**G4.28 · Leaf raw-write rule parity.** A kind's own `normalizeRawWrite` reaches its bytes through
two readers in `node-ops`: `writeOwnRaw` for a sink that writes in place, and `normalizeOwnRaw` for
one that replaces the leaf with a reparse of the result. Exactly the documented sinks call each
(find/replace's private clone, the same-block range merge, the degraded typed-char splice, the
container-matching paste; and the cross-block merge and the truncated-endpoint reparse), plus the
table branch, which inherits the rule by routing through that shared reparse rather than naming a
reader. G4.24 pins the code SURFACE's write sites, which is why find-and-replace could write a fence
terminator into a code body (issue #45) and a delete past a closer could drop one (issue #55): the
descriptor-hook route was unwatched, and a reparse re-derives honest metadata that no longer knows
what the truncation took. The companion branches pin the fence rule to one implementation, in
`schema/` rather than under `components/`, so a headless sink reaches it.
`lint/leaf-raw-write-rule.test.ts`.

**G4.29 · Hardcoded-chord manifest.** Every library file that reads a `KeyboardEvent` modifier flag
is named in `schema/reserved-chords.ts`, with the chords it claims outside the keymaps and the key
literals it compares. A new claiming site, or a new key compared in an existing one, fails the gate
until the entry is re-derived, which is what keeps the editor's public `reservedChords()` method
(`editor-props.ts`) from rotting. Authoring constraint: a manifested file must keep literal key
comparisons and literal modifier reads, since the scan is structural on both axes; factoring either
behind a shared helper fails the gate until the scan learns that helper.
`lint/reserved-chord-manifest.test.ts`.

**G4.30 · Hidden-run classification.** One rule, two spaces. `core/inline/visibility.ts` states the
marker families and the hiding rule, and `cursor/widget-offset.ts` applies it where there's a caret:
the walk's landing rule, the read canonicalization, the widget-free walk beside it, and the
block-edge gates that ask whether a block's own markers paint all read that one answer. A third copy
disagrees the day a mode or a reveal rule moves, and a caret seated in unpainted text corrupts
silently, since the next read-back is browser-normalization-dependent. The node-space and DOM-space
answers are held together by a property test over one rendered fragment, not by convention. Two
set-scans: resolving hiding state either way (the DOM-read shapes: mode root, block-focus stamp,
construct stamp, marker-class selectors; or a call to the model's own rule) is allowlisted to the
two homes plus the readers asking a different question (ambient span identity, the preview-inline
reveal writer), and every file naming a marker class in code is manifested with its role, so a new
namer is a decision rather than a drift. The runtime backstop is the DEV parity probe
(`invariants/marker-css-parity.ts`): once per mode change, a probe span per family compares
`getComputedStyle` against the predicate's answer, standing down where no stylesheet computes; the
presentation e2e suite asserts it through the invariant-console gate.
`lint/hidden-run-classification.test.ts`.

**G4.31 · Affinity and pending-mark resets.** Edge affinity (the record of how the caret arrived at
a block edge, which decides which side of a hidden marker run a typed byte lands on) and the pending
marks (a format toggled at a collapsed caret, waiting to wrap the next typed character) are
ephemeral caret state with the same lifetime as the sticky column: an arrival sets them, a commit
invalidates them. So every file that calls `stickyColumn.reset()` clears the affinity at least as
often, and every `noteKey` capture site also calls one of the affinity's classifiers. There are
THREE capture entries, and the scan names all three: `note(e)` classifies a keydown, `noteTyping()`
pins the committed byte, and `noteExtreme()` says the caret was SEATED at an extreme rather than
stepped there (a range collapsing onto its own edge); the last one counts on both axes, since
settling a side also invalidates the marks riding it. The column paid for this parity at N minus 1
of N sites (G2.10); the affinity inherits the rule as a scan instead of at the next audit, because a
side that survives an edit is spent by the typing seat on the wrong byte. The marks take it one rung
higher: one construction composes them onto the affinity's invalidation, so the scan pins that
composition, forbids a clear at any seam of their own, and holds the set-equality list of seats that
spend them. The exception maps are empty by design; an entry is a stated hole.
`lint/edge-affinity-capture-reset.test.ts`.

**G4.32 · Inline-cache one spelling.** Every non-render consumer reads the inline tree through
`resolvedInlineContent`, so the resolver AND the signature travel together. The accessor keys one
sub-entry per signature space, so a caller that passes the resolver and drops the signature reads
the entry the render path didn't fill and answers with brackets where the screen shows a link, the
class that produced the bounds seam. The raw `getInlineContent` stays inside its own module; the one
allowlisted caller is the vertical-skip decision, whose resolver-less answer is its stated contract.
`lint/inline-cache-one-spelling.test.ts`.

**G4.33 · Live-rewrite verification.** The modules that build live-mode byte candidates each verify
through the render path's own `renderedText`, and every file naming an inline marker family in code
is manifested with what it does with it: only the model decides which spans a marker-hiding mode
DROPS; the rest create, identify or probe. The two registered seam slots (the split rebalancer, the
join cleaner) have exactly ONE reader, `node-ops`, so every destructive join crosses
`cleanJoinedRaw` rather than writing its own concatenation. The bug class here is a private walk
over the parse disagreeing with what paints. It counted an angle autolink's brackets as content
once, and a resolved reference's label the next time. Each verification also states WHICH reading it
takes: the block's own screen where the answer decides what a press may touch, or the content behind
every marker family where it's a before/after conservation diff, since chrome folds the moment
content arrives. The content reading carries a precondition, not a blanket license: a seam taking it
declines any side whose chrome PAINTS (live-mode.md § 4.1), or it reads bytes on screen as bytes
nobody saw and drops them. The two cut seams run off the DOM and answer that question from the
model, since a construct wrapping content-empty chrome paints its own delimiters too. The files
permitted to name `preDelete` at all are a closed allowlist, each with its reason; the fenced-code
surface is the one splicer outside the seam. `lint/live-rewrite-verification.test.ts`.

**G4.34 · Link byte-write seam.** The image seam's twin (G4.21), over the construct whose
destination the reader never sees: the GFM link serializer is named in code only inside
`link-source-bytes.ts`, and exactly the documented write paths name `buildLinkEditBytes` and
`buildLinkUnwrapBytes`. The serializer is module-private, so what the scan adds over the module
boundary is the CALLER set; a second write path is the shape that shipped for images. The seam also
verifies every candidate through the render path (G4.33): a destination that breaks its own
construct surfaces as literal source, which no walk over the parse can see. A link claimed by an
inline plugin kind is declined outright, there being no `rewriteLink` hook to re-serialize it.
`lint/link-bytes-write-seam.test.ts`.

**G4.35 · Stamp and revealable parity.** A construct whose marker spans carry a `data-construct-*`
stamp declares `revealable: true` in the inline-construct policy table, and every revealable kind
stamps. The stamp list is derived from `core/inline-render.ts` (which helper calls `tagConstruct`,
which `renderNode` case reaches it), so a stamp without a policy row reveals nothing and a policy
row without a stamp addresses nothing. For this scan an ABSENT row reads as `revealable: false`
(`?.revealable === true`), which is a scan rule, not a ruling on absent-row semantics: `escape`,
`hardLineBreak` and `autolink` all carry rows saying false (an autolink's `<` and `>` hide with the
block rather than by reveal, and its row is what seats a typed byte outside them), so an absent row
today means a kind with no declared live-mode behavior at all.
`lint/stamp-revealable-parity.test.ts`.

**G4.36 · Caret-write sites.** No module outside the named homes writes a caret position; G4.33's
twin over seats instead of bytes. A caret write is where a raw offset becomes a DOM seat, and every
home applies the landable clamp or forwards to one that does (the park entry and
`applyCollapsedCaret` hold the clamp; the rest forward), so a caller can't seat a caret behind a
hidden marker run and hand the typing seat a position no arrow walk produces. Five name-level
set-scans with per-file reasons and set equality: the `setRaw` namers (one per cursor backend),
`setToAmbientBoundary` (one home), the native `addRange`/`setBaseAndExtent` writers, the two
caret-write helpers (`setCursorOffset`, `restoreCaretAtWalkOffset`), and the surfaces building
`focus` from `caret-doors`' `placeCaret`. A new writer in any of the five lists is a lint
conversation, not a drift; the class arrived as site-by-site marker-string sweeps that didn't
converge until the count was closed. `lint/caret-write-doors.test.ts`.

**G4.37 · Content-empty stamp parity.** The files rendering a fragment into a contenteditable the
caret walk reads (`renderInlineNodes`, `renderCodeBlock`) are exactly the files stamping
`data-content-empty`. The three stamp sites are verbatim copies with no shared route, and G1.33
catches the missing stamp only when a caret parks into it in dev, so surface N+1 shipped unstamped
would paint a marker-only block as an empty line nobody can reach. Both lists are pinned, and the
files naming a renderer that mounts nothing carry a per-file reason.
`lint/content-empty-stamp-census.test.ts`.

**G4.38 · Insertion surface parity.** Every component mounting an editable surface
(`createEditableSurface`, `createEditableLeaf`) publishes `insertMarkdown` through the channel its
own mount reads: an instance export, or the surface literal it hands `publishRefSlot` where nothing
binds to the instance. The shared clipboard skeleton builds the method for all of them, but Svelte 5
instance exports have no spread and `BlockComponent` declares the method optional, so the last hop
is hand-written per component. Surface N+1 would compile clean and silently decline every
`editor.insertMarkdown()` on its blocks. `lint/insert-door-surface-parity.test.ts`.

**G4.39 · Command surface parity.** Every component mounting a command surface publishes
`runCommand` as an instance export. G4.38's twin over the semantic entry, with a population wider by
one signal: a component dispatching chords itself is a command surface even where no
editable-surface factory built it (the thematic break is `editable = false` and still takes
commands). `BlockComponent` declares the method optional, so surface N+1 would compile clean and
decline every `editor.runCommand()` on its blocks. `lint/command-door-surface-parity.test.ts`.

**G4.40 · Rewrite-claim set parity.** Three lists are one set: the ids the built-in keymaps bind to
a rewrite over one block's own selection, the ids the dispatch seam answers specially over a
cross-block range (`RANGE_DECLINED_COMMAND_IDS` declines, `CROSS_BLOCK_RANGE_COMMAND_IDS` routes to
the cross-block branch), and the chords `selection/cross-block/keydown.ts` claims, with each id on
exactly one of the two lists. Membership is the branch's shape, not the id's prefix, so the list
carries the non-`format.` members by hand; a prefix scan couldn't see `link.openCard`. A sixth
rewrite taught to one spelling is an N minus 1 gap at the other two; the swallow GROWING a chord is
caught by G4.29 instead, whose manifest records the key literals that file compares.
`test/selection/cross-block/rewrite-claim-parity.test.ts`.

**G4.41 · Warn-gate bypasses.** No file under `src/lib` mocks `dev-warn` or spies `console.warn`. A
mocked `devWarn` never reaches the structured sink, and a console spy reads a channel a registered
sink silences, so the fail-on-warn unit gate goes blind for that whole file and every guard firing
in it passes unnoticed. The one file whose subject IS a warning channel (`devWarn`'s console half)
is named in the scan's allowlist with the reason. `lint/warn-gate-bypass-census.test.ts`.

**G4.42 · Separator-write sites.** No module writes a sibling's `leadingTrivia` by hand. A splice
settles through the one route: `settleSeparator` at the commit ceremony, `spliceChildrenSettled`
under the path-addressed entries. The exemptions are head normalizations inside built subtrees, the
positional rotation in `reorder.ts`, and the three sites whose rule a splice window can't infer (the
gap-caret insert (a gap caret: the caret parked between two blocks where neither surface can host
one), the same-block range-delete write, the empty-marker sublist separator), each named with its
reason. `lint/separator-write-doors.test.ts`.

**G4.43 · Split-landing parity.** Every file naming `splitNode` reads `secondHalfIndex` and asserts
the landing through `assertSplitLanding`, and carries at least one assertion per split CALL, so a
caller growing a second split whose landing it re-derives fails too. G1.34's guard only fires where
a caller calls it, and a site seating its caret at `i + 1` never crosses it.
`lint/split-landing-parity.test.ts`.

**G4.44 · Live ranged-edit parity.** Every editable PROSE surface (an editable-surface factory, its
own `beforeinput`, and a read of the inline-construct policy table) resolves native ranged edits
through `components/blocks/text/live-selection-edit.ts :: resolveLiveRangeEdit`, and no other file
calls it. A destructive input carries the range it will rewrite on the EVENT (`getTargetRanges()`),
not in the selection, so a surface reading only its live selection sees nothing at a collapsed
caret: word, line and drag deletes reached the bytes natively and cut through delimiter runs the
reader never saw. The fenced-code surface is outside the set for a reason the scan can see: its body
holds no inline constructs to strand. `lint/live-ranged-edit-parity.test.ts`.

**G4.45 · Settle coverage for bare tree ops.** The bare tree-op primitives (`splitNode`,
`deleteNode`, the three merge entries) splice a body without settling it, so every file importing
one is declared with the commit whose settle covers its writes, and each is asserted to reach a
commit entry or a settle entry. Keyed on the IMPORT, so an alias still enrolls its file and a
same-named action-bundle method doesn't. The tail rule (GH #168) lives in the settle: a caller
outside the commit ceremony leaves it unrun and the document one folded line short of its own
reload, silently, since the bytes still round-trip. `lint/settle-funnel-callers.test.ts`.

**G4.46 · Ancestry fold-sink stance.** `rebuildUnsharedChain` and `rebuildUnsharedAncestry` take a
required-nullable `folds` sink, and a fold splices the PARENT's children, so passing a sink is the
claim "I can reconcile that scope's ids and refs" and `null` is an explicit decline. The type stops
an omission but not caller N+1 answering `null` because reconciling was inconvenient, and a wrong id
length is permanent. Every production call site is enumerated with the stance it takes and why, so a
new caller fails the gate the day it's born. `lint/ancestry-fold-sink-thread.test.ts`.

**G4.47 · Editing-host readers.** Every `[contenteditable]` selector read and every
`document.activeElement` identity read routes through the host-aware predicate or declares its own
answer with the reason. The hidden host is a real contenteditable that paints nothing, so a selector
read excluding it, or a focus comparison by identity, answers for the wrong element while every byte
still round-trips: a wrong hit-test endpoint, a tab stop with no input entry. Two of the three
spellings are scanned; dispatch-target identity is probed-benign and not enumerable.
`lint/whole-block-host-readers.test.ts`.

**G4.48 · Wall-clock budgets.** An absolute `performance.now` or `Date.now` budget in a behavior
suite is machine-speed-dependent and reds on a loaded host, so outside the perf projects every
wall-clock budget goes through the growth harness, where `measureScanGrowth`'s N-vs-4N ratio cancels
the machine. Allowlisted residue carries its reason: the harness itself, a recursion-depth bound, an
elapsed-time check a ratio can't express. `lint/wall-clock-budgets.test.ts`.

**G4.49 · The shared IME driver.** A spec constructing a `CompositionEvent` or an
`insertCompositionText` input event by hand exercises a browser no user has, so hand-fired sequences
fail the scan. The driver file is the one exemption (WebKit exposes no CDP session, so its branch
has nowhere else to live), and the scan pins the hand-fired shape to that file EXACTLY, so a widened
exemption and a deleted WebKit branch each fail. `e2e/lint/composition-driver.test.ts`.

**G4.50 · Cross-block-range classification.** Every block command id either joins the range-declined
set, joins the set with a cross-block branch, or is recorded range-safe with its reason. Membership
is hand-maintained, and the decline is the only thing keeping a rebind or the `runCommand` entry
from spending one block's offsets against a painted multi-block range, so an id classified nowhere
fails the day it's minted. `lint/range-command-census.test.ts`.

**G4.51 · Debounced-checkpoint pairing.** A file pushing a typing checkpoint also arms the pause
window. The two halves sit at different points in the keystroke on purpose (the arm follows the
settle), so a push with no arm leaves a batch no pause can end, every later keystroke joins it, and
one Ctrl+Z unwinds the session. `lint/debounced-checkpoint-pairing.test.ts`.

**G4.52 · Content-version announcements.** The version is ANNOUNCED at each place that writes the
document bytes, never derived from a walk of the tree, so the announcements are a declared set, and
the shape an out-of-ceremony write has (unsharing a spine off the editor's own `deps.doc`) enrols
its file. The commit ceremony covers every structural writer under it; the routine-typing writes,
the history swap and the `source` prop swap answer for themselves. A silent write site serves every
whole-document memo a stale answer with nothing failing. `lint/content-version-doors.test.ts`.

**G4.53 · Descriptor-field roster.** `BlockKindDescriptor` and the field reference table in
`docs/design/plugin-contract.md` are one set, both directions, keyed on the field-name column alone
so the prose columns stay rewritable. The registration shape freezes at 1.0, which makes the
published table the inventory of what froze: a field landing undocumented and a row outliving its
field are the two ways it stops being one. The manifest the scan reads is complete by compile error
(`schema/block-kind-descriptor.ts :: DESCRIPTOR_FIELDS`), so the scan never has to parse the type.
`lint/descriptor-field-census.test.ts`.

**G4.54 · Entry barrels are import sinks.** No module in a published entry's own import closure may
import that entry back. Rollup assigns the two sides of such a re-export cycle to different chunks
and warns that execution order will break, and only a consumer's bundler ever sees it, because
in-repo `$lib` resolves to source and assigns no chunks at all. The entry list derives from
package.json `exports`, so a new published subpath inherits the rule unasked.
`lint/entry-barrel-sink.test.ts`.

**G4.55 · The package name.** Docs name the package `@voithos-labs/aragonite`, never the bare
`aragonite`, which belongs to an unrelated npm package. `docs/changelog/` is exempt, since it
records what shipped under the name of the day. `lint/doc-package-name.test.ts`.

**G4.56 · Iterative walks.** No function under `core/inline/`, `cursor/`, `ambient/` or
`components/blocks/text/` that reads a node's `children` or `childNodes` may sit on a call cycle,
its own included. Inline nesting depth is input-controlled (`**` nests one construct per pair), so a
per-level stack frame overflows and strands the block in the failed-block fallback, which can't
heal. The renderer and the offset walk took explicit stacks for exactly that reason, and four walks
one call later didn't, which voided the protection (#200). The scan reads brace-matched bodies
through the literal-aware walk, so a `{` or a call inside a string can't move the boundary it reads;
it resolves a call to EVERY declaration bearing that name and tracks reachability per declaration,
so a file spelling two walkers alike can't hide the recursive one behind the iterative one, and a
second assertion fails that repeated spelling outright, which is what makes the exception map's
`path :: name` key address one walk. The map is EMPTY by design; an entry is a stated overflow. The
join seam's `clipNodes` REBUILDS a tree rather than reading one and still routes through the same
pre-order, since a construct the cut crosses hands its place to its own clipped children (#226).
`lint/inline-walk-iterative.test.ts`.

**G4.57 · The lexer differential.** The source-scan lexer is held against TypeScript's: every
character of each scanned `.ts` file and each `.svelte` script block is classified
comment/string/template/regex/code by `spanAt` and by a `createSourceFile` plus rescanning-scanner
reference, and the two must agree. Two corpora: the repo-wide roots, and the wider one the test-tree
scans lex. Sixty-odd scans read code through that lexer, so a literal it misreads shrinks their
populations at once with nothing red, which is how a regex-blind walk and a `}`-opens-a-regex rule
both shipped. The differential also pins `stripComments` to the same reading, so the guard can't
drift onto a lexer no scan uses. TypeScript can't lex markup, so the `.svelte` markup half is pinned
against a corpus instead, and the two shapes there that record a simplification rather than the
truth say why no scan can move on one. `lint/scan-source.differential.test.ts`.

**G4.58 · Commit-message shape.** One rule, two enforcement points:
`scripts/lint-commit-message.mjs` holds the only definition of the enforced subject shape, and both
the `commit-msg` hook (`.githooks/`, wired by the `prepare` script) and a step in CI's `unit` job
over a pull request's own commits call it. Line 1 carries the whole summary within 72 characters,
because `git log --oneline` and every other `%s` reader join a multi-line first paragraph into one
line, so per-change lines belong in the body, below a blank line. Documented-only, the cap drifted
to a 1,499-character subject across a majority of the history, which is the enforcement ladder's
prediction rather than a surprise. The two-points half of the guard is what keeps the rule from
surviving as prose again: it reads the `prepare` wiring, the hook, and the CI step.
`lint/commit-message-shape.test.ts`.

**G4.59 · The VR tag roster.** The windowing-hazard catalog in `docs/design/virtual-rendering.md`
and the tags cited under `src/` are one set, both directions, keyed on the tag column alone so the
hazard prose stays rewritable. A cited tag with no row sends its reader nowhere, and a row nothing
cites is the one the catalog's own text says to delete. The corpus is the library, its styles and
its e2e requirement files, read as raw text rather than through the house comment-stripping lexer,
since a citation is almost always a comment and that lexer erases exactly the population this scan
counts. `lint/vr-tag-census.test.ts`.

**G4.60 · Spread-into-call declarations.** Every spread into a call's ARGUMENT LIST in shipped
source is declared with what bounds its count. A spread hands the engine one argument per element,
and a list past its limit raises "Maximum call stack size exceeded" at the call, which strands the
operation with nothing rendered (#246). A declaration is one of two modes: a `bounded` site names
the ceiling its count can't pass (a literal group, `MAX_UNDO`, the parser's nesting cap), and a
`gap` site says the count follows the document, which is the honest reading for the splice family
under `tree-operations/` that a paste scales. Array-literal spread (`[...x]`) has no argument list
and is out of scope; a rest parameter names one array and never grows a call, so the scan reads the
`function` keyword before and the body or arrow after to tell the two apart. Hand enumeration is
what this replaces: the fix that closed the first three sites missed a fourth in its own file.
`lint/spread-call-census.test.ts`.

## Accessibility

Target: WCAG 2.1 AA, enforced by an `@axe-core/playwright` baseline gate (`test:e2e:a11y`, part of
`npm test`). axe runs over `.editor` across representative states (default content, an active
cross-block selection, the failed-block fallback, a blocked-scheme link) and fails on any violation
whose rule id isn't in the committed allowlist (`src/lib/e2e/a11y/axe-baseline.json`).

That allowlist is the executable, milestone-tied log of deferred AA work (contrast rides the
CSS-ownership migration; per-block accessible names and the focusable thematic-break separator land
at 1.1) and it **only shrinks**. The cross-block selection is overlay-painted with native selection
suppressed, so assistive tech can't otherwise see it; it's exposed through a visually-hidden
`aria-live` region fed by the pure `createSelectionDescription` builder.
