# Known Issues

Log of known editor issues. Each entry carries severity, affected files, a description,
reproduction (where relevant), and either a **Target** version (if scheduled via the roadmap)
or a **Why deferred** rationale (if not). Remove entries when shipped.

## Core editing

### Interactive reading mode (live task checkboxes) — deferred product question

**Severity:** minor (product decision, not a defect)
**Files:** `src/lib/components/blocks/list/ListItemBlock.svelte` (`toggleTask` gate),
`src/lib/styles/editor.css` (reading-mode checkbox `pointer-events: none`),
`src/lib/plugins/details/DetailsBlock.svelte` (the same class: the disclosure toggle)

Reading mode v1 is fully inert: task checkboxes render but do not toggle, and the details
disclosure (which commits an `open` metadata edit) is likewise gated. A rendered document
(GitHub, Obsidian reading view) keeps some of these live — whether reading mode should allow
a curated set of interactive edits is a product question, not a gating bug.

**Why deferred:** decided with the presentation-modes milestone's later rungs, where
block/inline granularity forces the same "which interactions survive" call anyway.

### Enter-at-end can produce a live block pair that reparses as one paragraph

**Severity:** minor (live-tree vs reload divergence; byte round-trip unaffected)
**Files:** `src/lib/tree-operations/node-ops.ts` (`splitNode` — the second half is minted
with empty `leadingTrivia` and no blank-line separator), `src/lib/core/serializer.ts`
(composition: `prefix + Σ(leadingTrivia + raw) + suffix` faithfully emits the missing gap)

Enter at the end of a paragraph splits `Hello world\n` into a first block ending in a single
newline and an empty second block (`raw: '\n'`, `leadingTrivia: ''`) — while the second block
is empty its bare newline reads as the blank-line separator, but typing `x` into it rewrites
that raw to `x\n`, and the document now serializes to `Hello world\nx\n`. That is a
single-newline join: GFM lazy continuation reparses it as ONE two-line paragraph, so
split-then-save-then-reload merges what the live session showed as two blocks. Byte
round-trip (`serialize(parse(s)) === s`) holds throughout — the divergence is
`parse(serialize(liveTree))` disagreeing with the live tree's structure, which the round-trip
oracles cannot see.

**Fix direction:** the sibling list-exit path solved its instance of this class by minting a
uniform blank-line separator at the exit gesture. The splitNode instance cannot reuse that
shape as-is: the separator would have to be minted before the successor kind is known (Enter
precedes typing), and the successor kind decides whether one is needed — only a paragraph
lazy-merges, a heading/list/blockquote never does. A kind-dependent separator is impossible
because the simulation's `ExpectationTracker` is model-free (it predicts only char insertion
and resyncs on structural gestures), so the trivia cannot change mid-typing. A uniform mint at
split (blank before every successor) double-counts the deliberate `pressEnter`+`softEnter`
thematic-break cadence and broadens para→heading spacing. So this needs its own design pass
with gesture re-choreography, decided against the merge/undo paths that read those bytes.

**Why deferred:** byte round-trip holds and the live session is self-consistent; the
divergence needs a save→reload boundary to observe. Not reachable by the current simulation
notes (they type para→heading and list-exit→paragraph, not Enter-at-end-then-paragraph).

### A body row wider than the header drops its surplus cells on first table edit

**Severity:** minor (live-tree vs reload divergence; byte round-trip at load unaffected)
**Files:** `src/lib/core/parsers/table.ts` (`buildRow` truncates cell children to the
header width), `src/lib/schema/container-rebuilders.ts` (`rebuildTableRowRaw` maps the
truncated children)

GFM (§4.10) ignores body cells beyond the header width, so `buildRow` truncates a wider
row's CHILDREN to `columnCount` while the row/table `raw` keeps the authored bytes verbatim.
Because `serialize` emits the table's own `raw`, `serialize(parse(source)) === source` holds
at load — the surplus cells survive a pure round-trip. The first `rebuildTableRowRaw` after
any table edit rebuilds the row from its (truncated) children, silently dropping the surplus
bytes. Reachable only by loading or pasting GFM with a malformed wider-than-header row; typing
cannot produce one (the grid fixes `columnCount`). The dropped cells were never part of the
model and never rendered, so no editor-visible content is lost.

**Fix direction:** none intended — preserving the surplus would require either phantom
children or a `raw` that disagrees with `children`, both of which violate CST-is-source-of-truth
(raw must rebuild FROM children). The accepted behavior is GFM-mandated truncation, normalized
on first edit like padding and delimiter normalization.

**Why deferred:** spec-compliant and byte-safe at load; the divergence needs a save→reload
boundary to observe and drops only non-model, never-rendered bytes — the same live-tree vs
reload divergence class, one rung less severe (the surplus is never user-visible).

### Nested structural content commit seeds its undo snapshot differently from the top-level path

**Severity:** minor (undo-selection nuance; the edit is correct and byte-safe)
**Files:** `src/lib/editor-actions/nested/nested-block-edit.ts` (`updateBlockContent` structural arm),
`src/lib/editor-actions/block-edit.ts` (the top-level sibling)

A nested structural content commit pushes its own undo snapshot at `{ path: leafPath, offset:
preEditOffset }`, while the top-level sibling skips to the debounced typing snapshot
(`snapshot: 'skip'`). The two content-commit paths therefore seed the undo selection
differently, and the nested coordinate names a pre-edit offset on a node whose kind/shape the
commit may have just changed. No corruption results — the restored caret is a view concern — but
the post-change coordinate and the top-level divergence want a joint look.

**Why deferred:** post-edit-caret-versus-pre-edit-tree selection semantics touch the debounce
seam and both content-commit factories together — a careful reconciliation, not a spot change.
Fold into the history-seam pass (limestone internal integration).

### writeText clipboard writes normalize line endings per-OS; wry reliability unproven

**Severity:** watch (no defect today; relevant to the limestone/Tauri integration)
**Files:** `src/lib/editor-actions/container-block-component.ts` (the whole-block Mod+C/Mod+X write)

The focused-block copy writes via `navigator.clipboard.writeText` — no ClipboardEvent exists in
a keydown handler. Two platform behaviors to watch: Chromium's `writeText` normalizes a
multi-line payload to the OS line ending (CRLF on Windows — the mermaid e2e normalizes before
comparing; intra-editor paste re-normalizes to LF, so no corruption), and the cross-block
clipboard code documents wry (Tauri) refusing `writeText` in some contexts — unverified for this
path. A setData-in-a-copy-event fallback was proven workable during implementation (the native
copy event does fire on the focused div; `preventDefault` currently suppresses it), at the cost
of per-surface `oncopy` handlers.

**Fix direction:** if the limestone integration observes a failed focused-block copy under wry,
switch the tail to the proven copy-event fallback behind the same shared seam.

**Why deferred:** watch-class; needs the real embedder to falsify.

## Code structure

### A destructive key at a mid-cell `<br>` edge needs a second press, which then deletes a non-adjacent byte

**Severity:** trivial (niche gesture; byte-safe and round-trip stable throughout)
**Files:** `src/lib/components/blocks/table/TableCellBlock.svelte` (the cell's
`enterWidget` dep to the caret-edge dispatch)

Threading the caret-edge dispatch through cells for inline reveal made it meet a
`<br>` — a non-reveal widget with no cell affordance (images render as alt text).
The cell's `enterWidget` sends non-reveal kinds to a caret step-over rather than the
prose image select-then-delete path, which had no cell paint and stranded focus.
Because `enterWidget` receives only the entry side, not the key, a Backspace/Delete
at a `<br>` edge takes that same non-deleting step-over: press #1 hops the caret to
the widget's far edge (no byte deleted), and press #2 — the caret now past the
widget — deletes a NON-adjacent byte, two positions past where the user pressed; a
Delete #2 at the trailing edge can land in the NEIGHBORING cell, and the caret
transiently parks on an off-cell DIV mid-gesture. Every end state is byte-safe and
round-trips. This is the pre-existing native `<br>`-in-cell behavior (0.9.14, when
Shift+Enter cells gained `<br>`); the step-over now shields the clean first press,
which previously stranded focus. Only reachable mid-cell — at the cell's text
boundaries the plan owns the key.

**Fix direction:** give the cell a key-aware caret-edge path for non-reveal
widgets — a one-press atomic delete on Backspace/Delete, a caret hop on arrows —
which needs the dispatch to hand `enterWidget` the gesture kind (or a separate
destructive hook). Bundled with the whole-table keymap migration below, since
both want the cell keydown path expressed declaratively rather than special-cased.

### Whole-table keyboard reorder (Alt+↑/↓) is unavailable

**Severity:** minor (a11y; table blocks only)
**Files:** `src/lib/components/blocks/table/cell-keydown-plan.ts`, `src/lib/schema/block-kind-descriptor.ts` (`table` registration), `src/lib/components/blocks/table/TableBlock.svelte`

Alt+↑/↓ now reorders fencedCode, thematicBreak, paragraphs, and list items among their siblings via the `block.moveUp/moveDown` keymap, matching the drag handle's tooltip. A table has no non-cell focus surface, and inside a cell Alt+↑/↓ is already bound — in `cell-keydown-plan.ts`'s hard-coded `SHORTCUTS` — to ROW reorder, so there is no free gesture to reorder the whole table block, and its drag handle's keyboard equivalent is missing.

**Why deferred:** the table's structural chords live in a second, hard-coded dispatch (`cell-keydown-plan.ts`) instead of the declarative `keymap` the other kinds use, so they also bypass the consumer `keybindings` override prop. Expressing a whole-table `block.moveUp/moveDown` cleanly is part of migrating the table chords onto the declarative keymap — its own deliberate change (the consumer-guide's rebindability promise should be scoped or fulfilled with it). Code and thematic-break keyboard reorder shipped; the table case is flagged here.

### Container shim hardcodes the component `editable` flag

**Severity:** minor (latent capability gap; no current misbehavior)
**Files:** `src/lib/editor-actions/container-block-component.ts` (the shim),
`src/lib/editor-actions/plugin/container.ts` (`ContainerBlockDeps`)

The container `BlockComponent` shim hardcodes `editable: true`, so a plugin container cannot declare
its surface non-editable (an opaque diagram whose only edit path is its own UI). No runtime consumer
reads the component-surface `editable` flag today — merge (`merge-rules.ts`) and search
(`document-scan.ts`) key on the descriptor's `editable` — so this is a contract-correctness gap, not
a bug: mermaid works at `editable: true`.

**Fix direction:** an `editable` override on `ContainerBlockComponentDeps` threaded from the factory,
the kind declaring the value on its descriptor and the shim reading it — but only after settling
which gates should read the component flag versus the descriptor flag (today only the descriptor
flag has readers).

**Why deferred:** the command→component channel wall this entry once bundled has shipped (a minted
command reaches the mounted component through `ctx.hooks`, threaded by the container/leaf factories'
`commandHooks` getter; mermaid migrated off its node→hooks map). The residual `editable` flag has no
reader, so the fix is cosmetic until a consumer needs a non-editable container surface.

## Test coverage

### Decoration tiers lack dedicated simulation gestures

**Severity:** minor (test coverage; the scripted decoration e2e covers the behavior)
**Files:** `src/lib/e2e/simulation/gestures/` (no decoration gestures),
`src/routes/test/plugins/sim-mark/sim-mark-plugin.ts` (the standing source)

The standing mark source installed under `?seed=sim` puts the decoration engine's per-edit
run — provide, bucketing, overlay paint — under the loaded-ops corruption oracles on every
keystroke. What it does not drive is the interaction surface: island caret/delete semantics
(edge Backspace/Delete, the two-press replace delete) and block-decoration chrome have no
simulation gesture and are covered by the scripted decoration e2e only. Per the culture rule
"new feature class → new simulation gesture", this is the ledgered remainder — the closure
matrix's Sim-oracle ◐ for both decoration rows (`docs/design/plugin-contract.md`) cites it.

**Fix direction:** an island gesture needs a deterministic island source in the sim document
(the fold fixture's `[>…<]` shape is the natural seed) plus edge-press vocabulary in the
gesture set; the block-decoration case rides the same source.

**Why deferred:** the engine spine — the part that runs on every edit and can corrupt state —
is now under the oracle; the island editing rules are scripted-e2e-pinned and unit-pinned.
Gesture design is its own bounded task, kept out of 0.9.22 to keep the milestone shippable.

### Cross-block-through-revealed-source blur spec is battery-order-sensitive

**Severity:** minor (test flake; the guarded semantics are unit-pinned)
**Files:** `src/lib/e2e/tests/plugins/latex-inline.spec.ts` (fixme'd final test),
`src/lib/test/blocks/text/widget-reveal-collapse.test.ts` (the cross-block bail unit pin)

The spec passes 55/55 in focused runs at any load (--repeat-each=5 --workers=4) but its
`waitForCrossBlock` times out deterministically inside the full plugins battery: the
Shift+ArrowDown keyboard-extend never engages cross-block. Falsified causes: the End-press
escape (removed), the 2s wait ceiling (widened to 5s), KaTeX font-swap geometry (fonts.ready
settle added), and the visual-line reader's dropped-range hard-false (0.9.27 gave both
`isAt{First,Last}VisualLine` a snapped-`fallbackOffset` resolution instead of `false` on
`rangeCount === 0` — correct independently, but an un-fixme attempt still red on the first
full-battery pass). Whatever battery-context state breaks the visual-line detection for this
gesture is unpinned. The product semantics (a cross-block sweep keeps the source revealed;
blur bails instead of folding) are unit-covered by the interaction factory's cross-block
bail case.

**Fix direction:** reproduce by bisecting the battery's spec set in front of this file to
find the state carrier, then pin the keyboard-extend geometry read it perturbs. With the
reveal transition asserts (G1.26) in place, an illegal reveal interleaving now fires
`invariant:reveal-transition` at the breaking transition — a reproduction that times out
with no invariant fire narrows the cause to legal-state geometry (the visual-line read),
not a reveal-machine interleave.

### IME composition lacks a simulation gesture

**Severity:** minor (test coverage; both composition harnesses shipped 0.9.25)
**Files:** `src/lib/e2e/simulation/gestures/` (no composition gesture)

The composition harness pins the IME contract at the handler level
(`test/blocks/editable-surface-composition*.test.ts`) and through real browser sequences
(`e2e/tests/ime-composition.spec.ts` — CDP `Input.imeSetComposition`), but the note-taking
simulation still types ASCII only. A composition gesture needs the CDP session threaded
into the gesture set on the "perform, settle, resync" pattern — bounded design work, not
trivially assembled, so it ledgers here per "new feature class → new simulation gesture".

### G1.27 may false-fire on Safari's duplicate compositionend

**Severity:** watch (no field report yet; Chromium-only test coverage)
**Files:** `src/lib/components/blocks/editable-surface.ts` (`onCompositionEnd`),
`src/lib/invariants/inline-transitions.ts` (`checkCompositionEndPaired`)

Safari has shipped duplicate `compositionend` fires per composition (WebKit 218603 among
others). The second end would reach G1.27 with `composing` already cleared and warn on a
legal-if-buggy browser sequence. If a field report shows it, relax the predicate from
per-window pairing to once-per-focus: track "saw a start since this element gained focus"
and fire only when even that is absent — the wired-end-without-start bug it exists to catch.

## Plugin containers

### Search replace skips matches inside childless opaque containers

**Severity:** minor (replace parity; find/highlight/navigate work today)
**Files:** `src/lib/editor-actions/search-replace.ts`

A childless opaque container (e.g. a mermaid block) is scanned as a leaf, so search finds,
highlights, and navigates to matches inside its raw. Replace skips those matches by design
(`isReplaceable` excludes container nodes): `replaceOne` no-ops, `replaceAll` excludes them, and
`replacedCount` reports only real replacements. The blocker is NOT metadata drift — the replace
path is reparse-based (substitute into a private clone's `raw`, then `parse(child.raw)` into
fresh nodes), never an in-place write, so the G1.12/G1.13 staleness probes never see it. The real
hazard is KIND-STABILITY: a substitution that breaks the opener fence line reparses to a different
kind (a mermaid block silently becoming a plain `fencedCode` or paragraph) — a hazard already
accepted for `fencedCode` leaves, but surprising to apply silently to a plugin's opaque kind.

**Fix direction:** a kind-aware write path — the kind translates a raw-range edit into a metadata
update (for mermaid, a `code` rewrite) and the ceremony rebuilds `raw` from it, so a replacement
can never flip the kind. `buildSubtree` now reparses through the instance grammar
(`parse(child.raw, { grammar })`), so a future kind-aware fix no longer inherits a
grammar-threading gap.

**Why deferred:** fold into the post-1.0 container editable-flag / opaque-write work (see
"Container shim hardcodes the component `editable` flag").

### Cross-block copy STARTING mid-chrome loses the container wrapper

**Severity:** minor (clipboard fidelity; container kind lost on paste)
**Files:** `src/lib/selection/clipboard-text.ts` (`collectCrossBlockText`)

The closer-synthesis fix covers a copy whose END lands mid-chrome (title/summary): it
synthesizes a chrome-only container and reparses to the same kind with an empty body. The
mirror direction — a copy that STARTS mid-chrome and extends into the body (and possibly past
the container) — is a distinct class the synthetic-chrome-only design cannot serve. The chrome
tail emits wrapper-less and the selected body is collected flat, so no opener or closer wraps
it. Repro: `collectCrossBlockText` from `:::note Ti|tle` into the body below yields
`"tle\nBody1\n\nBody2\n\nBel"`, which reparses to three bare paragraphs — the `note` kind gone.

**Fix direction:** a chrome-only synthetic node is semantically wrong here (empty body would
strand the selected body as top-level blocks after the container). Faithful bytes need the
chrome tail emitted as the container opener AND a synthesized closer injected where the walk
exits the container — a `collectCrossBlockText` structural change (container-exit tracking),
not the bounded closer-synthesis the END case uses.

**Why deferred:** the END direction is the shipped, reachable-today gesture. Fold the START
direction into the post-1.0 clipboard/hook generalization with the container-exit walk change.

### Container components re-export the component surface member-by-member

**Severity:** trivial (authoring ergonomics; all eight containers now guarded)
**Files:** `src/lib/components/BlockHost.svelte` (ref binding); every container component

A container block re-exports each `ContainerBlockComponent` member as its own `export const` so
`bind:this` on `<Comp>` in BlockHost captures the full surface — Svelte 5 instance exports are
individual top-level declarations, with no spread. That is ~11 identical lines in every container
component. All eight containers — the four plugin ones (callout, details, admonition, mermaid) and
the four built-ins (BlockquoteBlock, ListBlock, ListItemBlock, DirectiveContainerBlock) — now end
the block with a `satisfies ContainerBlockComponent` guard, so a forgotten member is a compile
error everywhere (the built-ins' redundant `!` non-null assertions are gone with it). The
duplication itself remains.

**Fix direction:** let a container expose ONE well-known instance export (its `containerApi`) and
have BlockHost read `ref.<that>` as the `BlockComponent` surface it stores and dispatches through
(`publishRefSlot`, `SelectionOverlay`, the parent's `innerBlockRefs` walks). Collapses the block to a
single line, but changes ref normalization for the single most load-bearing dispatch component and
the whole ref chain, across every block kind — blast radius only the simulation + VR suites observe.

**Target:** 1.2 — carry it with the container-seam ergonomics pass, not as a standalone pre-freeze
change to the ref chain.
