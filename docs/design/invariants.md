# Editor invariants

Most rules in a codebase are preferences. A handful of the ones here will cost somebody their file,
and this doc is the list of that second kind.

Three examples. A container's raw never disagrees with its children. A block's DOM text equals its
ambient prefix plus its raw bytes. Every block kind has a descriptor. Break one of those and nothing
shouts at you. The damage shows up three layers downstream, in a component that did nothing wrong,
hours after the commit that caused it, and by then good luck.

So every rule of that kind gets a **G-number**, a place where it's checked, and something that fails
when it breaks. The aim is that a violation fails **loudly** (you see it) and **locally** (at the
code that broke it, not the poor code that noticed).

Before anything else, the words the catalog leans on, each glossed once here (if you know them, skip
ahead):

- **raw**: a node's verbatim source bytes, markers included.
- **kind**: the string on a node that says what block it is.
- **descriptor**: the per-kind metadata record: how the kind merges, edits, renders.
- **opener**: the part of the parser that recognizes the syntax a block starts with.
- **chrome**: the parts of a block that are furniture rather than content (a title row, a table
  border).
- **ambient prefix**: the read-only marker a container lends its first child (a list's `- `).
- **scope**: one block list and its children; the unit of addressing and windowing.
- **path**: the child indices from the document root down to a block.
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

| Level               | Means                                              | You'll find it in               |
| ------------------- | -------------------------------------------------- | ------------------------------- |
| **Unrepresentable** | The compiler rejects the violation. Nothing to run | Group 3                         |
| **Guarded**         | A check fires where it breaks, in dev or in CI     | Groups 1, 2, 4                  |
| **Documented**      | Prose plus per-instance regression tests           | The `D` code (rare, on purpose) |

Prose is the last resort. Whenever you touch a rule, ask whether it can move up a level.

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
        where it can break         (imports the predicate directly)
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

`assertInvariant` lives in `src/lib/assert.ts`, a dependency-free file every subsystem can import.
It's dev-only and it **never throws**, because a false positive mustn't crash a real editor; in
production it returns before calling the predicate. Scope a per-commit check to the nodes the commit
touched, never the whole document, or it stops being safe on a 10 MB file.

That `[aragonite:invariant:<tag>]` string is what every gate watches
(`docs/contributing/warnings.md` § What fails on what has the list). One of them gets a name here:
the shared e2e `test` fixture (`src/lib/e2e/fixtures.ts`), which fails any spec whose page emits a
fire, is the **e2e invariant watcher** the entries below lean on. A spec whose subject is a fire
declares it (`test.use({ expectInvariants: [tag] })`), and then the fire must arrive. No
`invariant:` fire may be waived run-wide; `docs/contributing/warnings.md` § Claiming a fire in a
unit test lists the local ways, narrowest first.

### Where the shape doesn't hold, and why

A minority of runtime guards are inline closures where their machinery runs, not shared predicates:
G1.15, the five commit-and-parse guards G1.19 through G1.23, and the interaction halves of G1.26.
What they check isn't a CST node's shape but a transient value the machinery builds mid-flight (a
prepared commit scope, an unshare chain, an owned table view, an in-flight reveal). Those exist only
mid-commit, mid-parse or mid-gesture. There's no stable object to hand a pure predicate, and no way for a test to reconstruct
the exact state on its own.

So they're tested through the machinery that produces them (G1.15's tests drive the real
`parse()`), or netted by the e2e invariant watcher, which for G1.19 through G1.23 and two of G1.26's
halves is the whole net.

The rule of thumb: **if a test can construct the subject, the predicate is shared.** If only the
machinery can, the guard lives where the machinery is.

## Adding a guard, retiring a guard

The catalog is a convention anyone extends, so here's the whole procedure:

1. Ask how high the contract can climb. If a type can make the violation impossible, write the type
   and claim a Group 3 number; the runtime check you didn't have to write is the best kind (G1.3
   died this way, happily).
2. Otherwise pick the group by where the check can run: Group 1 if the running editor sees the
   violation, Group 2 if only a test can, Group 4 if the rule is a pattern in the source text. A
   Group 4 scan lands in `test/invariants/lint/`, or in `e2e/lint/` if it scans the e2e tree.
3. Claim the next free number in that group. Numbers are never reused, so an old citation in git
   history keeps meaning what it meant. That's also why the tables have holes: changes built in
   parallel claim their numbers up front, and a claim that never lands leaves its number unused.
4. If a test can construct the subject, write the predicate in `src/lib/invariants/` (pure: node in,
   violation or null out, the `checkStaleRaw` shape above) and wire both consumers: the DEV
   assertion where the violation happens, through `assertInvariant`, and a property or negative test
   in `src/lib/test/invariants/` that imports the predicate directly. If only the machinery can
   construct the subject, write the guard inline where that machinery runs and let the e2e invariant
   watcher net it.
5. Add the row to the group's index table and the entry below it. The row is one line a person can
   read cold; the entry carries where it runs, the predicate, the tests, and whatever nuance will
   bite the next person.
6. Cite the G-number from the guard and its tests, so a grep for the id lands here and at the code
   in one pass.

Retiring one: G1.3 is the pattern. When a stronger level makes a check redundant, delete the guard
and its tests, and keep the number. The row stays, marked retired, saying what superseded it.

## Reading the catalog

Enforcement codes, used in every index table: `A` runtime DEV assertion · `P` property test
(fast-check) · `N` negative fixture · `T` compile-time type guard · `L` lint/source-scan · `D` doc.

Predicates live in `src/lib/invariants/`; property tests and their arbitraries (the random-CST
generators fast-check draws from) in `src/lib/test/invariants/`, run by
`npm run test:editor:invariants`. A path below is relative to `src/lib/` unless it starts with
`src/`, `docs/` or `scripts/`. The catalog references files, never line numbers.

One standing rule about the predicate directory: no `invariants/` module takes a runtime
dependency on `selection/` (a type import is fine). The Group 2 predicates are test-only too, and
never exported through `src/lib/index.ts`.

Each group below is a short index table, then one prose entry per id. The row tells you whether you
care, and the entry tells you everything the row compressed.

## Group 1: runtime checked

These checks run in three kinds of place:

- **The commit primitive**: `invariants/install.ts :: assertCommittedNodes`, invoked from
  `editor-actions/commit/undo-controller.ts` after each commit's raw rebuild. Anything shaped like
  "a committed node is coherent" runs here.
- **Bootstrap**: the registration-check flush (`schema/registration-checks.ts`), first at Editor
  mount via `runStartupInvariantChecks`, then at the next mount or grammar read
  (`getOrderedOpeners`), never mid-batch, so forward references inside one registration batch stay
  quiet. Registry completeness (G1.2) checks built-ins only, since a plugin's component may register
  on its own schedule.
- **Its own machinery**: the guard fires inside the code it protects. One exception: G1.33 fires in
  the editor root's focus handler (`components/editor-root-focus.ts`), above every caret entry, so a
  consumer's own caret component inherits it.

| ID    | What stays true                                                                            | Codes   |
| ----- | ------------------------------------------------------------------------------------------ | ------- |
| G1.1  | A strip container's raw and metadata never go stale against its children and bytes         | A·P·N·D |
| G1.2  | Every block kind has a descriptor and a component                                          | A·P     |
| G1.3  | _Retired upward_: container-iff-rebuildRaw is now unrepresentable                          | T       |
| G1.4  | No container publishes the undo-history context key                                        | A·L·N   |
| G1.5  | Leaf fields on leaves, container fields on containers                                      | A·P·N   |
| G1.6  | `cloneMetadata` hands back a genuinely independent copy                                    | A·P     |
| G1.7  | Metadata writes that drive raw go through `updateBlockMetadata`                            | A·N     |
| G1.8  | `getContentRange` is well-formed for every kind that has one                               | A·P·N   |
| G1.9  | No mutation writes bytes through a node an undo entry shares                               | T·A·P·N |
| G1.10 | Every opener's kind has a descriptor; opener priorities are unique                         | A·N     |
| G1.11 | Every keymap chord is unique per kind and names a known command                            | A·N     |
| G1.12 | An opaque container's raw still reparses to its live children and metadata                 | A·N     |
| G1.13 | An opaque `rebuildRaw` is deterministic over committed state                               | A·N     |
| G1.14 | A container declaring `reservedChrome` holds its chrome leaf at child 0                    | A·N     |
| G1.15 | A plugin opener claims at least one line, and its raw matches the lines it consumed        | A·N     |
| G1.16 | Every coordinate a commit declares is document-absolute                                    | A·N     |
| G1.17 | An opener registered after the grammar was read warns                                      | A·N     |
| G1.18 | A container's `reservedChrome` names a fully registered chrome kind                        | A·N     |
| G1.19 | A commit scope's declared path still resolves to its captured node                         | A       |
| G1.20 | An unshared chain is as deep as the path it was asked for                                  | A       |
| G1.21 | A column edit's row scopes are the owned table's own children                              | A       |
| G1.22 | Every index on an unshare path addresses a live child                                      | A       |
| G1.23 | Decoration sources never run mid-commit                                                    | A       |
| G1.24 | A kind's closure block agrees with the rest of its descriptor                              | A·N     |
| G1.25 | Widget-pool acquires happen only inside an open render pass                                | A·N     |
| G1.26 | A fold implies an active reveal, and an open reveal blocks command mutation                | A·N     |
| G1.27 | `compositionend` lands only inside a composition the surface saw start                     | A·N     |
| G1.28 | A code block's render and a painted leaf source carry the block's bytes exactly            | A·N     |
| G1.29 | A selection endpoint's offset means what its own block's coordinate space says             | A·N     |
| G1.30 | Every registered kind declares a `mergeRole` from the known set                            | A·N     |
| G1.31 | The inline-construct policy table is coherent and unambiguous                              | A·N     |
| G1.32 | _Retired upward_: a content-start Backspace with no range no longer compiles               | T       |
| G1.33 | A block the caret is placed in paints at least one position a caret can land on            | A·N     |
| G1.34 | _Retired_: a split's landing reads the index `splitNode` returned (G4.43)                  | L       |
| G1.35 | A slot that holds exactly one node never takes bytes that reparse to several               | A·N     |
| G1.36 | A structural change fits the arrays it syncs; ids stay in lockstep with children           | A·N     |
| G1.37 | A kind whose syntax its container owns registers no opener                                 | A·N     |
| G1.38 | A spliced container raw equals what a full rebuild would write                             | A·P·N   |
| G1.39 | At most one caret the editor draws shows at a time                                         | L       |
| G1.40 | Every built-in kind declares its page role and its height estimate                         | A·N     |
| G1.41 | A structural edit keeps the final break as it was (a blank last line keeps its own)        | A·P·N   |
| G1.42 | A list item's checkbox and blocks are what its reload reads                                | A·N     |
| G1.43 | Reading a commit's landing moves no caret                                                  | A·N     |
| G1.44 | The document holds a block, and a commit leaves no container it touched empty              | A·N     |
| G1.45 | A caret landing's focus scrolls nothing                                                    | A·N     |
| G1.46 | A caret or range the editor puts down leaves no widget selected whole                      | A·N     |
| G1.47 | A windowed child measures into its own block list                                          | A·N     |
| G1.52 | The text `getSource()` serves for an unchanged content version is the document             | A·N     |
| G1.53 | _Retired_: a stale write is refused quietly at the write gate, with nothing left to assert | none    |
| G1.54 | A commit's mutation leaves the tree's own top-level array as it found it                   | A·N     |
| G1.55 | A top-level container an edit rebuilt reads back, on its own, as the tree it holds         | A·N     |
| G1.58 | An indent key over a range keeps every word it holds, in order                             | A·N     |
| G1.61 | A list move keeps the order its text reads in                                              | A·P·N   |
| G1.71 | A command key over a range runs in the kind of block whose keymap claimed it               | A·N     |
| G1.75 | No selection endpoint the editor writes sits after an empty block's placeholder `<br>`     | A·N     |
| G1.76 | The drawn caret sits on its caret until the caret moves                                    | A       |
| G1.77 | The mark hiding the browser's caret is on exactly the editable the drawn caret draws for   | A       |

### The entries

**G1.1 · Container raw not stale.** A strip container's bytes, reparsed, come back as a single block
whose stripped inner bytes equal `serialize(children)`, and every strip container's metadata (this
one's and each nested one's) is what that reparse gives it, through the compare G1.12 uses
(`metadata-parity.ts`). The check is byte-level on purpose: an empty container's placeholder
paragraph and the parser's trailing-blank trivia serialize the same, so don't re-tighten it to a
structural tree compare, which false-fires on every empty list item and trailing blank `>` line. A
metadata key no reparse would give (one written through `updateBlockMetadata` for its own sake)
fires too. Non-strip containers are exempt, grid outright and opaque via G1.12 and G1.13. Predicate
`checkStaleRaw` (`node-shape.ts`) · commit primitive · `stale-raw.test.ts`,
`strip-stale-metadata.test.ts`.

**G1.2 · Registry completeness.** Every `BlockKind` resolves to a descriptor and a component, the
kinds enumerated from the union-derived manifest (`core/nodes.ts :: BLOCK_KIND_TABLE`,
`ALL_BLOCK_KINDS`). The one exemption is `listItem`, which renders inside its `ListBlock` and has no
component of its own (`NO_STANDALONE_COMPONENT`). Predicate `checkRegistryCompleteness`
(`registry.ts`) · bootstrap · `registry.test.ts`.

**G1.3 · Retired upward.** The rule was: `isContainer` iff `rebuildRaw`. The grouped registration
shape (G3.6) derives `isContainer` from the `container` group, whose `rebuildRaw` is required, so
the pairing violation became unrepresentable, and the runtime guard and its tests are deleted.
Superseded by G3.6 (`BlockKindRegistration`).

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
G1.1 is the runtime backstop for a bypass. Test `test/editor-actions/update-block-metadata.test.ts`.

**G1.8 · Well-formed content ranges.** `getContentRange` is well-formed for every kind that has one:
the prose kinds, plus any non-prose kind declaring its own (the directive leaf does), because the
range is consumed without asking `supportsInline` first. Predicate `checkContentRange`
(`descriptor.ts`) · commit primitive · `descriptor.test.ts`.

**G1.9 · Snapshot aliasing.** No mutation writes serialized bytes through a node an undo/redo entry
shares; moving a shared node within the live tree is fine. Most of the rule is a type: readers and
plugins hold bytes-readonly views (`core/node-views.ts`, G3.8), and G4.13 guards the casts that
would strip one. A writer copies the path first and re-reads the copy through the `$state` tree
(the header of `tree-operations/unshare.ts` has the full statement). The table rebuild is the one
container rebuild that writes its children's bytes, and only to a row an edit already copied. The
DEV check stays because runtime JS bypasses types; its digest hashes every node's bytes, not just
the top-level ones. Predicate `checkSnapshotIntegrity` (`snapshot-integrity.ts`) · commit primitive
(top undo entry) plus undo/redo restore (`editor-actions/commit/history.ts`) ·
`snapshot-integrity.test.ts`, `test/undo/undo-restoration.property.test.ts`.

The **commit-rollback companion** lives here too: a commit mutation that throws leaves the undo/redo
stacks byte-identical to before (restored through `UndoManager.restoreStacks`) and publishes no
partial tree, emits `error{origin:'commit'}`, then re-throws in DEV and swallows in production. The
tree comes back because the commit keeps the top-level array it started from, and copy-path-on-write
leaves that array reaching an intact tree. A container scope already copied earlier in the same
undo step gets no fresh copy, so the commit also saves each container scope's children and child-id
arrays and puts them back on a throw. One residual is open by design: in such a scope, a byte write
deeper than an owned node's direct children, metadata below them, or a byte write to a top-level
block the undo step already owns stays written after a throw. Only an internal malformed-change bug
reaches it, and DEV re-throws. Covered by
`test/editor-actions/commit/commit-rollback.test.ts` and `commit-rollback-bytes.test.ts`.

**G1.10 · Opener-registry coherence.** Every opener's kind has a descriptor, and opener priorities
are unique. Predicate `checkOpenerRegistry` (`registry.ts`) · bootstrap · `opener-registry.test.ts`.

**G1.11 · Keymap coherence.** Every keymap chord names a known command id, and chords are unique
per kind. A malformed chord throws earlier, at `registerBlockKind` or `augmentBlockKind`, in every
build; the command check waits for bootstrap because a plugin can register its kind before the
command its keymap binds. Predicate `checkKeymapCoherence` (`registry.ts`) · bootstrap ·
`keymap-coherence.test.ts`.

**G1.12 · Opaque container raw not stale.** An opaque container's raw reparses to children that
byte-match the live ones (chrome compared by position for `reservedChrome` declarers), and every
metadata key matches the reparse through `metadata-parity.ts`, so a rebuild route that skips the
re-read fires at the next commit that checks the container. When the raw no longer reparses to one
block of its own kind, a kind with a recognizer of its own (an opener, or a directive) fires, and a
kind with none is skipped. Predicate `checkOpaqueStaleRaw` (`node-shape.ts`) · commit primitive ·
`opaque-contract.test.ts`, `opaque-stale-raw-directive.test.ts`, `opaque-stale-metadata.test.ts`.

**G1.13 · Opaque rebuild determinism.** `rebuildRaw` is deterministic over committed state, checked
probe-vs-probe: run it twice, require the same bytes. Predicate `checkOpaqueRebuildDeterminism`
(`node-shape.ts`) · commit primitive · `opaque-rebuild-determinism.test.ts`.

**G1.14 · Reserved-chrome slot.** A container declaring `reservedChrome` holds a chrome leaf of the
declared kind at child 0; kinds with no declaration are exempt. Predicate `checkReservedChromeSlot`
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

**G1.17 · No late opener.** An opener registered after the grammar was read warns: parsed documents
never re-parse, so the kind would miss every open document. Register before the first editor
mounts. Predicate `checkLateOpenerRegistration` (`registry.ts`) · bootstrap ·
`test/schema/registration-checks.test.ts`.

**G1.18 · Reserved-chrome coherence.** The chrome kind a container's `reservedChrome` names (its
title row) resolves to a descriptor and a component, both registered by `registerChromeLeaf`. The
bootstrap counterpart to G1.14's per-commit slot check. Predicate `checkReservedChromeCoherence`
(`registry.ts`) · bootstrap · `reserved-chrome-coherence.test.ts`,
`test/schema/registration-checks.test.ts`.

**G1.19 · Multi-scope commit path.** A scope's declared path still resolves to its captured node,
checked over all scopes _before_ any spine is copied, since a stale-but-in-range path would copy and
rebuild the wrong spine. Inline closure, watcher-netted. In `editor-actions/commit/undo-controller.ts`.

**G1.20 · Unshared-spine depth.** The chain the keystroke's in-place write copies is as deep as
the leaf path it was given; a short chain means the write would change a node it doesn't own, so it
writes nothing. Inline closure, watcher-netted. In `editor-actions/leaf-write.ts`.

**G1.21 · Column-scope alignment.** Each row scope in a column edit IS the corresponding child of
the owned table, so the id/ref sync lands on the rows the splice actually walked. Its tag is
`column-scope-alignment`. Inline closure, watcher-netted. In `editor-actions/table-context.ts`.

**G1.22 · Unshare path in range.** Every index on an unshare path addresses a live child; an
out-of-range index silently truncates the chain. Inline closure, watcher-netted. In
`tree-operations/unshare.ts :: ensureUnsharedPath`.

**G1.23 · No decoration sources mid-commit.** A decoration source running mid-commit would read a
half-written tree, so `notifyEdit` and `runAll` assert no commit is open, and a source handle's
`invalidate()` waits until the last one ends. The commit helper opens and closes the scope in
`invariants/commit-scope.ts`. Inline closure, watcher-netted. In
`decorations/decoration-state.svelte.ts`.

**G1.24 · Closure-block coherence.** A kind's required closure block (its written answer to every
cross-cutting editor system) agrees with the rest of its descriptor: a container can't claim
`roundTrip: inherit-default` (its `rebuildRaw` IS its round trip), a `not-mergeable` kind can't
claim `mergeBackspace: inherit-default`, a cell claiming focus-then-delete needs
`blockFocus: 'whole-block'`, and a `reservedChrome` declarer can't leave
`clipboard: inherit-default`. A declared `conformanceFixture` must parse to a tree containing its
kind; that rule runs in the unit sweep, since a `parse` import in the flush would close an import
cycle. Predicate `checkClosureCoherence` (`registry.ts`) · bootstrap (registration rules) plus the
unit sweep (fixture rule) · `closure-coherence.test.ts`, `closure-fixtures.test.ts`.

**G1.25 · Widget-pool pass bracket.** Inline widgets (the rendered stand-ins for inline constructs)
are recycled through a pool, one bracket per render pass: every `acquire` sits inside an open
`beginPass`/`sweep` bracket, `beginPass` never opens over an unswept pass, and `sweep` never closes
one that isn't open. Outside a bracket, byte-identical duplicate widgets can't be told apart.
Predicate `checkPoolBracket` (`inline-transitions.ts`) · run in `components/blocks/widget-portal.ts` ·
`inline-transitions.test.ts`, `test/blocks/widget-portal-bracket.test.ts`.

**G1.26 · Reveal transition legality.** A reveal swaps a rendered inline construct for its editable
source in temporary DOM, and the fold swaps it back, committing or discarding what was typed. **No
fold without a reveal**: `commitReveal`, `cancelReveal` and `foldRevealNoEdit` run only with an
active reveal, so a fire is a caller that skipped its pre-guard. **No mutation with a reveal**
(`command-during-reveal`): a block's command dispatch never mutates while a reveal is open, since
the reveal holds bytes the CST hasn't seen; a fire is a command entry path that skipped the fold.
`startReveal` is also never re-entered inside the reveal's own microtask-long settle window, and the
source-length precondition holds at reveal entry. Legal bails (blur with no reveal, a blur during a
cross-block selection that keeps the source shown, entry while one is active) stay silent. Inline
closures in `components/blocks/text/widget-interaction.ts` (the fold halves) and
`components/blocks/text/TextEditableBlock.svelte :: performBlockCommand` (the mutation half), plus
`checkRevealSourceLength` (`inline-transitions.ts`) at `caret/reveal-source.ts` ·
`test/blocks/text/widget-reveal-transitions.test.ts`.

**G1.27 · Composition window.** `compositionend` lands only inside a composition the surface saw
start. An unpaired end means `compositionend` was wired without `compositionstart`, and every
composed keystroke committed mid-IME. Predicate `checkCompositionEndPaired`
(`inline-transitions.ts`) · run in `components/blocks/editable-surface.ts :: onCompositionEnd` ·
`inline-transitions.test.ts`, `test/blocks/editable-surface-composition.test.ts`.

**G1.28 · Rendered text fidelity.** A code block's rendered fragment carries the block's bytes
exactly (`textContent === trimTrailingLineEnding(raw)`), because the body goes through
`template.innerHTML`, whose normalizations (a dropped U+0000, say) could eat a byte the block reads
back on the next keystroke. A painted editable-leaf source is held to the same equality, whatever
plugin painted it, since the fold commits `textContent` on blur. Predicate
`checkRenderedTextFidelity` (`render-fidelity.ts`) · run in
`components/blocks/code/code-renderer.ts :: renderCodeBlock` and
`components/blocks/editable-leaf.ts :: paintSource` · `render-fidelity.test.ts`,
`test/blocks/editable-leaf-painted-fidelity.test.ts`.

**G1.29 · Selection endpoint coordinates.** An endpoint's offset means what its own block's
coordinate space says. On a table that's a cell index inside the grid, and the point says so with
`cellCoordinate: true` (every point on a table path, a rectangle's corners included); readers trust
the flag, so a bare offset there makes copy slice the table as text. A cell index on a block with no
cells fires too. Every other endpoint lands inside its block's raw, and in a kind with no character
positions (childless `blockFocus: 'whole-block'`) on one of its two ends. Clamp cell indices with
`src/lib/schema/block-kind-descriptor.ts :: clampCellIndex`; which blocks count cells is
`src/lib/schema/block-kind-descriptor.ts :: countsCells` (tables only for now; a plugin grid's
endpoints stay deep `[grid, row, col]` paths with character offsets). Predicate
`checkCrossBlockEndpointCoordinates` (`selection-endpoints.ts`) · run in
`selection/selection-state.svelte.ts :: enterCrossBlock` and `extendFocus`, the only two ways a pair
gets stored · `selection-endpoint-coordinates.test.ts`.

**G1.30 · Merge-role vocabulary.** Every registered kind declares a `mergeRole` from the known set;
an unknown role makes the merge dispatcher fall through silently on every gesture that reaches the
kind. Predicate `checkMergeRoleVocabulary` (`registry.ts`) · bootstrap · `category-fields.test.ts`.

**G1.31 · Inline-construct policy coherence.** The inline-construct policy table (one row per inline
kind: how it splits, unwraps, reveals) is coherent: a row names a kind the inline vocabulary holds
(a typo just keeps the absent-row defaults), the marker-rewriting behaviors (the `close-and-reopen`
split, the empty auto-unwrap) belong only to a revealable kind, no two mark rows claim one nesting
rank or one command, and a plugin row's mark may not claim a built-in command id (also refused
outright at `schema/inline-construct-policy.ts` registration). Checked at the editor-mount flush
only, since the policy's function hooks load with the component layer. Predicate
`checkInlineConstructPolicy` (`registry.ts`) · mount (`invariants/install.ts ::
runStartupInvariantChecks`) · `inline-construct-policy-coherence.test.ts`,
`test/schema/inline-construct-policy.test.ts`.

**G1.32 · Retired upward.** The rule was: a kind declaring `contentStartBackspace` also declares
`getContentRange`, since without the range its content starts at raw 0 and the demote never fires.
A registration now declares the two as one group, `contentStart: { range, backspace? }`, with the
range required, so the runtime guard and its test are deleted. Superseded by G3.10.

**G1.33 · The caret can land.** A block a caret is placed in, under an editable marker-hiding mode
(live, preview-inline), paints at least one position a caret can land on. A surface whose every byte
is a hidden marker run takes the next keystroke between `display:none` spans, on whichever side the
engine picks (a typed `#` once came back as `a#`). Built-ins hold by construction (chrome standing
over no content paints; `docs/design/live-mode.md` § 4.1), so this is for a plugin surface building
its own marker chrome. It fires from the editor root's `focusin`, once per focus arrival, so a caret
component a consumer owns inherits it; reading mode is out of scope. Predicate `checkLandableCaret`
(`landable-caret.ts`) · `components/editor-root-focus.ts` · `landable-caret.test.ts`,
`landable-caret-doors.test.ts`.

**G1.34 · Retired.** The rule was: the index a split's caret lands on is the one `splitNode`
returned, never a re-derived `blockIndex + 1`. The guard could never fire (it compared the split's
answer with itself). A split now builds its landing from `SplitResult.secondHalfIndex`, and G4.43
keeps every split call reading it.

**G1.35 · Single-node sink.** A sink (a slot that installs exactly one node) never installs bytes
that reparse to several. Every join (Backspace, Delete, the list-item merge) writes through
`joinIntoLeaf`, which refuses a join whose bytes read as two blocks: the gesture changes nothing and
the caret moves across the boundary instead. Arriving plural is legal; installing plural is the
fire. Predicate `checkSingleNodeSink` (`single-node-sink.ts`) · run in
`tree-operations/node-ops.ts :: mergedLeafFor` ·
`test/tree-operations/merge-multi-block-refusal.test.ts`.

**G1.36 · Structural-descriptor coherence.** A `StructuralChange` (the record a mutation publishes
so the id and ref arrays can follow a splice) fits the array it syncs (no negative slot count, no
window past the end), and every place the commit publishes ids leaves one id per child. `childSpans`
gets the same one-pair-per-child reading over the touched nodes, and every container below them that
keys children by id is checked at every depth. The record is checked where it's applied
(`applyStructuralChangeToIdsRefs`) and again where the commit publishes each scope's ids, since a
record can fit its own array while describing the wrong window. The e2e teardown
(`src/lib/e2e/container-parity.ts`) and the test bridge (`src/routes/test/editor/test-probes.ts`)
run the id check over the whole document. Predicates `checkStructuralDescriptor`,
`checkIdsChildrenLockstep`, `checkChildSpansLockstep` (`structural-descriptor.ts`),
`checkChildIdParity` (`child-id-parity.ts`) · run at
`tree-operations/structural-change.ts :: applyStructuralChangeToIdsRefs`, the commit primitive
(`editor-actions/commit/undo-controller.ts`), and `invariants/install.ts :: assertCommittedNodes` ·
`structural-descriptor.test.ts`, `test/schema/child-spans.test.ts`,
`test/selection/cross-block/cross-block-delete-seam-fold.test.ts`,
`test/invariants/child-id-parity.test.ts`.

**G1.37 · Descriptor-field coherence.** `contextDependentKind` (a kind with no opener of its own,
whose container writes its syntax) beside a registered opener suppresses the reparse for a kind the
parser CAN recognize, so its bytes stop re-deriving, silently. The field and the opener live in
different registries, so no type sees both and the pair stays a runtime check (the descriptor's
other incoherent pairs don't compile, G3.10). Predicate `checkDescriptorFieldCoherence`
(`registry.ts`) · bootstrap · `descriptor-field-coherence.test.ts`,
`test/schema/registration-checks.test.ts`.

**G1.38 · Faithful container splices** (`child-spans-faithful`). After every one-region splice,
dev re-derives the whole container raw on a scratch node and, on any difference, refuses the splice
(the node takes the full rebuild instead) and names the kind. Code that moves bytes beside the
spliced child (a separator a settle retires, a borrowed wrap slot) retires the spans itself in
`schema/child-spans.ts`; this is the backstop under it, and the only guard that sees a stale
container raw between commits. Production pays nothing. Predicate
`schema/child-spans.ts :: spliceIsFaithful` (the one predicate outside `invariants/`) · the splice
path · `test/schema/child-spans.test.ts`, `test/schema/child-spans-settle.test.ts`,
`child-spans.property.test.ts`.

**G1.39 · One synthetic caret.** Beside a non-editable inline widget and at a gap between blocks
the browser draws no caret, so the editor draws one, and across the editor at most one shows. Held
by construction, twice over: the drawn caret is one element per editor, and each paint moves it into
the host it draws in, so a block that unmounts with it inside leaves nothing behind; and a paint reads
the widget edge a click meant only through the focused editable's own owner, which no unmounted
block's editable can be. (Releasing a torn-down owner's edge is tidying: nothing can read it.)
`caret/drawn-caret.svelte.ts` · G4.141's and G4.144's scans ·
`e2e/tests/blocks/image/caret-synthetic-indicator.spec.ts`.

**G1.40 · Built-in presentation facts** (`builtin-presentation-facts`). A plugin kind may leave
`pageRole` and `estimateHeight` out and take the defaults; a built-in must declare both, so nobody
gets the defaults without deciding to. Predicate `checkBuiltinPresentationFacts` (`registry.ts`) ·
bootstrap · `test/invariants/builtin-presentation-facts.test.ts`.

**G1.41 · The open last line** (`last-line-kept`). Only the document's last line may lack a line
ending, and a structural edit leaves it the way it found it: a file with no final break still has
none afterwards, unless its new last line is blank (dropping that break would drop the line). Which
child holds a block's last line is the kind's `lastLineChild` (read through
`schema/container-raw.ts :: childHoldingLastLine`; an answer past the children warns
`last-line-child-range`), and whether that line is blank is
`tree-operations/open-tail.ts :: holdsBlankLastLine`. The commit owns the rule in two steps,
`tree-operations/open-tail.ts :: endWindowLines` before the separator fix-up and
`tree-operations/open-tail.ts :: keepOpenTail` after the containers rebuild, and no edit writes the
tail by hand (G4.74). A move (`tree-operations/reorder.ts`) still calls `endWindowLines` itself,
since it checks its own joins before the commit's fix-up runs.

After every structural commit the check fails three shapes: an open file that gained a break on a
line with text, a closed file that lost its break, and a line with no ending right above the last
line at any depth (two lines that read as one on reload). Where a container's own bytes hold its
last line (a quote's closing `>`, a directive's closing `:::`), it reads the children above that
line through `schema/container-raw.ts :: lineChildren`. Predicate
`invariants/open-tail.ts :: checkLastLineKept` · both commit branches in
`editor-actions/commit/undo-controller.ts` · `test/invariants/last-line-kept.test.ts`,
`test/editor-actions/open-last-line.test.ts`, `open-last-line.property.test.ts`.

**G1.42 · A list item's checkbox and blocks say what its reload reads** (`task-marker-slot`). A
to-do's checkbox is metadata on the list item, but a write changes the block behind it, so the two
can drift. A list item's checkbox, and the kinds of its blocks, match what a reload of its bytes
gives: a heading behind a checkbox (`- [ ] # b` read by a plain parse) fails, and so does a plain
item whose text now opens with `[ ] `. An item holding no block is G1.44's. Writes into an item's
first slot go through `tree-operations/list/reconcile-task.ts :: writeKeepingTaskMarker` (G4.82), a
block replacing a to-do's text gives the box up only where the bare bullet still holds it
(`tree-operations/list/reconcile-task.ts :: landAtTaskStart`), and this check catches a route that
read its bytes with the wrong reader. Predicate `invariants/node-shape.ts :: checkTaskMarkerSlot` ·
the commit, over its touched nodes · `test/invariants/task-marker-slot.test.ts`.

**G1.43 · A landing is a value** (`landing-is-a-value`). A commit's `landing` says where the caret
goes and places nothing; the commit puts the caret down after its tick through the one caret landing
(`selection/caret-landing.ts`). A landing read that moved focus or the selection fails here.
Predicate `invariants/landing-value.ts :: checkLandingIsAValue` · run by
`editor-actions/commit/undo-controller.ts` · `test/invariants/landing-value.test.ts`.

**G1.44 · The document keeps a block** (`keeps-a-block`). A structural commit never leaves the
document with no children, nor a container it touched with none, unless the kind is a whole-block
one (a diagram holds no child on purpose; `schema/block-kind-descriptor.ts :: mustHoldChild`
decides). The commit gives an emptied document one empty paragraph itself
(`tree-operations/keep-one-block.ts :: keepOneBlock`), and an edit that empties a container removes
it, through `tree-operations/cleanup.ts :: cascadeCleanupEmptyAncestors` or
`editor-actions/nested/emptied-container.ts :: removeEmptiedContainer`. The check is for a new route
that skips both. Predicate `invariants/keeps-a-block.ts :: checkKeepsABlock` · both commit branches
in `editor-actions/commit/undo-controller.ts` · `test/invariants/keeps-a-block.test.ts`,
`test/editor-actions/document-keeps-a-block.test.ts`.

**G1.45 · A landing's focus scrolls nothing** (`landing-focus-scrolls-nothing`). The caret
landing's reveal is the one scroll a landing makes, through the scroll owner, so a focus call
without `preventScroll` that moved the scroll position fails here. Predicate
`invariants/landing-focus-scroll.ts :: checkLandingFocusScrollsNothing` · run by
`selection/caret-landing.ts` · `test/selection/caret-landing.test.ts`; G4.91 is the source half.

**G1.46 · A placed caret leaves no widget selected** (`placement-ends-widget`). Once a block's
`focus`, a range put down inside one block, or a restore has placed its caret or range, no inline
widget is still selected whole; one that is would look selected while the keys go to the caret.
`placeCaret`, `selectInBlock` and `applySelectionToDom` check it inside their batch. Predicate
`invariants/placement-ends-widget.ts :: checkPlacementEndsWidget` · run by
`selection/place-caret.ts` and `selection/native-bridge.ts` ·
`test/invariants/placement-ends-widget.test.ts`; G4.94 is the source half.

**G1.47 · A child measures into its own list** (`measures-in-own-list`). Each block list provides
one measure channel to its direct children, who register through
`windowing/use-measured-child.svelte.ts :: useMeasuredChild` with their own path. The channel
refuses a path that isn't one of its own children (a child that found a list further up, say a list
item calling the hook after it provided its own inner list, would land its height in a table that
doesn't index it). Predicate `invariants/measures-in-own-list.ts :: checkMeasuresInOwnList` · run by
`windowing/use-container-windowing.svelte.ts` ·
`test/windowing/measured-child-routes.svelte.test.ts`; G4.97 is the source half.

**G1.52 · The cached text is the document** (`current-source`). `getSource()` serializes once per
content version, and a `source` prop write is compared with that string, so a write that changed
bytes without bumping the version (G4.52 scans for those) leaves the editor reporting text it no
longer holds. The first reuse of a version's text re-serializes in dev and compares; it's skipped
while the perf instruments are armed; the `source` swap compare reads the cache unchecked, since an
echoing host reaches it on every keystroke. Predicate
`invariants/current-source.ts :: checkCurrentSource` · run by
`editor-actions/commit/current-source.ts :: createCurrentSource` ·
`test/editor-actions/commit/current-source.test.ts`.

**G1.53 · Retired.** The rule was: a write made for a document a `source` swap replaced is refused,
and a dev build says so (`stale-document-write`). The refusal stays, quietly, in every build, in
`editor-actions/commit/reading-write-gate.ts :: admitsWrite`: a late write after a swap (a paste
whose clipboard read finished late) is ordinary, not a bug.

**G1.54 · The tree's top-level array comes back untouched** (`top-level-untouched`). A commit with
the document among its scopes hands its mutation a plain copy of the top-level array and installs it
at publish. A mutation that writes the tree's own array instead has its splice thrown away, so the
commit fails here if that array was replaced or written (skipped while the perf instruments are
armed). Predicate `invariants/top-level-untouched.ts :: checkTopLevelUntouched` · run by
`editor-actions/commit/undo-controller.ts` · `test/invariants/top-level-untouched.test.ts`,
`test/perf/top-level-splice-writes.test.ts`.

**G1.55 · A rebuilt container reads back as itself** (`reads-back`). After a keystroke's rebuild
and after every commit, dev parses each top-level container the edit wrote in, on its own, and
compares the shape (kinds, child counts, metadata) with the tree's; a dropped leading space that
re-nests a list passes every byte check and fails this one. The edit names those containers itself,
so the check never searches the document. It skips a container over 16K characters, an empty one,
and anything the perf instruments time; the empty-container skip hides a bullet a range delete
emptied, an open defect. Predicate `invariants/reads-back.ts :: checkReadsBack` · run by
`editor-actions/leaf-write.ts` and `editor-actions/commit/undo-controller.ts` ·
`test/invariants/reads-back.test.ts`.

**G1.58 · An indent key over a range keeps every word, in order** (`range-indent-keeps-text`). Tab,
Shift+Tab or a rebound indent key over a range moves list items, shifts code lines, or does what a
kind registered through `registerRangeIndent`, and nothing else. After each press dev compares the
leaf text of the spanned top-level blocks, in document order and whitespace aside, with what was
there before; a renumbered marker or an added tab passes, a lost or moved word fails. The reading is
`invariants/leaf-text.ts` :: `leafTexts`, shared with G1.61. Predicate
`invariants/range-indent-keeps-text.ts :: checkIndentKeepsText` · run by
`selection/cross-block/range-indent.ts` · `test/invariants/range-indent-keeps-text.test.ts`.

**G1.61 · A list move keeps the order** (`list-move-keeps-order`). Every nest, lift, unwrap and
merge that moves blocks between list levels (Tab, Shift+Tab, Backspace at a sublist's start or on a
first item, Enter in an empty item) keeps the list's leaf text in order, read as G1.58 reads it,
before and after. A merge's check reads only the two lines it joins, since a live-mode join can drop
markers. Predicate `invariants/list-move-keeps-order.ts :: checkListMoveKeepsOrder` · run by
`tree-operations/list/item-moves.ts`, `tree-operations/list/item-partition.ts` (G4.123) and
`tree-operations/list/unwrap-merge.ts` · `test/invariants/list-move-keeps-order.test.ts`, and
`test/blocks/list/indent-keeps-order.property.test.ts` over loose, ordered, quoted and side-by-side
lists.

**G1.71 · A command key over a range runs where it was claimed** (`command-key-landing`). Over a
range, a key is a command key when the keymap of the block the removal will leave the caret in binds
it (`selection/removal-landing.ts` :: `removalLanding` picks that block before anything moves).
After the removal the command must run in a block of the kind whose keymap claimed the key (kinds
only, since a join can move the caret's offset). Predicate
`invariants/command-key-landing.ts :: checkCommandLanding` · run by
`selection/cross-block/range-replace.ts` · `test/invariants/command-key-landing.test.ts`.

**G1.75 · The caret goes before an empty block's `<br>`** (`caret-before-break`). An empty
editable holds one `<br>`, and a caret after it looks the same as one before it, but in Chromium a
composition started after it is dropped after its first update (no `compositionend`), losing or
doubling the composed text. Every caret and range the editor writes passes
`caret/widget-offset.ts :: writeSelection`, which checks both endpoints in dev. Predicate
`invariants/caret-before-break.ts :: checkCaretBeforeBreak` ·
`test/invariants/caret-before-break.test.ts`; G4.36 keeps every native selection write in that file.

**G1.76 · The drawn caret agrees** (`drawn-caret-agrees`). At a `selectionchange` with no paint
pending, a caret still where the last paint drew it must still measure where the bar sits, within a
pixel. A fire means something changed the caret's line without writing the caret; call
`EditorServices.drawnCaret.request()` where that change is made. It doesn't run after a typed key, a
click or a press (each asks for a paint first), it can't see a caret range that was wrong to begin
with, and a reflow of the editable is left to its size observer. A bar at a code chip's stop draws
against the chip's box, not the caret's, so it's not checked. Predicate
`invariants/drawn-caret.ts :: checkDrawnCaretAgrees` · run in `caret/drawn-caret.svelte.ts` · every
e2e run through the invariant watcher, and `e2e/tests/caret/drawn-caret.spec.ts`.

**G1.77 · One caret showing** (`one-caret-showing`). After every paint, the `data-caret-drawn`
attribute (which hides the browser's caret) sits on exactly the editable the bar draws for, and on
none while the bar draws nothing, so the page never shows two carets or none. The one exception is
a pointer-down beside a widget, where the attribute goes on before the click draws the bar, since
the browser's caret flashes taller there. An attribute, since Svelte rewrites an editable's whole
class list when its kind changes. Predicate
`invariants/drawn-caret.ts :: checkOneCaretShowing` · run after each paint in
`caret/drawn-caret.svelte.ts` · `e2e/tests/caret/drawn-caret.spec.ts` (`caretsShowing`, one caret in
every row).

## Group 2: property and regression tested

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

**G2.12 · Caret placement ends the editor's selection.** A caret placement ends every selection the
editor owns (a cross-block range, a gap caret, an inline widget selected whole), unless it's an
extend. The programmatic side is one route: `BlockComponent.focus` ends them itself, and the table
in `test/selection/selection-claim-table.test.ts` runs every writer over each of the three. The scan
holds what can't be routed: native caret placement (a click moves the caret by default, so pointer
entries are declared per file), the park verb's allowlisted callers, and the park verb on every leaf
that forwards a shared caret entry point (containers publish one `containerApi`, and a
`createEditableLeaf` leaf its `blockApi`, so they're checked by that publication instead).
`lint/caret-gesture-range-reset.test.ts`, plus `src/lib/e2e/tests/simulation/range-interrupt-ops.spec.ts`
(outside this group's root), which drives the same rule through real gestures.

**G2.13 · Shape fixed point.** An edit on a loaded document leaves a tree whose serialization
reparses to the same block shape; G2.1 can't see a lost block whose bytes were exact. Two lanes:
blank-line-separated documents under the split, delete, merge, fill, empty, retype and update
gestures, and inline-source paragraphs under the live split. `shape-fixed-point.property.test.ts`,
with example cases in `parse-convergence.test.ts`.

**G2.14 · Toggle and active-read equivalence.** Over a RANGE, the toggle and `isInlineFormatActive`
agree: where the read says active the toggle unapplies, where it says inactive the toggle applies;
the cross-block toggle rests on it. The one branch outside it: where the delimiters paint, the bare
wrap writes unverified, on screen for the reader to fix (live-mode.md § 4.3). Every other branch
checks coverage, the split over every covering run of the kind. A collapsed caret is a different
set of rules entirely. `format-toggle-ladder.test.ts`.

**G2.15 · A container rebuild keeps its bytes.** Rebuild every container of a freshly parsed
document, innermost first, and you get the same bytes back, line endings included, so the first edit
in a container changes only the lines it edits. The generators spell tables, quotes and list items
every way GFM reads alike (padding, no edge pipes, escaped pipes, lazy lines, tabs, CRLF), and a
second property writes one cell and checks that only that row's line moved.
`rebuild-keeps-bytes.property.test.ts`. The row writer reads a cell's text the way the row reader
does (`core/parsers/table-line.ts :: cellText`), and when it falls back to the plain spelling a dev
check (`table-row-reads-back`) fails if even that doesn't read back as the cells.

**G2.16 · An edit moves only its own lines.** Writing a leaf the bytes it already holds leaves the
document byte for byte as it was, and one letter typed through the keystroke's route changes one
line of the document and leaves a tree that reloads as itself. Both draw the blank-separated
corpus and the respelled quotes and lists, and a named row pins the retype of a tab-indented item
holding a table. `shape-fixed-point.property.test.ts`.

## Group 3: compile time

The strongest level: the violation doesn't compile. Enforced by `npm run check`. Each entry says
what the type retired.

| ID    | What no longer compiles                                                           | Codes |
| ----- | --------------------------------------------------------------------------------- | ----- |
| G3.1  | An untyped metadata access (`as` cast) on a block node                            | T     |
| G3.2  | A component publishing anything but the three allowed export shapes               | T     |
| G3.3  | A cell selection point where a character point belongs, or the reverse            | T     |
| G3.4  | A magic number standing in for "end of block"                                     | T     |
| G3.5  | A container without a declared contract                                           | T     |
| G3.6  | A container registration missing its rebuild, or a leaf claiming container fields | T     |
| G3.7  | Arithmetic across two different coordinate spaces                                 | T     |
| G3.8  | A reader writing a node's serialized bytes                                        | T     |
| G3.9  | Forgetting one part of what the caret means without the others                    | T     |
| G3.10 | A registration pairing fields that can't mean anything together                   | T     |

### The entries

**G3.1 · Typed per-kind metadata.** `BlockMetadataByKind` plus `metadataOf<K>`. Retired: `as`
metadata casts.

**G3.2 · Allowed component exports.** `defineBlockComponent`, whose exports parameter is the
three allowed publication shapes (`BlockComponentExports`): a hand-built leaf's own members, a
factory-built leaf's single `blockApi`, or a container's single `containerApi`. Retired: `as unknown
as` casts, and a component that publishes nothing at all. A factory-built leaf that copies its
members out flat still compiles, since the copy is a hand-built leaf's shape; G4.73 holds that.

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

**G3.7 · Branded coordinate spaces.** `caret/coordinate-spaces.ts`: `RawOffset`, `DomTextOffset`,
`EditorX`, `ViewportX`, `CellIndex`, `DocPath`, each created only at its home module with named
conversions per direction. Public entries keep `number` and brand once at the boundary. Cross-space
arithmetic is a type error. Retired: offset-space mixing; `charOffsetOf`'s read-space check narrows
to the runtime backstop.

**G3.8 · Bytes-readonly node views.** `core/node-views.ts :: NodeView` and `DocumentView`:
serialized bytes deep-readonly, the `childIds`/`childSpans`/`ownerEpoch` bookkeeping writable. This
is G1.9 as a type: readers hold views, constructors and writers keep `CstNode`, and copying the path
(`tree-operations/unshare.ts`) is the only way back to mutable (G4.13 scans for the casts). Retired:
reader-side byte writes.

**G3.9 · One caret memory.** `src/lib/caret/caret-memory.ts` :: `createCaretMemory` holds the
sticky column, the edge record and the pending marks. A keydown updates them through `noteKey`,
and every other caret move (a click, a paste, an undo, a swap, a blur, a mode switch, a restore)
calls `forget`, which drops all three. There's no method that forgets one alone, so clearing the
column and leaving the side behind doesn't compile. Retired: G4.31's reset half and G2.10's
capture-without-reset pairing.

**G3.10 · Coherent registration pairs.** `BlockKindRegistration` is one of two shapes: a block
focused as one unit (`blockFocus: 'whole-block'`, so `supportsInline: false`, no `contentStart` and
no title row), or a block the caret enters. A content range and its Backspace behavior register
together as `contentStart`, and a container with a title row declares only its middle-child unwrap
strategy. `augmentBlockKind` takes none of these fields.

A cast or a plain JavaScript plugin never meets the types, so both calls throw at runtime too:
`registerBlockKind` checks each pair against
`src/lib/schema/registration-pairs.ts :: INCOHERENT_REGISTRATION_PAIRS`, and `augmentBlockKind`
refuses every field on `src/lib/schema/block-kind-descriptor.ts :: FIXED_AT_REGISTRATION`.
`src/lib/test/schema/descriptor-groups.types.test.ts` holds one `@ts-expect-error` per pair, and
`src/lib/test/schema/registration-pairs.test.ts` fails when a table row and its pin don't match.
Retired: G1.32 and four of G1.37's five pairs as dev-time checks, and G1.18's not-a-container
branch.

## Group 4: source scans

These are tests that read the source text itself. They catch what a type can't express and a runtime
check can't see: a pattern anywhere in the tree, or a published table drifting from the code that
backs it.

Scans over the library live in `test/invariants/lint/` and ride `npm run test:editor:invariants`.
Scans over the e2e tree live in `e2e/lint/` (G4.17, G4.22, G4.23, G4.49, G4.133) and **don't** ride
that script; run them with `npx vitest run src/lib/e2e/lint/` (same in bash and PowerShell), and
`npm test` runs both.

This is the catalogued set, not the whole of `test/invariants/lint/`: a scan holding one module's
local rule gets a file without a G-number, so read the directory too before assuming a rule is
unguarded.

| ID     | What stays true                                                                           | Codes   |
| ------ | ----------------------------------------------------------------------------------------- | ------- |
| G4.1   | `createBlockListState` takes getters, never values                                        | L       |
| G4.2   | The render path computes inline content, never reads the cache                            | L       |
| G4.3   | Every container passes the conformance kit, and its declarations resolve                  | harness |
| G4.4   | No timing hacks for sequencing                                                            | L       |
| G4.5   | No synthetic `KeyboardEvent` in editor runtime source                                     | L       |
| G4.6   | Editor CSS and tokens live where the ownership rules say                                  | L       |
| G4.7   | A render memo keys on every input its built DOM embeds                                    | D·N     |
| G4.8   | Every documented chord resolves in the surface that dispatches it                         | L       |
| G4.9   | Every published theme token is declared, with light and dark values                       | L       |
| G4.10  | Every bundled plugin directory is exported, and the pack carries it                       | L       |
| G4.11  | Exactly the allowed paste routes apply paste transforms                                   | L       |
| G4.12  | Caret-edge destructive keys route through the one edge-policy dispatch                    | L       |
| G4.13  | No view-stripping cast outside `tree-operations/` and the undo controller                 | T·L     |
| G4.14  | Every component prop reading the CST is typed as a readonly view                          | L       |
| G4.15  | Coordinate brands are created only at their home modules                                  | L       |
| G4.16  | Bundled plugins import only the public authoring barrel                                   | L       |
| G4.17  | No spec is collected by two Playwright projects                                           | L       |
| G4.18  | The scan switch matches the trigger table; prefix handlers run from one site              | L       |
| G4.19  | _Retired upward_: reading mode is refused at the commit, not per dispatch site            | L       |
| G4.20  | A new line takes the document's ending; per-line work reads no `\r`                       | L·N     |
| G4.21  | Image bytes are written only through the one image byte module                            | L       |
| G4.22  | An e2e wait predicate must describe the post-operation shape                              | L       |
| G4.23  | Every e2e spec pairs with a requirement file, and vice versa                              | L       |
| G4.24  | A block's write rule runs in the content write, which maps the caret                      | T       |
| G4.25  | No `import.meta` env read anywhere under `src/lib`                                        | L       |
| G4.26  | Comment budget: two lines a block, five a header, no house words                          | L       |
| G4.27  | Every `parse` call outside the parser declares its scope                                  | L       |
| G4.28  | A leaf raw write outside the content write names the kind's rule                          | L       |
| G4.29  | Every file claiming a hardcoded chord is manifested with its chords and keys              | L       |
| G4.30  | Hidden-marker classification has one rule, applied in both spaces                         | L       |
| G4.31  | The pending marks are spent only where typed or composed text is written                  | L       |
| G4.32  | Every non-render inline read goes through `resolvedInlineContent`                         | L       |
| G4.33  | Live-mode byte candidates verify against what actually paints                             | L       |
| G4.34  | Link bytes are written only through the one link byte module                              | L       |
| G4.35  | A construct stamps its markers exactly when its policy row says revealable                | L       |
| G4.36  | The native selection is written only by the editor's caret writer in `widget-offset.ts`   | L       |
| G4.37  | Every surface rendering into a caret-walk container stamps content-empty                  | L       |
| G4.38  | Every editable surface publishes each of `EDITABLE_SURFACE_MEMBERS`                       | L       |
| G4.39  | Every text-surface component publishes `runCommand`                                       | L       |
| G4.40  | The three rewrite-claim lists are one set                                                 | N       |
| G4.41  | No test file mocks `dev-warn` or spies `console.warn`                                     | L       |
| G4.42  | No module writes a sibling's `leadingTrivia` by hand                                      | L       |
| G4.43  | Every `splitNode` call reads the index the split returned                                 | L       |
| G4.44  | Every prose surface resolves native ranged edits through the one resolver                 | L       |
| G4.45  | Every bare tree-op caller is declared with the commit that settles its writes             | L       |
| G4.46  | Every ancestry-rebuild caller states its fold-sink stance                                 | L       |
| G4.47  | Every contenteditable read routes through the host-aware predicate                        | L       |
| G4.48  | Wall-clock budgets outside the perf projects use the growth harness                       | L       |
| G4.49  | E2E composition rides the shared IME driver                                               | L       |
| G4.50  | Every block command id is classified for cross-block ranges                               | L       |
| G4.51  | A typing-checkpoint push always arms the pause window                                     | L       |
| G4.52  | The content version is announced at every place that writes document bytes                | L       |
| G4.53  | The descriptor type and the published field table are one set                             | L       |
| G4.54  | A published entry barrel is never imported by its own import closure                      | L       |
| G4.55  | Docs name the package `@voithos-labs/aragonite`, never bare `aragonite`                   | L       |
| G4.56  | Inline-tree and rendered-DOM walks are iterative, never recursive                         | L       |
| G4.57  | The source-scan lexer agrees with TypeScript's                                            | L       |
| G4.58  | One commit-message rule, enforced at the hook and in CI                                   | L       |
| G4.59  | The VR tag catalog and the tags cited in source are one set                               | L       |
| G4.60  | Every spread into a call's argument list declares what bounds its count                   | L       |
| G4.61  | The commit scope is set in production, not behind a build flag                            | L       |
| G4.62  | Code, grey, marker and faded-block text clear AA on the backgrounds under it              | L       |
| G4.63  | The bundled plugins' own suites import only the published entry points                    | L       |
| G4.64  | The tree-ops layers import only downward                                                  | L       |
| G4.65  | Every prose surface hands typed delimiters to the one auto-pair arm                       | L       |
| G4.66  | A relative scroll is written through `scrollBy`, never read-plus-delta                    | L       |
| G4.67  | Every editor menu counts itself on `menuChange` and hands the registry its close          | T·L     |
| G4.68  | Every plugin registry read outside its module passes the editor's grammar                 | L       |
| G4.69  | Only entry points, kits and editor-free code read with the default grammar                | L       |
| G4.70  | A decoration can't set a data attribute the editor uses on a block's own element          | L       |
| G4.71  | An emptiness test on text reads GFM's blank, not `String.trim()`                          | L       |
| G4.72  | The Markdown grammar reads GFM's whitespace, not JS `\s` or `trim()`                      | L       |
| G4.73  | A component built on the editable leaf exports `blockApi` and no block method of its own  | L       |
| G4.74  | Only the commit's open-tail steps write the document's last line ending                   | L       |
| G4.75  | A leaf's new text goes through one commit or one in-place write, at every depth           | L       |
| G4.76  | Every join into a leaf, and every other text built from two sources, is declared          | L       |
| G4.77  | Only three routes register on behalf of no plugin                                         | L       |
| G4.78  | The editor's built-in bootstraps run only through `registerEditorBuiltIns`                | L       |
| G4.79  | Whether a kind is a grid is asked through `isGridKind`, nowhere else                      | L       |
| G4.80  | In `selection/`, only the range coverage and the caret walks ask if a container is closed | L       |
| G4.81  | The cross-block table row snap runs in the range coverage and the stored pair only        | L       |
| G4.82  | The task-marker rule runs in one wrapper, and its callers are declared                    | L       |
| G4.83  | Every plain fragment read in the edit layers says why it needs no slot reader             | L       |
| G4.84  | Where a leaf's bytes are stored is made in one place, from the tree                       | L       |
| G4.85  | A live rewrite that removes bytes reads its candidate where it will be stored             | L       |
| G4.86  | A list item's marker is read only where the list is built, drawn or dumped                | L       |
| G4.87  | Only the scroll owner writes the editor's scroll position                                 | L       |
| G4.89  | One in-leaf range replace, and a short list of places that snap an offset                 | L       |
| G4.90  | A paste inside one block cuts its selection through the range replace, with its text      | L       |
| G4.91  | A focus call that may scroll the editor says why                                          | L       |
| G4.93  | A measure round keeps only the block `heldBlock` picks, level by level                    | L       |
| G4.94  | A gap caret or a widget is selected only in `place-caret.ts`, and held in one store       | L       |
| G4.95  | What a range covers is decided in the range coverage only                                 | L       |
| G4.96  | A commit rebuilds each container once, and a mutation leaves that rebuild to it           | L       |
| G4.97  | A child's height reaches its list's table only through `useMeasuredChild`                 | L       |
| G4.98  | Only layout state drops the measured heights or moves the width version                   | L       |
| G4.99  | A windowed list's box is never shorter than its table while blocks mount                  | L       |
| G4.100 | A block's own trailing line ending is added by the surface write and a few listed routes  | L       |
| G4.101 | Only the surface write names a typed kind change or completes a typed line                | L       |
| G4.106 | _Retired upward_: every test page load is a fresh document, and a load that isn't throws  | A       |
| G4.107 | Only a write emits `edit`, and only the in-place keystroke write declares `input`         | L       |
| G4.108 | Only the range replace removes a range; only it and the range indent open its undo step   | L       |
| G4.109 | A container built around another's children starts from that container's bytes            | L       |
| G4.111 | A block's editable element writes its own text only through the surface write             | L       |
| G4.112 | An indent key over a range reaches list items through one route, never removing the range | L       |
| G4.113 | _Retired_: the `$$` shape is G4.131's `$$` row                                            | L       |
| G4.114 | How a block paints under a range is decided in the selection model only                   | L       |
| G4.115 | A clipboard payload is written only by a copy                                             | L       |
| G4.116 | The pending break answers a text block's key before the shared keymap                     | L       |
| G4.122 | Import edges between `src/lib`'s top-level directories match their baseline both ways     | L       |
| G4.123 | A dissolving list item's children are split only inside the list order check              | L       |
| G4.125 | A component asks which inlines are widgets only in `widget-adjacency.ts`                  | L       |
| G4.126 | The dev server bundles every package the app imports before a page asks for it            | L       |
| G4.127 | Every branch on whether a DOM exists says what runs without one                           | L       |
| G4.128 | Every registered block kind shows the empty-block hint, or says why it's never asked      | harness |
| G4.130 | A code block edit over a range takes its span from `editSpan` only                        | L       |
| G4.131 | A block syntax's bytes are read and written in its own module only                        | L       |
| G4.133 | An e2e spec switches the presentation mode only through a helper that waits for it        | L       |
| G4.141 | Only the drawn caret writes its element and the mark hiding the browser's caret           | L       |
| G4.142 | `caret-color` is declared only for the known surfaces                                     | L       |
| G4.143 | Every caret write asks the drawn caret to repaint, and its frame paint only paints        | T·L     |
| G4.144 | The old widget and gap caret painters and the edge ring stay gone                         | L       |
| G4.145 | A click decides whether it follows a link or widget through the shared rule only          | L       |
| G4.146 | A release tells a click from a drag only through the editor's press tracker               | L       |
| G4.147 | Every change to the caret memory repaints the drawn caret, and a no-op asks nothing       | harness |
| G4.148 | The caret's look adds no inline-tree walk, parse or paint to a key outside brackets       | harness |
| G4.149 | A preview of the next insertion runs a write's own spend, and changes no record           | harness |
| G4.150 | One placer for a hidden edge: no other file reads the caret's side or an arrival          | L       |
| G4.151 | One click-side check, called from the click entry both prose blocks share                 | L       |

### The entries

**G4.1 · Getter-fed block-list state.** No by-value `createBlockListState`: it takes getters only.
`lint/call-site-rules.test.ts`.

**G4.2 · Render path skips the inline cache.** The render path computes inline content via
`computeInlineContent`, never the caching `getInlineContent` accessor. Perf hygiene, since the cache
is a non-reactive WeakMap. `lint/render-inlinecontent.test.ts`.

**G4.3 · Container conformance kit.** The kit plus declaration sanity: `unwrapRole` strategies
resolve, `containerPaste` has the right shape, `rebuildRaw` runs. Built-ins are swept
registry-derived; a plugin container opts in with its own profile through `runContainerConformance`
(`@voithos-labs/aragonite/testing`). Kit: `src/lib/testing/container-conformance.ts` · tests
`container-conformance.test.ts` (built-ins), `test/plugins/container-conformance.test.ts` (plugin
containers).

**G4.4 · No timing hacks.** No timing primitive is used for sequencing (`await tick()` is the one).
The allowlist in `lint/file-rules.test.ts` is short and closed, each entry with its reason: the rAF
throttles in `selection/autoscroll.ts` and `selection/pointer-session.ts`, the rAF fold in
`components/blocks/editable-leaf.ts`, the rAF placement in `components/drag-handle.ts`, the rAF
start of a size watch in `windowing/observe-resize.ts`, the drawn caret's frame paint in
`caret/drawn-caret.svelte.ts` (read-only, G4.143), the wall-clock undo debounce in
`editor-actions/commit/text-batch.ts` and the occurrence plugin's typing pause in
`plugins/highlight-occurrences/highlight-occurrences-plugin.ts`, and the scan deadline in
`search/regex-executor.ts`. The unit suites follow the same rule (a row of
`lint/suite-file-rules.test.ts`): a test waits with `src/lib/test/harness/settle.ts :: settleEditor`,
fake timers or `vi.waitFor`, never by flushing a macrotask.

**G4.5 · No synthetic keyboard events.** No synthetic `KeyboardEvent` in editor runtime source.
`lint/file-rules.test.ts`.

**G4.6 · CSS ownership.** `app.css` holds no editor rules or tokens; every editor-owned token read
is declared in `editor-theme.css`; every host-token read carries a fallback; and host-chrome
defaults sit behind the opt-in theme class alone (G4.6d). The bundled and reference plugins follow
the same rule and may also read tokens they declare. `lint/css-ownership.test.ts` (editor),
`lint/plugin-css-ownership.test.ts` (plugins).

**G4.7 · Render-memo completeness.** A block's render memo key includes every input its built DOM
embeds; no live value (tree path, index, load policy, checkbox state) is baked into the DOM unless
the key carries it. Resolve it live at event time, or key on it. A prose block's `renderKey` is
`ambientPrefixText` + `raw` + the link-reference-definition signature epoch + the image-load
policy, and the inline DOM depends on nothing else (the image widget once baked its block's path in,
and a shifted block selected a stale node). G4.2 is the one automated proxy; the rest is documented
(`D`) with regression tests (`N`): `src/lib/e2e/tests/blocks/image/widget-path-restability.spec.ts`,
`test/blocks/text/render-image-policy.test.ts`, `test/blocks/list/task-checkbox.test.ts`.

**G4.8 · Documented-chord dispatch.** Every chord the consumer guide's keyboard table lists resolves
in the surface that dispatches it (the keymap registry, the search components, or the clipboard
paths). The reverse sweep covers what this repo ships (built-in and bundled keymaps, the global
keymap, bundled global chords, the hardcoded-chord files) and keys each claim by chord and owner, so
`Mod+Enter` on a task item and in a table cell each need a row or a recorded reason; a stale
exemption fails. `lint/consumer-guide-chords.test.ts`.

**G4.9 · Theme-token manifest.** Every token the consumer and plugin guides publish is declared in
`editor-theme.css`, and a themed token carries both a light and a dark value.
`lint/theme-token-manifest.test.ts`.

**G4.10 · Plugin package and pack parity.** Every `src/lib/plugins/<name>` directory is exported as
`./plugins/<name>`, and verify-pack derives its required files from that (`scripts/pack-manifest.mjs`);
a plugin module with a top-level CSS import is declared in `sideEffects`. The `/renderer` subpaths
are extra. `lint/plugin-pack-parity.test.ts`.

**G4.11 · Paste-transform site parity.** Exactly the allowed clipboard-to-parse routes call
`applyPasteTransforms`, since a new route without it drops plugin transforms. A route that never
names the symbol is caught too: every clipboard or drop read must reach an allowed route.
`lint/manifest-rules.test.ts`.

**G4.12 · Caret-edge destructive keys.** Every plain Backspace or Delete intercepted at a caret edge
in a prose block routes through the one edge-policy dispatch, which resolves what sits at the edge
against declarative policies and commits through `surface-write.ts :: writeText` or
`updateBlockContent`. The only other interceptors are the selected-widget second-press delete and
the pending break's Backspace (`pending-break-keys.ts`). `lint/manifest-rules.test.ts`.

**G4.13 · The view-to-mutable boundary.** No `as CstNode` or `as Document` view-stripping cast
outside `tree-operations/` and the undo controller. Readers hold bytes-readonly views
(`core/node-views.ts`) and get a mutable node only by copying its path or through a commit scope's
owned view. `lint/file-rules.test.ts`; type pins in `test/core/node-views.test.ts`.

**G4.14 · Readonly-view prop parity.** Every `.svelte` component prop reading the CST is typed
`NodeView` or `DocumentView`; registration erases prop types, so a `node: CstNode` would compile.
Only `Editor.svelte` holds a mutable `Document`. `lint/file-rules.test.ts`.

**G4.15 · Coordinate-brand creation.** `as <Brand>` casts and the `as*` boundary constructors appear
only in `caret/coordinate-spaces.ts` and the allowlisted public-entry files; everything else gets a
brand through those or a named conversion. G3.7's runtime-source complement.
`lint/file-rules.test.ts`.

**G4.16 · Bundled-plugin import boundary.** Every file under `src/lib/plugins/**` imports only the
public authoring barrel (`#lib/plugin.js`), its own plugin directory, `svelte`, or, for a
`renderer.ts`, its one declared rendering engine, which proves the authoring barrel is complete.
Every import-boundary scan (this one, G4.63, G4.64, G4.122) reads specifiers through
`src/lib/test/invariants/lint/scan-source.ts :: importSpecifiers`, so an import quoted in a string
or comment is no edge. `lint/plugin-import-boundary.test.ts`.

**G4.17 · One Playwright project per spec.** No spec file is collected by two Playwright projects
(the WebKit lane doesn't count). The scan reads what `playwright test --list` reports, so the glob
depth rules are Playwright's own; a spec no project collects is G4.23's.
`e2e/lint/project-partition.test.ts`.

**G4.18 · Inline-trigger parity.** The characters the inline scanner handles itself live in one
table, `core/inline/scan/triggers.ts :: BUILTIN_TRIGGERS`: a handler per row, plus when the fast bail
(the check that lets plain prose skip the scan loop) looks for it (always, only while a plugin
handler is registered on it, or never). A new built-in trigger is one row there plus one case in the
scan loop's `switch` (kept a switch because a table lookup measured slower).
`test/core/inline/scan/builtin-trigger-dispatch.test.ts` checks every ASCII character and table key
runs exactly its row's handler, and `lint/inline-prefix-consultation.test.ts` keeps the plugin
prefix-handler check before the switch at one site.

**G4.19 · Retired upward.** The rule was: every command dispatch site checks reading mode. Every
byte writer now asks `editor-actions/commit/reading-write-gate.ts` itself, so a site that forgets
can't write, and G4.52 holds each writer to asking.

**G4.20 · One document line ending.** Every new line the editor writes takes the document's line
ending, its first line break (`src/lib/core/lines.ts` :: `documentLineEnding`), and per-line work
reads each line without its ending (`src/lib/core/lines.ts` :: `displayLines`).
`trailingLineEnding(raw, fallback)` takes the fallback as a required argument: pass the document's
ending where a document is in reach (a commit's scope, a paste's context, or `ctx.lineEnding` in a
write rule or context action), else the block's own first break, and LF for a block with no line
break at all. A write to a block's own text keeps the ending it has (G4.100). The scan fails a
`split('\n')` over a block's bytes outside `core/lines.ts` and three allowlisted readers, an
`updateBlockContent` argument ending in a newline literal, and an unallowlisted `raw` write creating
one. `lint/trailing-line-ending-parity.test.ts`; `crlf-edit-mirror.test.ts` and
`crlf-typed-break-mirror.test.ts` run each gesture on LF and CRLF twins and require mirrored
results.

**G4.21 · Image byte-write module.** The GFM image serializer is named in code only inside the
image byte module, and only the documented write paths name `buildImageEditBytes` (the popover takes
the answer as a prop and names neither), so no route re-emits GFM over an image an inline plugin
kind claimed. A path that hand-rolls the bytes from a template gets past it. `lint/manifest-rules.test.ts`.

**G4.22 · E2E wait predicates describe the outcome.** Inside one `test()` body, a `waitForSource*`
predicate must describe the POST-operation shape; one already true on the loaded document returns
at once, and a gesture that silently no-ops passes. `e2e/lint/settle-predicate-vacuity.test.ts`.

**G4.23 · Requirement and spec lockstep.** Every spec under `e2e/tests/` pairs with a requirement
file under `e2e/requirements/` and vice versa (`.perf` stripped from the stem, no two specs claiming
one file); each requirement carries a title, a section and a scenario, and Playwright lists at least
one test for each spec. A requirement list three times longer than the spec's
`playwright test --list` count needs a reason in the scan's allowlist; the counts needn't match.
`e2e/lint/requirement-spec-lockstep.test.ts`.

**G4.24 · A block's write rule runs in the content write.** Every content write goes through
`tree-operations/content-write.ts :: legalizeWrite`, which runs the kind's `rawWrite`, then its
container's `bodyWrite`, and hands back the caret moved to where the rule left it, so a code fence
is grown or closed whichever gesture wrote it. It's a type: `updateNodeContent` only takes bytes that
went through `legalizeWrite`, or plain text it runs through it.
`test/editor-actions/content-write-caret.test.ts`.

**G4.25 · No `import.meta` env reads.** Nowhere under `src/lib`, test tree included: it's
Vite-only, so the library wouldn't load under another bundler (and `svelte-package` warns on it
wherever it sits). Toolchain flags come from `esm-env`, imported only by `src/lib/env.ts` (a row of
`lint/file-rules.test.ts`), and every dev-only check asks `isDevChecks()`, so
`configureEditorEnv({ isDev: true })` turns the checks and the dev warnings on together. The
reference plugins and the consumer example are Vite apps and exempt. `lint/suite-file-rules.test.ts`.

**G4.26 · Comment budget.** Two scans. Length: a comment block gets two text lines and a header
five. A header is a file's first comment, a docblock right above an `export interface` or
`export type`, or a docblock on an export (or one of its members) of a published entry point
(`index.ts`, `plugin.ts`, `testing.ts`, `editor-props.ts`, `block-component.ts`). Section dividers
and tool directives don't count; `lint/comment-lines.ts` reads the blocks and holds the header rule.
Vocabulary: the house words (listed in the scan; `docs/contributing/glossary.md` says what to write
instead) appear in no comment, backticked symbols aside, and in no requirement file's body text;
every design and contributing doc holds a baseline of its own that a rewrite can lower and nothing
can raise. A why that needs more lines or a private word belongs in a design doc or plain English
(`docs/contributing/code-style.md` § Comments). `lint/comment-budget.test.ts`,
`lint/comment-house-words.test.ts`.

**G4.27 · Parse-scope declaration.** Every call of the core `parse` entry outside `core/parser.ts`
passes an explicit `scope`. The default is `'document'`, so a fragment caller that forgets hands one
block's bytes to the openers as a whole document, and only the caller knows which it is. The
consumer example and the published kits are excluded (they parse whole documents).
`lint/call-site-rules.test.ts`.

**G4.28 · Leaf raw writes outside the content write.** Every `<node>.raw =` statement outside
`tree-operations/node-primitives.ts` (home of `writeOwnRaw` and `installOwnRaw`) is on a counted
allowlist with the reason it can't reach a kind that declares a write rule, and an `installOwnRaw`
call counts too outside that file and the content write. Whether a listed route runs its bytes
through `normalizeOwnRaw` or `legalizeWrite` first is left to review. `lint/leaf-raw-write-rule.test.ts`.

**G4.29 · Hardcoded-chord manifest.** Every library file that reads a `KeyboardEvent` modifier flag
is named in `schema/reserved-chords.ts`, with the chords it claims outside the keymaps and the key
literals it compares (negated guards included), which keeps the public `reservedChords()`
(`editor-props.ts`) true. A manifested file keeps literal key comparisons and modifier reads: the scan
is structural, so a shared helper fails it until the scan learns that helper.
`lint/reserved-chord-manifest.test.ts`.

**G4.30 · Hidden-run classification.** One rule, two spaces. `core/inline/visibility.ts` states the
marker families and the hiding rule, and `caret/widget-offset.ts` applies it where there's a caret;
a third copy would disagree the day a mode moves, and a caret placed in unpainted text corrupts
silently. A property test holds the node-space and DOM-space answers together over one rendered
fragment. Two scans: resolving hiding state is allowlisted to those two homes plus readers asking a
different question, and every file naming a marker class in code is manifested with its role. The
runtime backstop is the dev probe in `invariants/marker-css-parity.ts`, which compares
`getComputedStyle` with the predicate once per mode change. `lint/manifest-rules.test.ts`.

**G4.31 · Pending marks are spent by a write.** The pending marks (a format toggled at a collapsed
caret, waiting to wrap the next typed character) are spent only where typed or composed text is
written: the edge-policy dispatch's typed-byte handler and the two prose surfaces' composition
writes. A spend anywhere else drops the format with nothing written. `lint/file-rules.test.ts`.

**G4.32 · Inline-cache one spelling.** Every non-render consumer reads the inline tree through
`resolvedInlineContent`, so the resolver and the signature travel together; dropping the signature
reads an entry the render path didn't fill (brackets where the screen shows a link). The raw
`getInlineContent` stays in its own module, plus the vertical-skip decision, which wants the
resolver-less answer. `lint/file-rules.test.ts`.

**G4.33 · Live-rewrite verification.** The modules that build live-mode byte candidates verify them
through the render path's own `renderedText`, never a private walk over the parse, and every file
naming an inline marker family in code is manifested with what it does with it (only the model
decides which spans a marker-hiding mode drops). Each verification states which reading it takes:
the block's own screen where it decides what a press may touch, or the content behind every marker
where it's a before/after diff, and the content reading declines any side whose chrome paints
(live-mode.md § 4.1). Every destructive join goes through `cleanJoinedRaw`, and the files naming
`preDelete` are a closed allowlist. `lint/manifest-rules.test.ts`.

**G4.34 · Link byte-write module.** The image rule's twin (G4.21): the GFM link serializer is named in
code only inside `link-source-bytes.ts` (`lint/file-rules.test.ts`), and only the documented write
paths name `buildLinkEditBytes` and `buildLinkUnwrapBytes`. Every candidate is verified through the
render path (G4.33), and a link an inline plugin kind claimed is declined, since there's no
`rewriteLink` hook. `lint/manifest-rules.test.ts`.

**G4.35 · Stamp and revealable parity.** A construct whose marker spans carry a `data-construct-*`
stamp declares `revealable: true` in the inline-construct policy table, and every revealable kind
stamps; the stamp list is derived from `core/inline-render.ts`. A stamp without a row reveals
nothing, and a row without a stamp addresses nothing. An absent row reads as `revealable: false`.
`lint/stamp-revealable-parity.test.ts`.

**G4.36 · Caret-write sites.** Every write to the native selection goes through the editor's caret
writer, `caret/widget-offset.ts :: createCaretWriter` (one per editor, on
`EditorServices.caretWriter`), which asks the drawn caret to repaint after each write (G4.143). A
caret goes through `placeCaretAtRaw`, which skips the marker prefix, never lands behind a hidden
marker run, and takes a required `clamp` (`reachable` or `exact`). A range goes through
`selectRawRange`, `extendSelectionToRaw` or `selectSurfaceContent`, and a caller holding the nodes
already (a widget whole) uses `selectDomRange`. The scan pins four file lists, each with per-file
reasons:

- the files calling a native selection writer, which is `widget-offset.ts` alone (the shapes are
  in `lint/native-selection-write.ts`, which G4.143 reads too);
- the files building a DOM position from a DOM-walk offset (`widget-offset.ts` and the readers
  that measure with it);
- the files naming `rawRangeToDomRange` (measuring and decorating only);
- the surfaces building `focus` from `placeCaret` (`selection/place-caret.ts`).

`lint/manifest-rules.test.ts`.

**G4.37 · Content-empty stamp parity.** The files rendering a fragment into a contenteditable the
caret walk reads (`renderInlineNodes`, `renderCodeBlock`) are exactly the files stamping
`data-content-empty`; a surface without the stamp paints a marker-only block as an empty line nobody
can reach. A file naming a renderer that mounts nothing carries a reason.
`lint/manifest-rules.test.ts`.

**G4.38 · Editable surface parity.** Every component mounting the text surface
(`createEditableSurface`) publishes each member of `src/lib/block-component.ts` ::
`EDITABLE_SURFACE_MEMBERS`, as an instance export or in the surface literal it hands
`publishRefSlot`. `BlockComponent` declares them optional, so a missing one compiles and silently
declines (every `editor.insertMarkdown()`, say). A `createEditableLeaf` leaf is G4.73's. Add a member
to the tuple and both rules take it. `lint/insert-door-surface-parity.test.ts`.

**G4.39 · Command surface parity.** Every component mounting the text surface
(`createEditableSurface`) publishes `runCommand` as an instance export, since that's where the
built-in text commands live; it's optional on `BlockComponent`, so a missing one compiles and
declines every built-in `editor.runCommand()`. The two reorder ids resolve in the dispatch and don't
count. `lint/file-rules.test.ts`.

**G4.40 · Rewrite-claim set parity.** Three lists name one set of rewrites: the ids built-in keymaps
bind to a rewrite over one block's selection, the ids the dispatch answers specially over a
cross-block range (`RANGE_DECLINED_COMMAND_IDS` declines, `CROSS_BLOCK_RANGE_COMMAND_IDS` routes),
and the chords `selection/cross-block/keydown.ts` claims; each rewrite id sits on exactly one of the
two dispatch lists. Membership is listed by hand, not by prefix (`link.openCard` isn't `format.`).
`test/selection/cross-block/rewrite-claim-parity.test.ts`.

**G4.41 · Warn-gate bypasses.** No file under `src/lib` mocks `dev-warn` or spies `console.warn`:
a mocked `devWarn` never reaches the sink, a console spy reads a channel the sink silences, and a
spy that swallows the call hides Svelte's runtime warnings too, so the gate goes blind for that file.
The one file whose subject is `devWarn`'s console output is allowlisted.
`lint/suite-file-rules.test.ts`.

**G4.42 · Separator-write sites.** No module writes a sibling's `leadingTrivia` by hand. A splice
fixes its separators through one route (`settleSeparator` in the commit steps,
`spliceChildrenSettled` under the path-addressed entries), and the allowlist names each exemption
with its reason (`node-ops.ts`, `content-write.ts`, `node-primitives.ts`, `chain-rebuild.ts`,
`reorder.ts`, the item moves under `list/`, paste replacements, and three sites a splice window
can't infer, such as the gap-caret insert). Inside `settle.ts`, every blank-line write goes through
`writeSeparator` or `writeWrapSlot`, which drop the owner's child spans first, and the fix-ups take
a `BodyParent`, so none loses track of whose fence lines it's reading.
`lint/separator-write-doors.test.ts`.

**G4.43 · Split-landing parity.** Every file naming `splitNode` reads `secondHalfIndex` at least
once per split CALL, so a caller growing a second split whose caret it puts at `i + 1` fails too,
and marks that landing `fresh`, so Enter starts the new block plain. `lint/split-landing-parity.test.ts`.

**G4.44 · Live ranged-edit parity.** Every editable prose surface resolves native ranged edits
through `components/blocks/text/live-selection-edit.ts :: resolveLiveRangeEdit`, and no other file
calls it. A destructive input carries its range on the event (`getTargetRanges()`), not in the
selection, so a surface reading only its selection lets word, line and drag deletes cut through
delimiter runs. The fenced-code surface is outside the set (no inline constructs).
`lint/file-rules.test.ts`.

**G4.45 · Settle coverage for bare tree ops.** `splitNode`, `deleteNode` and the two merge entries
splice a body without fixing its separators, so every file importing one is declared with the commit
that does, and must reach a commit or a settle entry (keyed on the import, so an alias still counts).
A caller outside the commit leaves the document one folded line short of its own reload, silently.
`lint/manifest-rules.test.ts`.

**G4.46 · Ancestry fold-sink stance.** `rebuildUnsharedChain` and `rebuildUnsharedAncestry` take a
required-nullable `folds` sink: passing one claims "I can reconcile the parent's ids and refs", and
`null` declines. Every production call site is listed with its stance and why, since a wrong id
length is permanent. `lint/ancestry-fold-sink-thread.test.ts`.

**G4.47 · Editing-host readers.** Every `[contenteditable]` selector read and every
`document.activeElement` identity read goes through the host-aware predicate or declares its own
answer with the reason. The hidden host is a real contenteditable that paints nothing, so a read
that forgets it answers for the wrong element. `lint/file-rules.test.ts`.

**G4.48 · Wall-clock budgets.** An absolute `performance.now` or `Date.now` budget reds on a loaded
host, so outside the perf projects every wall-clock budget goes through the growth harness, whose
N-vs-4N ratio (`measureScanGrowth`) cancels the machine. The allowlist carries a reason per file.
`lint/suite-file-rules.test.ts`.

**G4.49 · The shared IME driver.** A spec that builds a `CompositionEvent` or an
`insertCompositionText` input event by hand tests a browser no user has, so it fails the scan. The
driver file is the one exemption (WebKit has no CDP session), pinned exactly, so a widened exemption
and a deleted WebKit branch each fail. `e2e/lint/composition-driver.test.ts`.

**G4.50 · Cross-block-range classification.** Every block command id is range-declined, has a
cross-block branch, or is recorded range-safe with its reason; the decline is what stops a command
spending one block's offsets against a multi-block range. `lint/range-command-census.test.ts`.

**G4.51 · Debounced-checkpoint pairing.** A file pushing a typing checkpoint also arms the pause
window; a push with no arm leaves a batch no pause can end, and one Ctrl+Z unwinds the session.
`lint/file-rules.test.ts`.

**G4.52 · Content-version announcements.** The content version is announced at each place that
writes document bytes, never derived from a walk, so the writers are a declared set: the commit
covers its structural writers, and the typing writes, the history swap and the `source` swap answer
for themselves. A silent writer serves every whole-document memo a stale answer. The scan also holds
each writer except the `source` swap to asking the reading-mode check
(`editor-actions/commit/reading-write-gate.ts`) in every function that writes.
`lint/content-version-doors.test.ts`.

**G4.53 · Descriptor-field roster.** `BlockKindDescriptor` and the field reference table in
`docs/design/plugin-contract.md` are one set, both ways, keyed on the field-name column. The scan
reads `schema/block-kind-descriptor.ts :: DESCRIPTOR_FIELDS`, which is complete by compile error.
`lint/descriptor-field-census.test.ts`.

**G4.54 · Entry barrels are import sinks.** No module in a published entry's own import closure
imports that entry back: a consumer's bundler could split the cycle and run the entry before its
imports, and in-repo `#lib` never shows it. The entry list derives from package.json `exports`, and
the consumer example's build fails on such a cycle too (`examples/consumer/vite.config.js`).
`lint/entry-barrel-sink.test.ts`.

**G4.55 · The package name.** Docs name the package `@voithos-labs/aragonite`, never the bare
`aragonite`, which belongs to an unrelated npm package. `docs/changelog/` is exempt, since it
records what shipped under the name of the day. `lint/doc-package-name.test.ts`.

**G4.56 · Iterative walks.** No function under `core/inline/`, `caret/`, `windowing/`, `ambient/` or
`components/blocks/text/` that reads a node's `children` or `childNodes` sits on a call cycle, even
through helpers. Inline nesting depth is up to the input, so recursion overflows the stack and
strands the block in the failed-block fallback; write the walk with an explicit stack. The scan
resolves a call to every declaration of that name, so two walkers spelled alike can't hide each
other (and a repeated spelling fails outright). The exception map is empty by design.
`lint/inline-walk-iterative.test.ts`.

**G4.57 · The lexer differential.** The source-scan lexer (`spanAt`) classifies every character of
each scanned `.ts` file and `.svelte` script block as comment, string, template, regex or code, and
must agree with TypeScript's own scanner; a literal it misreads would silently shrink every scan
that reads code through it. `.svelte` markup and `.css` files, which TypeScript can't lex, are pinned
against a corpus instead. `lint/scan-source.differential.test.ts`.

**G4.58 · Commit-message shape.** `scripts/lint-commit-message.mjs` holds the only definition of
the subject shape, and both the `commit-msg` hook (`.githooks/`, wired by the `prepare` script) and
a step in CI's `unit` job call it. Line 1 carries the whole summary within 72 characters, since
`git log --oneline` joins a multi-line first paragraph; per-change lines go below a blank line. The
scan reads the `prepare` wiring, the hook and the CI step. `lint/commit-message-shape.test.ts`.

**G4.59 · The VR tag roster.** The windowing-hazard catalog in `docs/design/virtual-rendering.md`
and the tags cited under `src/` are one set, both ways, keyed on the tag column. The corpus (library,
styles, e2e requirement files) is read as raw text, since a citation is almost always a comment.
`lint/vr-tag-census.test.ts`.

**G4.60 · Spread-into-call declarations.** Every spread into a call's argument list in shipped source
is declared with what bounds its count, since a list past the engine's limit throws "Maximum call
stack size exceeded" at the call. A `bounded` row names its ceiling (`MAX_UNDO`, the parser's
nesting cap, the `spliceMany` chunk); a `gap` row says the count follows the document, which names a
defect. A splice a paste can scale goes through `src/lib/tree-operations/splice-many.ts` ::
`spliceMany`. Array-literal spread and rest parameters are out of scope. Rows key on file plus
enclosing function. `lint/spread-call-census.test.ts`.

**G4.61 · The production commit scope.** `invariants/commit-scope.ts` imports no build flag and
writes its depth counter at plain statement position. The scope defers the decoration engine's
in-commit `invalidate()`, so a `DEV` guard on it would break production alone, and `esm-env` reads
DEV as true under vitest, where no behavior test could see it. `lint/commit-scope-production.test.ts`.

**G4.62 · Text contrast.** Every `--code-tok-*` color in `editor-theme.css`, the grey text tokens,
the done-or-inert greys, every marker colour at `--syntax-marker-dim`, and faded raw-block text
clear WCAG AA (4.5:1) in both themes against `--color-surface`, the fence background, and (for UI
greys) `--color-bg`, compositing any opacity first. It's computed from the declarations because the
editor paints no background of its own, so axe would measure the host's palette. The code family is
derived by prefix (a new token is measured), and an unparseable value fails. The grey, marker and
done-or-inert families and the faded blocks are named lists in the test, so a new text token in one
of them needs its own row there. `lint/code-token-contrast.test.ts`.

**G4.63 · Bundled-plugin test boundary.** Every file under `src/lib/test/plugins/<plugin>/` imports
only the published entry points (`#lib`, `#lib/plugin.js`, `#lib/testing.js`), its own plugin's
source, another plugin's published subpath, the copyable test support, a relative path outside
library code, or an npm package. A deep `#lib` import names something the testing entry point is
missing; each allowlist entry names it, and a dead entry fails. `lint/bundled-plugin-test-boundary.test.ts`.

**G4.64 · The tree-ops layering.** `node-primitives.ts`, `unshare.ts`, `settle.ts`,
`content-write.ts`, `stored-as.ts`, `leaf-range.ts`, `node-ops.ts` and `chain-rebuild.ts` import only
downward, in that order. An import cycle passes every behavior test and `svelte-check`, so only a
source scan holds it. `lint/tree-op-ladder.test.ts`.

**G4.65 · Delimiter auto-pair parity.** Every editable prose surface (G4.44's set) routes its
`beforeinput` through
`src/lib/components/blocks/text/delimiter-autopair.ts :: applyDelimiterAutoPair`, and no other file
calls it, so what a typed delimiter writes and where the caret ends up has one answer.
`lint/file-rules.test.ts`.

**G4.66 · Relative scroll through `scrollBy`.** A correction that moves the scroll position by a
delta calls `Scrollport.scrollBy`, never `setScrollTop(scrollTop() + delta)`: the browser snaps a
fractional write to a device pixel, and only `scrollBy` carries the lost fraction into the next call.
`lint/file-rules.test.ts`.

**G4.67 · Menu presence census.** Every open menu is in one registry
(`components/menu/menu-presence.svelte.ts`): a menu joins by attaching `menuPresence.track(close)` to
its root element, so `menuChange` reads it open while mounted and `closeAll` (called by a document
swap and a mode change) can close it; the close is told which, so a draft is saved on a mode change
and dropped on a swap. Every menu element (the shared menu class, or a menu, listbox or dialog role)
carries that attach in its opening tag, or is listed with the reason it doesn't. A menu whose rows
write also passes `{ edits: true }` (unchecked), and one that mounts in reading mode anyway closes at
once and warns `menu-opened-in-reading`. `lint/menu-presence-census.test.ts`,
`components/menu-presence.test.ts`.

**G4.68 · Registry reads take the editor's grammar.** The inline syntax, widget kind, directive and
completer registries are process-wide, and the editor's grammar leaves out a plugin its `plugins`
prop didn't list. Every internal reader takes the grammar, or the whole `Reading`
(`src/lib/schema/reading.ts`: grammar, link resolver, mode), as a required parameter. A fallback to
every installed plugin is spelled only in the listed places, and a write that reparses a block the
editor drew reads with the link resolver it was drawn with. `lint/registry-view-reads.test.ts`.

**G4.69 · The defaulted readers stay at the edge.** The published `parse` and `parseInline`, and the
plugin barrel's `computeInlineContent`, read every installed plugin when no grammar is given. Code
inside the library calls `readBlocks` and `readInline`, which require one; only the public entry
points, the test kits and listed editor-free code may import the defaulted readers.
`lint/registry-view-reads.test.ts`.

**G4.70 · Decorations keep off the editor's attributes.** A block decoration can set attributes on a
block's own element (a block host, a list item's box, a table row or cell), and a `data-` name the
editor uses there would answer the editor's lookups or paint a state it never set.
`src/lib/decorations/reserved-attrs.ts :: RESERVED_BLOCK_ATTRS` must match exactly the names the
scan finds on those elements' tags, in `closest()` lookups, and in stylesheets reading them (an
`attr()` paint included), so a name used only inside a block stays free.
`lint/reserved-block-attrs.test.ts`.

**G4.71 · Blank means spaces and tabs.** GFM (§ 2.1) calls a line blank when it holds only spaces
and tabs, but `String.trim()` drops every Unicode space, so an emptiness rule built on it deletes a
typed non-breaking space. Test document text with `src/lib/core/lines.ts :: isBlankText`; the scan
fails `trim()` as an emptiness test elsewhere, except for strings no document holds and the math and
mermaid blocks' "does the render draw anything". `lint/file-rules.test.ts`.

**G4.72 · The grammar's whitespace is GFM's.** Where a rule wants spaces or tabs, it says `[ \t]`;
where the spec says whitespace, it means the ASCII set of § 2.1
(`src/lib/core/lines.ts :: isWhitespaceChar`). JS `\s` and `trim()` admit a non-breaking space, so
the scan fails both in `core/parsers/`, `core/directive/`, the other grammar files and the bundled
plugins (which read the helpers through `src/lib/plugin.ts`). Emphasis is outside it (its flanking
rule is Unicode), and the allowlist carries a reason per file. `lint/file-rules.test.ts`.

**G4.73 · A leaf component exports `blockApi`.** Every component calling `createEditableLeaf`, test
fixtures included, exports `blockApi` and no `BlockComponent` member of its own. A flat copy out of
the factory's object still compiles while dropping what it skipped (no `insertMarkdown` means every
`editor.insertMarkdown()` declines). The scan reads the member names off `BlockComponent`'s
declaration, so a new member joins it. `lint/leaf-block-api-export.test.ts`.

**G4.74 · The open last line has one writer.** The walk that adds or drops the ending on a block's
last line, through every container holding it, is private to `tree-operations/open-tail.ts`, and only
the commit's two steps call it (G1.41). A route that ended the tail itself would be the rule's second
copy. `lint/file-rules.test.ts`.

**G4.75 · One leaf write.** New text for a leaf is written one way at every depth: a commit through
`src/lib/editor-actions/block-edit-core.ts` :: `commitLeafText`, or the keystroke's in-place write,
`src/lib/editor-actions/leaf-write.ts` :: `writeLeafInPlace`. Each step of the write has a short list
of files allowed to name it (an aliased import counts):

- the content write itself (`updateNodeContent`): those two, the keystroke's trial reparse and the
  container-matching paste
- a write in place that skips the reparse (`writeOwnRaw`, `installOwnRaw`): table cells,
  `rewriteLeafInPlace` and find and replace's private copy
- the document as an owner-less body (`documentBody`), plus the trial reparse's throwaway copy
- the task-marker reconcile: the content write, the join and `replaceBlock`
- a replacement's escape for its container: `replaceBlock` alone
- the typing batch (push, join, pause): `typeInLeaf` alone
- the chain-depth check (G1.20): the in-place write alone

A route copying any step fails with that step's reason. The content version and the join have their
own scans (G4.52, G4.76). `lint/leaf-write-doors.test.ts`.

**G4.76 · Joins into a leaf.** Two texts joined into one leaf go through
`src/lib/tree-operations/node-ops.ts` :: `joinIntoLeaf` (the join cleanup in
`leaf-range.ts :: joinLeaves`, the kind's and container's rules, and a reparse). The scan declares
every file calling `joinIntoLeaf` or naming `cleanJoinedRaw`, and reads the text each file hands a
leaf (a `.raw =`, or a leaf write's argument, followed to its value): text built from more than one
source is a join, so its file names the cleanup or is listed with why it isn't (a paste inserting
between one leaf's own halves). `lint/cross-node-join-doors.test.ts`.

**G4.77 · One way to belong to no plugin.** `src/lib/schema/plugin-install.ts` :: `registerAsCore`
runs registrations as if no plugin were installing. It has three callers:

- `src/lib/components/editor-built-ins.ts` :: `registerEditorBuiltIns`, the editor's own bootstrap,
  which the test reset keeps
- a registry's `registerCore`, for a built-in key the registry can't recognize itself (a code
  language, a context-menu row), also kept by the reset
- `activateDirectives`, around the directive grammar, which the reset drops

The scan matches the bare name, so an aliased import is caught at its import line.
`lint/file-rules.test.ts`.

**G4.78 · The editor's built-ins come in one way.** `registerBuiltInBlocks`,
`bootstrapCodeLanguages` and `registerDefaultContextActions` are called only from
`src/lib/components/editor-built-ins.ts` :: `registerEditorBuiltIns`, which runs them as no plugin
(G4.77). Called anywhere else, whichever plugin's setup gets there first owns the paragraph component
or the code languages. Shipped source only; unit tests may call the bootstraps directly.
`lint/file-rules.test.ts`.

**G4.79 · One way to ask whether it's a grid.** Ask through
`src/lib/schema/block-kind-descriptor.ts` :: `isGridKind` (or `isGridDescriptor` with a descriptor in
hand). Any other file with a `'grid'` string in its code fails, a list check like
`['strip', 'grid'].includes(contract)` included; declaring the contract, naming it in the type,
`role="grid"`, and the insert menu's search keyword are left alone. `lint/file-rules.test.ts`.

**G4.80 · One answer to what a range covers.** The delete, the copy, the format toggle and the
overlay read a `RangeCoverage` off a `CoveredRange`, both classes with a private field built only by
`selection/range-coverage.ts :: coverRange` and `rangeCoverage`, so a hand-built one doesn't compile.
The scan covers the other way to grow a second answer: in `selection/`, only `range-coverage.ts` and
the caret walks in `path-lookup.ts` and `caret-target.ts` call `isCollapsedContainer` or
`collapsedContainerHiding`. `lint/file-rules.test.ts`, `eslint.config.js`.

**G4.81 · One table row snap.** A cross-block range with a table endpoint takes that table's rows
whole. `snapCrossBlockTableEndpoints` runs in `coverRange` for the delete, the copy and the
overlay, and in the selection state's stored `start` and `end`, which the collapse keys, the undo
seed and the extension paths read.
`lint/file-rules.test.ts`.

**G4.82 · The task-marker rule has one home.** `reconcileTaskMetadata` is named only in
`tree-operations/list/reconcile-task.ts`, where `writeKeepingTaskMarker` calls it. Every file that
writes into a child slot (through that wrapper or in place with `writeOwnRaw`, `installOwnRaw`) is on
one list with its role: the content write, the leaf join, the block replace and a range delete's
survivor wrap their write, and the rest say why they need no wrapper (a table cell holds no list
item). A file listed as wrapping must call the wrapper. `lint/leaf-write-doors.test.ts` (the G4.82
and G4.82b rows), with G1.42 as the runtime half.

**G4.83 · Every plain fragment read says why.** Bytes written into a child slot are read the way a
reload reads them there, through `tree-operations/list/task-paragraph.ts :: fragmentReaderAt` (in a
list item's first slot, behind its whole marker line), or `slotReaderAt` and `childSlotAt` for a
caller holding only a path. A plain `readBlocks` left in `tree-operations/`, `selection/` or
`editor-actions/` is listed in the manifest with its reason (a probe that installs nothing, the
paste's re-read of a clipboard block). `lint/manifest-rules.test.ts`.

**G4.84 · One place says where a leaf's bytes are stored.** A `StoredAs`
(`src/lib/schema/stored-as.ts`) answers four things about a position: block or plain text (a table
cell), the bytes its write rules would keep, how a reload reads them there, and what a write
installs. It's a branded type built only by `tree-operations/stored-as.ts :: storedAsAt` and
`storedAsIn`, from the tree, so nothing reads a candidate behind a hand-written copy of a
container's marker. `lint/file-rules.test.ts` holds the `as StoredAs` cast to that file.

**G4.85 · A removing rewrite reads through the store.** The join cleanup and the edge delete read
every candidate through `core/inline/live-edit/read-back.ts :: readBack` with G4.84's store (a
required field of their query), never a parse of their own, since a top-level read forgets the
container the bytes land in. `lint/file-rules.test.ts` keeps `readBlocks` and `parse` out of every
`.ts` module in `components/blocks/text/` and `core/inline/live-edit/`, and
`test/tree-operations/store-routes.test.ts` runs every place a store is made on bytes a lone
paragraph's store reads differently, failing a store made where no row runs.

**G4.86 · The list marker has a short list of readers.** Reading a list item's marker off its
metadata (or off a parse cast to carry one) is for the code that builds, renumbers, draws or
dumps a list. A rewrite that wants to know how its bytes read under the marker asks the store
instead. `lint/file-rules.test.ts`, with each reader and its reason.

**G4.87 · One writer of the scroll position.** Every write to the editor's scroll position lives in
`windowing/scroll-owner.ts`, which decides who owns the position first (the browser's anchoring, a
held scroll into view, or the height correction). Every other module gets a `ScrollportReader`,
which has no write method (pinned with `@ts-expect-error`). The scan catches the rest: `scrollTop`
assigned, `scroll`/`scrollTo` given a position, `scrollBy`, `setScrollTop`, `scrollIntoView`, or
opening a writable port, anywhere but the owner and the port (`rects.scrollTo(path)` goes through the
owner and passes). Two more rows list the `scrollToMount(` callers and, inside the owner, who writes
the port (`writeScroll` and the measure round's correction). The few files keeping writes of their
own (a drag's autoscroll, two listboxes) say why. `lint/file-rules.test.ts`.

**G4.89 · One in-leaf range replace.** Replacing a range of one leaf is
`tree-operations/leaf-range.ts :: replaceRangeInLeaf`: it cuts back to the painted text, moves both
ends off any surrogate pair, and cleans the join; joining two leaves is `joinLeaves` beside it. The
scan holds `snapToScalarBoundary(` to `leaf-range.ts`, the split's two cuts
(`node-ops.ts :: cutPastLineEnding`, `structural-suffix.ts :: cutKeepingStructure`),
`selection/char-endpoint-snap.ts` and `core/lines.ts`; `joinLeaves(` to `leaf-range.ts` and the
merge in `node-ops.ts`; and fails a hand-written splice of one leaf's bytes
(`raw.slice(0, a) + … + raw.slice(b)`) in the live editing paths unless the file says why (the range
delete and typing after a cross-block delete are known gaps). `lint/file-rules.test.ts`.

**G4.90 · A paste cuts like typing.** Pasting over a selection inside one block writes what typing
the same text over it writes: every file naming the paste's range (`preDelete`) cuts it through
`replaceRangeInLeaf` with the pasted text, or says why not (the code block's paste stays a literal
splice). `lint/file-rules.test.ts`.

**G4.91 · A focus call scrolls nothing unless it says why.** `focus()` scrolls an off-screen element
into view by itself, a scroll G4.87 can't see, so a caret's focus passes `preventScroll` and asks the
scroll owner instead. The scan flags `focus()` with no arguments or without `preventScroll` (a block
component's `focus(offset)` passes), and every flagged file is declared with its reason; the manifest
is per file. `lint/file-rules.test.ts`, with G1.45 as the runtime half.

**G4.93 · One pick of the block a round keeps still.** Which block stays still across a measure round
is picked once for the document, level by level (`windowing/list-tree.ts :: createListTree`, each
level through `windowing/steady-block.ts :: heldBlock`), and the scroll owner corrects only by the
branded distance `heldDelta` makes, so a hand-made distance or block doesn't compile
(`test/windowing/steady-block.test.ts`). The scan holds the brand casts to `steady-block.ts` and
every `compensate`, `heldBlock` or `heldDelta` call to its declared file, function and count.
`lint/file-rules.test.ts`.

**G4.94 · The editor's own selections have one store and one set of writers.** A gap caret and an
inline widget selected whole are written only through `selection/place-caret.ts` (`placeGapCaret`,
`selectWidgetWhole`), which clear the browser's range in the same batch, and a selected widget is
held only in `selection/selection-state.svelte.ts`. A `.setGapCaret(` or `.selectWidget(` call
elsewhere fails, and so does a `$state` cell typed `WidgetTarget` outside the store; readers ask the
store (`widget`, `widgetIn`, `widgetRange`). `lint/file-rules.test.ts`, with G1.46 as the runtime
half.

**G4.95 · What a range covers is decided once.** `selection/range-coverage.ts :: rangeCoverage`
says which edges a range keeps, which subtrees it holds whole and which table cells, and the delete,
copy, format toggle, overlay and table cell painting read that. The helpers that work it out (the
in-between walk, rectangle bounds, closed-unit checks, table-endpoint cell math) are called only in
`range-coverage.ts`, their defining files, and a short list of cell edits with reasons.
`lint/file-rules.test.ts`.

**G4.96 · A commit rebuilds each container once.** After `commitMultiScope` runs its mutation, it
rebuilds every child list it was handed and each container above, up to the top level, so a mutation
that rebuilds its own scope (or above) gets that container rebuilt twice. Container rebuild calls
live in `schema/`, `tree-operations/chain-rebuild.ts` and `tree-operations/unshare.ts`; any other
caller is listed with why no commit repeats its rebuild, counted per name. Three honest exceptions
are listed as such (an item merge's list, a pasted list merge, the range delete across containers).
A mutation needing a node's bytes early (a Tab's new sublist) calls `ContainerScope.rebuild`, which
warns in dev if that node is the scope, above it, or still shared with an undo entry. When several
child lists share a container, it's rebuilt once, after everything below it
(`src/lib/tree-operations/chain-rebuild.ts :: sharedChainLevels`). `lint/container-rebuild-homes.test.ts`;
`editor-actions/commit/commit-rebuild-once.test.ts` counts rebuilds per node, and
`tree-operations/chain-rebuild-shared.test.ts` covers a line one chain spills into a later chain's
list.

**G4.97 · One way a child's height reaches its list.** A block, a list item and a table row each
measure through `windowing/use-measured-child.svelte.ts :: useMeasuredChild` (at mount, after an edit,
on a resize), and the list writes the height only in its private `applyMeasured`, keyed by the
child's id. No list reports its own height upward. The scan counts every table write, cache write and
registration by file and function, and keeps the measure channel's key to its defining file, its
provider and the hook. `lint/file-rules.test.ts`, with
`test/windowing/measured-child-routes.svelte.test.ts` running every child kind through every trigger;
G1.47 is the runtime half.

**G4.98 · One place throws measured heights away.** Only
`windowing/layout-state.svelte.ts :: createLayoutState` drops measured heights: a new document or a
mode flip calls `forgetMeasuredHeights` (leaving the width version alone, or every list rebuilds and
loses the held block), and a width or font-size change calls `rebuildForNewGeometry`, which bumps
it. Layout state hands out the height estimator without `dropMeasured`, and two scans in
`lint/file-rules.test.ts` fail a second estimator (or a cast back) and a width-version write
elsewhere. `test/windowing/height-lifetime-routes.svelte.test.ts` runs all four routes and the three
changes that keep the heights.

**G4.99 · A windowed list keeps its table height while blocks mount.** Svelte mounts newly windowed
blocks one at a time, and a layout read in between sees a short list (at the document's end the
browser pulls the scroll up for good). So every component rendering spacers calls
`windowing/use-window-floor.svelte.ts :: useWindowFloor` on the box around them, holding it at the
table's whole height until the render ends. `lint/file-rules.test.ts` fails a spacer component
without it; `e2e/tests/plugins/view-swap-end-scroll.spec.ts` drives the swaps (VR-16).

**G4.100 · A block's own line ending.** When a block's editable element writes its own text, it
hands the list the new text plus the ending the block already had, so a document saved without a
final break keeps none. That lives in `components/blocks/surface-write.ts` (`writeText`, and
`withOwnEnding` for routes not on it yet). New text takes the block's own ending, else the
document's, picked today in two places: a typed or completed line break reads the getter
`editable-surface.ts :: lineEnding`, and the code block's dissolve (`code-context-actions.ts :: run`).
`lint/call-site-rules.test.ts` fails a `trailingLineEnding` or `ownTrailingLineEnding` call under
`components/blocks/` outside those places (allowlisted by function), and a read of the getter
anywhere but a typed line break or a check that writes nothing.

**G4.101 · A typed write asks for itself.** The kind cue and the on-type completer answer typing,
never a command, a paste or a repair. Only `surface-write.ts :: writeText` asks them, for a write with
the `typed` intent. `lint/file-rules.test.ts` fails an `afterTypedWrite` or `completeLineOnType` call
under `components/` or `selection/` anywhere else, and `blocks/surface-write-intent.test.ts` checks
which intents ask.

**G4.106 · Retired upward.** The rule was: a spec reloads the editor's own text through
`reloadContent`, since a `source` write equal to the text the editor holds changes nothing. The test
page's `__test.setSource` (`src/routes/test/editor/test-probes.ts`) now loads every write as a fresh
document (through `HarnessSource`, `src/routes/test/editor/harness-source.svelte.ts`), and throws when
the editor never replaced its document, so `loadContent(await getSource())` really reloads.

**G4.107 · An `edit` fires at its write.** A commit, a keystroke written in place, undo and redo,
and a replace-all each emit `edit` as their bytes land; nothing holds one back, since a held one fires
against whatever document is there by then. `input` also promises the block kept its kind
(`components/link-reference-map.ts` relies on it), so only the in-place write
(`editor-actions/leaf-write.ts`) declares it. `lint/edit-emitters.test.ts` keys each emit on its
function.

**G4.108 · One replace for every destructive gesture over a range.** Backspace, Delete, cut, typing,
an IME composition, paste and a command key over a cross-block range all go through
`selection/cross-block/range-replace.ts :: replaceRange`, which picks the removal from the coverage
and keeps the gesture one undo entry with one landing. `rangeDelete`, `removeHeldWhole`,
`commitGridLineDelete` and opening an `undoStep` under `selection/cross-block/` are allowed there only;
the range indent (`selection/cross-block/range-indent.ts`) opens its own step, since it removes
nothing. `lint/file-rules.test.ts`.

**G4.109 · A rebuilt container starts from its source's bytes.** A strip rebuild keeps a line by
pairing it with the container's previous bytes, so a container built around another's children (the
quote an alert leaves after a lift) starts with that container's `raw`; with an empty `raw` its first
rebuild respells every line. `lint/fresh-container-bytes.test.ts` fails an object literal with both
`raw: ''` and `children` under `tree-operations/`, `editor-actions/` or `selection/`, outside a short
list of builders of genuinely new containers.

**G4.111 · One write for a block's own text.** A block's editable element changes its own text
through `components/blocks/surface-write.ts :: writeText`, which gives undo the caret from before the
key, keeps the line ending, and puts the caret back. `lint/call-site-rules.test.ts` fails an
`updateBlockContent` call under `components/`, `selection/` or a plugin's code (`src/lib/plugins/`,
`src/routes/test/plugins/`) elsewhere, except the few listed by function that are still to move.

**G4.112 · An indent key over a range has one route.** Over a range, Tab, Shift+Tab and any key bound
to an indent command nest or lift every list item the range reaches once, through
`selection/cross-block/range-indent.ts :: indentRange`. Three rows hold it: the two item moves
(`tree-operations/list/item-moves.ts :: nestListItem`, `liftNestedItem`) are called only from a
caret's Tab in `editor-actions/list-context.ts` and from the range indent; a container's chords go
through `editor-actions/container-block-component.ts :: dispatchContainerChord`, which leaves a key a
live range owns to the range; and a range replace's command insertion is built only in
`selection/cross-block/keydown.ts`, which leaves Tab out. `lint/file-rules.test.ts`.

**G4.113 · Retired.** The rule was: a `$$` source's opener, body and closer are read only in
`src/lib/plugins/latex/math-shape.ts`. It still holds, as G4.131's `$$` row, which also fails a
closer search written by hand.

**G4.114 · One paint decision under a range.** Whether a block under a cross-block range paints one
box, its selected text, or nothing is `src/lib/selection/primitives.ts` :: `classifyBlockForSelection`
(and `blockPaintsWholeBox`), and whether the range spans blocks at all is `rangeSpansBlocks` in the
same file. `lint/file-rules.test.ts` fails a read of the coverage's roots, edges or an end table's
cell run outside `src/lib/selection/` (`rootHolding`, `coveredRootHolding`, the `wholeRoots`,
`coveredWhole`, `startEdge`, `endEdge`, `startCells`, `endCells` fields, dotted or destructured), and a
`pathsEqual` of a range's `start.path` and `end.path`. A bracket read gets past it.

**G4.115 · A cut writes its copy's payload.** Each kind of selection a block can copy has one
`ClipboardArm`, written where that selection lives (each block's clipboard code, and
`selection/cross-block/clipboard.ts` for a cross-block range); the shared parts are in
`components/blocks/clipboard-step.ts`. `runClipboardCut` runs the arm's own copy before anything
waits, then its removal, so a cut can't write different bytes from a copy; there's no cut payload
type, and an `async` copy doesn't type-check. `lint/call-site-rules.test.ts` fails a `.setData(` call
in production code outside those copy functions, `clipboard-step.ts :: writeShownSelection` (the
browser's own selection string, for reading mode, an unclaimed copy, and the code block) and the
menu's paste event.

**G4.116 · The pending break hears a key first.** Shift+Enter at the end of a text block opens a
line and writes nothing; Backspace and ArrowLeft take it back
(`components/blocks/text/pending-break-keys.ts`). The shared keymap's ArrowLeft would leave an empty
paragraph with the line still open, so the pending break asks first. The rows in
`e2e/tests/presentation/pending-break-keys.spec.ts` are the guard, and
`lint/pending-break-key-order.test.ts` fails when `TextEditableBlock.svelte`'s keydown calls the
shared keymap before the pending break.

**G4.122 · The directory import graph.** Every production import under `src/lib` goes into a graph of
top-level directories (and root files as nodes of their own), runtime edges kept apart from
type-only ones. The graph matches the edges in `lint/directory-layering-baseline.ts`: a new edge
fails naming the imports behind it, and a listed edge that's gone fails until its line is deleted.
The scan can't refuse a line someone adds, so a new baseline line gets a reviewer's eye. Two runtime
cycles are still listed, {`core`, `schema`, `caret`, `windowing`, `invariants`, `tree-operations`,
`debug`} and {`selection`, `editor-actions`}. Unconditionally, nothing in `tree-operations/` imports
from `editor-actions/` or `components/`, and an unresolvable import fails.
`lint/directory-layering.test.ts`.

**G4.123 · An item's children leave it under the order check.** Backspace's unwrap of a list's first
item and Enter in an empty outermost item both dissolve the item through
`tree-operations/list/item-partition.ts` :: `dissolveItem`, which splits its children inside G1.61's
check. Three rows in `lint/file-rules.test.ts`: the splitter `itemPiecesInOrder` is called in that
module only, each call sits inside `keepingListOrder(…)`, and
`tree-operations/list/list-builders.ts` :: `assembleListHalf` is called only there and in the paste
break-out.

**G4.125 · One reading of a block's widgets.** The widgets a prose block draws include ones a link or
emphasis wraps, which the top-level inline list doesn't show.
`src/lib/components/blocks/text/widget-adjacency.ts` :: `widgetsIn` lists them all, and the
widget-edge click, the caret painted there, the arrow keys at a widget edge and every selected-widget
reader ask it (`findFirstEdgeWidget` and `findLastEdgeWidget` beside it answer what the block draws
first or last). `lint/file-rules.test.ts` fails an `isInlineWidget(` or `flattenInlineWidgets(` call
under `components/` or `src/lib/plugins/` outside that file.

**G4.126 · Every package is bundled before a page asks for it.** Vite's dev server pre-bundles the
packages its scan finds from the route files; one it misses is bundled when a page first imports it,
reloading every open page and failing any e2e spec mid-load. `vite.config.js` :: `posixScanEntries`
fixes SvelteKit's backslashed globs on Windows, and a package loaded with `import()` is listed in
`optimizeDeps.include`. `lint/dev-prebundle.test.ts` fails a scan glob matching no route file, or a
bare-package `import()` under `src/lib` or `src/routes` missing from the list.

**G4.127 · A check that skips without a DOM says so.** Most unit test files run in plain Node with no
`document`, so code that asks whether one exists picks what those tests run. A dev check that would
do more with a DOM asks `src/lib/assert.ts` :: `documentForCheck`, which warns `needs-dom` (failing
the unit test, whose fix is the jsdom docblock). Any other DOM branch gets a row in G4.127's table in
`lint/file-rules.test.ts`, keyed by file and function and saying what runs without one; the test
fails when a function's count of DOM tests (`typeof document`, `typeof Element`,
`globalThis.document`, `'document' in globalThis`) moves off its row.

**G4.128 · Every kind is asked about its empty state.** The `placeholder` hint is decided in
`components/blocks/placeholder-hint.svelte.ts`, which every `createEditableSurface` block reads
through the attributes its element spreads. `test/components/placeholder-every-kind.svelte.test.ts`
mounts every registered kind, bundled plugins included: each shows the hint in an empty fixture or
carries a reason it's never asked.

**G4.130 · One span for every write over a code block range.** Where the mode shows a code block's
fence lines, an edit over a range rewrites the range; where it hides them, only the range's part
inside the body, and a range on fence structure alone writes nothing.
`src/lib/components/blocks/code/code-fence-boundary.ts` :: `editSpan` answers that for every route
(delete, type-over, IME, a bracket wrap, cut, paste, a command's removal). Two rows in
`lint/file-rules.test.ts`: `clampRangeToBody(` is called only there and in `code-indent.ts`, and in
the code block's folder `fenceLinesShown` is read only where it's derived, as the whole last argument
of `editSpan`, or as the last condition of an early return.
`test/blocks/code/code-fence-edit-span.test.ts` runs each route in both modes.

**G4.131 · A block syntax's bytes are read and written in its own module.** Two routes that each read
a block's syntax drift apart, so each syntax gets one module, and `lint/file-rules.test.ts` keeps a
row per syntax (`SYNTAX_MODULES`) that fails a copy elsewhere:

- **`$$` math.** `src/lib/plugins/latex/math-shape.ts` (`readMathSource`, `mathCloserLine`,
  `mathBlockLines`); `math-source.ts` :: `sliceMathSource` picks between it and the ` ```math ` fence
  form. The row fails `$$` spellings (strings, regexes, the fence constant, line splits) under
  `src/lib/plugins/latex/` outside that module. `test/plugins/latex/math-shape-parity.test.ts`,
  `math-block-writers.test.ts`.
- **Table rows.** `src/lib/core/parsers/table-line.ts` reads rows (`rowCellSpans`, `opensOnPipe`,
  `wrappedInPipes`, `boundaryPipeAt`) and writes them (`tableRowLine`, `tableDelimiterLine`,
  `newTableLines`, `spliceCells`). The row fails a row's edge pipe or a delimiter cell spelled by hand
  anywhere else in `src/lib/`. `test/core/parsers/table-row-writers.test.ts` pins the bytes, LF and
  CRLF.
- **Table opening.** `src/lib/core/parsers/table.ts` :: `matchTableOpening`, asked by the parser and
  the grid paste; a header's cell count compared with a delimiter's `columnCount` elsewhere fails.

**G4.133 · An e2e mode switch waits for the mode.** A mode the editor never applied leaves it in
source mode, where most live-mode assertions pass anyway. `EditorPage.goto` checks the mode its query
names, `EditorPage.setPresentationMode` waits for the one it sets, and `src/lib/e2e/mode-switch.ts`
holds the clicks (`clickModeToggle`, `clickModeButton`), each waiting on `data-presentation`.
`e2e/lint/mode-switch.test.ts` fails a bridge `setPresentationMode` call outside `editor-page.ts`,
and a mode toggle or button mentioned outside `mode-switch.ts` and its two allowed specs.

**G4.141 · One writer for the drawn caret.** `data-caret-drawn` (the attribute that hides the
browser's caret) and `md-drawn-caret` (the bar) are named in `caret/drawn-caret.svelte.ts` alone
(the bar also in `caret/block-content-selector.ts`, so a block-content lookup skips it), so the
attribute and the bar change in one paint and there's one bar per editor.
`lint/drawn-caret-guards.test.ts`.

**G4.142 · `caret-color` on the known surfaces only.** The production CSS and Svelte styles declare
`caret-color` for `[data-caret-drawn]`, the cross-block rule, `.whole-block-input` and the gap
caret's proxy, each with its reason, and nothing else: another rule would hide or recolor the
browser's caret behind the drawn caret's back. `lint/drawn-caret-guards.test.ts`.

**G4.143 · Every caret write asks for a paint.** `caret/widget-offset.ts` writes the native selection
only inside `createCaretWriter`, whose writes and clears call `drawnCaret.request`;
`test/caret/caret-writer-request.test.ts` calls every writer method and counts one request each (its
table typed over the writer's keys). The frame callback in `caret/drawn-caret.svelte.ts` calls
`paint` and nothing else, keeping G4.4's allowlisted frame paint read-only.
`lint/drawn-caret-guards.test.ts`.

**G4.144 · The old widget and gap caret painters and the edge ring stay gone.** Nothing under
`src/lib`, tests included, names the classes the old widget and gap carets painted with
(`md-snap-after`, `md-snap-before`, `md-snap-caret-active`, `gap-caret-line`), the edge ring's names
(`md-edge-held`, its token, `EDGE_HELD_CLASS`, `heldElements`), or a caret blink `@keyframes` other
than `md-caret-blink-a`/`-b`. A second element painting a caret cue is a second caret; draw it as a
state or a look of the drawn caret. `lint/drawn-caret-guards.test.ts`.

**G4.145 · One rule for whether a click follows.** A file that handles a click doesn't test
`ctrlKey || metaKey` (or `!ctrlKey && !metaKey`) itself; it asks `src/lib/activation-click.ts` (through
`EditorPolicies.activationClick`, `EditorContext.isActivationClick` or a widget's
`isActivationClick` prop), which reads the mode and the host's `linkClick` at the click. The
allowlist holds the reads that decline a modified key or press, and the diagram's zoom and
commit shortcuts. `lint/file-rules.test.ts`.

**G4.146 · One answer to "did this press travel".** Nothing measures a release against its own
press record by hand: the editor root's press tracker (`createPressTracker` in
`src/lib/activation-click.ts`, fed in the capture phase) answers for the follow rule, the margin
drag, a widget's press and a rendered block's click. A second record would let one route call a
release a click while another calls it a drag. `lint/file-rules.test.ts`.

**G4.147 · A memory change repaints the caret.** The caret memory's `onChange` (wired to
`drawnCaret.request` in `components/Editor.svelte`) hears every call that changes the side, the
pending marks or a record, and none that changes nothing, since a typed letter sets the side on
every key. `test/caret/caret-memory-repaint.test.ts` reads the methods off the object, so a new one
joins its table of changes or its exemptions (reads, the column, a write's own hold), each with a
reason.

**G4.148 · The look costs a key outside brackets nothing.** A letter typed mid-word with no `[…]` or
`<…>` around it, live and source, in a block of one construct and of two hundred: one look answer
however often the key paints, no trial insertion, parse or screen read, the same nodes visited in
both blocks, and the same paints as before the look. `test/caret/caret-look-cost.svelte.test.ts` on
the `caretLook*` counters; `test/blocks/text/next-byte.test.ts` pins the shortcut's condition from
both sides.

**G4.149 · The preview is the spend, dry.** `caret/next-insertion.ts :: createInsertionRecords` runs
one loop for a write's hold and for the preview the caret's look reads, and a record's `apply`
changes nothing: one that waits on returns `kept`, which the hold runs when the write lets go.
`test/caret/next-insertion.test.ts` applies each record twice and compares every preview with its
spend.

**G4.150 · One placer for a hidden edge.** Which side of a hidden edge a letter takes is decided
in `components/blocks/text/edge-seat.ts :: seatAt` alone, from the caret memory's record. No file
names an arrival side (`near`, `far`, `classifyArrivalKey`); only the resolver and the chip step read
`side()`; only the resolver calls `resolveEdgeSeat` or `typingOffset`; `EdgeAffinity` is named only
by its home, the memory, its two carriers and the resolver, and the carriers never compare it; only
the code block's language picker asks `arrivedByKey()`; and the edge files never branch on a kind
name, since the policy row says how an edge behaves. `lint/edge-rule-guards.test.ts`.

**G4.151 · One click-side check.** `components/blocks/text/click-side.ts :: clickSide` (a fresh
start past a line's end, or the side of a code chip's border) is called only from
`widget-interaction.ts :: snapClickToWidgetEdge`, the click entry both prose blocks' `onClick` go
through, and neither `onClick` measures the press against its text itself.
`lint/edge-rule-guards.test.ts`.

## Accessibility

Target: WCAG 2.1 AA, enforced by an `@axe-core/playwright` baseline gate (`test:e2e:a11y`, part of
`npm test`). axe runs over `.editor` across representative states (default content, an active
cross-block selection, the failed-block fallback, a blocked-scheme link) and fails on any violation
whose rule id isn't in the committed allowlist (`src/lib/e2e/a11y/axe-baseline.json`).

That allowlist is the log of deferred AA work, and it **only shrinks**. Every editable block carries
its kind as its accessible name, so an unnamed textbox fails the gate. Contrast is the one thing axe
can't settle (it measures whatever page the editor sits on), so G4.62 certifies the shipped palette
instead. The cross-block selection is painted by an overlay with the native selection suppressed, so
it's announced through a visually hidden `aria-live` region fed by `createSelectionDescription`.
