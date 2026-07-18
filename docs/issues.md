# Known Issues

Log of known editor issues. Each entry carries severity, affected files, a description,
reproduction (where relevant), and either a **Target** version (if scheduled via the roadmap)
or a **Why deferred** rationale (if not). Remove entries when shipped.

## Decoration & rendering

### Islands (widget/replace decorations) do not render in table cells

**Severity:** minor (parity gap; mark and block decorations serve cells today)
**Files:** `src/lib/components/blocks/table/cell-render.ts` (applies no islands) vs
`src/lib/components/blocks/text/text-render.ts` (the prose island seam)

Only the prose text render path consumes `islandsForPath`; the cell surface runs its own
inline pass and applies no island decorations, so a widget/replace decoration targeting a
`tableCell` path renders nothing. `tableCell` is a prose kind, so the non-prose island
dev-warn also stayed silent — the source seam now warns for cell paths, and the gap is
e2e-pinned (`fold-and-badge.spec.ts`, islands-in-cells). Byte safety holds throughout:
the targeted bytes never leave `getSource()`.

**Fix direction:** apply `applyIslandDecorations` in the cell render path the way
`text-render.ts` does (cell raw, ambient length 0 — the offset walk is shared); island
editing semantics in cells then ride the same wire-up as the cell reveal gap below
("Inline-widget source editing (reveal) is unwired in table cells").

**Why deferred:** surfaced as the 0.9.22 islands-in-cells verification outcome. Cells
already lag the prose surface on widget interaction, so island rendering folds into that
same cell-surface parity pass rather than shipping render support without editing rules.

### HTML entities render as the literal source instead of the decoded character

**Severity:** minor (rendering; deviates from author intent)
**Files:** `src/lib/core/inline-render.ts` (`entityReference` rendering); spec at `docs/design/inline-parsing.md` § Rendering.

Per the inline-parsing spec, an `entityReference` node renders as a span holding the literal source (`&copy;`, `&mdash;`, `&#39;`). The `decoded` field — the Unicode character the entity resolves to — is parsed but never displayed. This was a deliberate application of the "always-visible styled source" principle, but for entities it's questionable: unlike emphasis (markers _around_ styled content), an entity reference IS the entire markup — there's no separable content to style. A user typing `&copy;` to show © sees `&copy;` and is surprised; most editors (Obsidian, GitHub, VS Code preview) display the decoded glyph.

**Fix direction:** render the decoded character in a `contenteditable=false` atomic span, with offset translation between display textContent (1 char) and raw (`&...;` length) — analogous to the `ambient/` prefix translation but applied to inline mid-content. Round-trip already preserves the source via `node.raw`.

**Target:** the inline-widget path is now fully general — the editing registry shipped (0.9.10), caret-addressing keys generically off `[data-inline-widget]`/`data-source-*`, and a decoded-entity widget could ship as a component via the portal seam (0.9.14). What remains is building the entity widget itself and its atomic-delete consumer — entity editing is defined by atomic delete, which image's select-then-delete model doesn't cover. The `deleteGranularity: 'atomic'` policy field it needs is already re-added on `InlineWidgetEditingPolicy` (typed and honored by the caret-edge dispatch, awaiting this first consumer).

### Search matches on render-primary leaf widgets are counted but not painted

**Severity:** minor (search UX; the match is found and navigable, just not highlighted)
**Files:** `src/lib/plugins/latex/latex-kind.ts` (`mathBlock`), `src/lib/plugins/toc/toc-plugin.ts` (`toc`)

A render-primary leaf widget renders its source through a component (KaTeX, a rendered
outline) rather than as editable text, so a search match inside its raw has no measurable
DOM text node to cover. The document scan finds and counts the match and Enter navigates to
it, but no `.match-overlay` rect paints on the block — a user sees `1 / 1` with nothing
highlighted. A whole-block-focus opaque widget (`mermaid`) avoids this by painting a
whole-block cover via the container shim; the leaf widgets have no equivalent. Surfaced by
the 0.9.24 conformance browser sweep (`conformance-sweep.spec.ts`), which pins the current
behaviour so wiring painting later flags the two cells for update. Their `searchPaint` `via`
records the gap.

**Fix direction:** paint a whole-block cover rect for a match on a render-primary leaf (the
`mermaid` container-shim path), or reveal-and-measure the source range the way selection paint
already does while the source is revealed.

**Why deferred:** parity polish on a subsystem that already finds and navigates the match;
the missing piece is only the highlight rect, and it folds into the render-primary paint pass
alongside the cell-surface island gap above.

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

### Reading-mode code blocks show an empty line above and below the code

**Severity:** minor (rendering; reading mode only, v1 acceptable)
**Files:** `src/lib/styles/editor.css` (reading-mode fence hiding),
`src/lib/components/blocks/code/code-renderer.ts` (`renderOpenerLine` / closer — the fence
marker span plus that line's bare `\n`)

In reading mode the fence lines hide by CSS (`.md-fence` / `.md-lang`), but each fence line's
bare `\n` text node is CSS-unreachable — CSS cannot remove a text node and structural omission
is forbidden (the raw-aware walk counts `.length` regardless of layout). The two symmetric
empty lines read as box padding, one above and one below the code. Offsets survive throughout;
only the visual carries an extra blank line each side.

**Fix direction:** a render-path change, out of the CSS-first scope reading mode shipped under.
The `\n` cannot leave the raw, so the likely shape is a CSS-reachable wrapper around each fence
line (an element the reading-mode rule can collapse) instead of a bare text node — decided
against the offset walk that reads those bytes.

**Why deferred:** reads as padding, byte-safe, and reachable only in reading mode; the fix
touches the code renderer's DOM shape, so it folds into a render-path pass, not a CSS tweak.

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

### Content typed after an unclosed fenced code block stays a separate live block but reloads collapsed

**Severity:** minor (live-tree vs reload divergence; byte round-trip unaffected)
**Files:** `src/lib/core/parsers/fenced-code.ts` (an unclosed fence has no terminator, so on
load it absorbs every following line to EOF), `src/lib/core/serializer.ts` (emits `node.raw`
verbatim, so the live fence's own bytes plus the trailing blocks' bytes compose faithfully)

Typing content after an unclosed fenced code block (` ``` ` with no closing fence) keeps
that content as separate live blocks — the editor lets you author a paragraph, thematic break,
or heading below the open fence. But the document serializes to an open fence followed by those
blocks' bytes, and GFM lazy continuation reparses the whole tail INTO the code block: load →
one fenced-code node swallowing everything. Byte round-trip (`serialize(parse(s)) === s`) holds
throughout — the divergence is `parse(serialize(liveTree))` disagreeing with the live tree's
block structure, invisible to the round-trip oracles. Surfaced when the parse-convergence oracle
was wired into the simulation checkpoints: three note fixtures (biology, project-plan, readme)
build this shape deliberately and are exempted with a documented reason (`NoteFixture.unconvergedReason`).
A live-tree vs reload lazy-continuation divergence, but here the collapse is unavoidable (an
unclosed fence has no terminator) rather than a separator-ownership gap.

**Fix direction:** a design look at whether the editor should auto-close a fence when a
structural block is created after it (closing fence minted into the code node's raw), decided
against the code-block edit/reveal paths that read those bytes.

**Why deferred:** byte-safe and self-consistent in the live session; needs a save→reload to
observe. The auto-close decision touches fence rebuild, code-block navigation, and the
descend-below gesture together — a deliberate change, not a spot patch.

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

### Post-paste caret landing diverges across paste routes

**Severity:** minor (caret placement; the document bytes are correct on every route)
**Files:** `src/lib/tree-operations/paste/apply.ts`, `src/lib/tree-operations/paste/dispatch.ts`
(inline `pendingCursorOffset` vs cross-block DOM restore vs structural internal focus)

The post-paste caret lands through three mechanisms depending on the route; the audit flagged
two of the five caret gates as placing the caret at a different relative position than the
others for the same logical paste. The current landings are pinned by the clipboard e2e suite
(post-paste source plus type-after-paste flows), so any parity change re-baselines those specs.

**Why deferred:** the divergence is cosmetic (bytes are correct) and the current behavior is
spec-pinned; unifying the caret target is a deliberate change that must re-pin the affected
clipboard specs. Fold into the paste caret/transform pass.

### caretNearestSurvivor parks a container survivor at a char offset on its own path

**Severity:** minor (caret placement in a narrow table-delete edge; bytes are correct)
**Files:** `src/lib/selection/range-delete-table.ts` (`caretNearestSurvivor`)

When a table-aware range delete removes every block the caret could land in, the survivor
before the range gets `{ path: [beforeIdx], offset: displayLength(before.raw) }`. Tables are
special-cased to a deep cell caret, but a **container** survivor (blockquote/list) falls
through: `before.raw` is the whole container's raw (nested markers included), so the offset is
a container-path char offset that no leaf owns. The restore then clamps or mis-lands.

**Why deferred:** needs a container last-leaf descent resolver (the table branch's
`lastCellCaret` generalized) and a container-before-consumed-table cross-block-delete scenario;
not a cheap one-liner. Fold into the caret-landing parity pass.

### Cross-block type-replace splices the surviving leaf's raw without re-deriving its kind

**Severity:** minor (transient; the next reparse corrects it)
**Files:** `src/lib/selection/cross-block/type-replace.ts`

The typed character is spliced straight into the surviving leaf's raw and committed via
commitMultiScope. If the inserted character changes the block kind (e.g. a leading `#`/`>` when
the merge caret sits at offset 0), the kind stays stale until the next full reparse — unlike the
single-block type path, which reparses.

**Why deferred:** a correct fix reparses the spliced leaf and replaces the block when the kind
changes, which is a reparse-and-replace inside the commit flow, not a cheap tweak. Reachable
only when the post-delete caret lands at offset 0 and the typed char is a block marker.

## Code structure

### DocPath brand adoption stops at the scope factories

**Severity:** minor (enforcement depth; the runtime guard covers the rest)
**Files:** `src/lib/editor-actions/block-edit-scope.ts` (the mint), `src/lib/selection/path-math.ts`, ~40 op-family path composers (table-context, list-context, unwrap-strategies, reorder-action, focus, image-edit-commit, cross-block ops, paste planners)

The `DocPath` brand (0.9.24) is minted by the commit scope factories and consumed at the
G1.16 guard entry, but the op families that legitimately compose doc-absolute paths in
callers still traffic in plain `number[]` — the brand decays at every spread. Compile-time
coverage there requires adopting `extendDocPath`-style composition across ~40 mechanical
call sites.

**Why deferred:** G1.16's runtime dev guard asserts every commit path at every commit, so
the uncovered class is caught at the gate; full adoption is churn without a driving
incident. Adopt opportunistically when an op family is next edited, or as one sweep if a
path-composition bug ever lands.

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

### Reference consumer's block-component prop still annotates `CstNode`

**Severity:** trivial (cosmetic drift; legal — registration-erased)
**Files:** `examples/consumer/src/routes/dev-guard/DevProbeBlock.svelte` (the `node: CstNode` prop)

The reference consumer's `DevProbeBlock.svelte` types its reader prop `node: CstNode` where the in-repo
fixtures now uniformly hold `node: NodeView` (the G4.14 parity lint). It compiles unchanged against the
packaged types: `CstNode` stays exported on the plugin barrel and the registration boundary erases
component prop types, so a mutable annotation is accepted — consumer-smoke is the live proof. The drift
is unguarded because `examples/consumer` sits outside both svelte-check's scope and the G4.14 `.svelte`
scan (which walks `src/**` only). The sibling `dev-probe.ts` `CstNode` uses are constructor/writer-side
(owned mutables) and correctly stay `CstNode`.

**Fix direction:** sweep the reader prop to `NodeView` when the consumer example is next touched.

**Why deferred:** registration-erased and cosmetic — the packaged types compile unchanged and the drift
has no runtime effect, so it isn't worth a standalone edit to the reference consumer; it rides the next
change that opens the file.

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

### Inline links/autolink suite is a 584-line monolith

**Severity:** trivial (test-shape debt; coverage is intact, only the file shape lags)
**Files:** `src/lib/test/core/inline/links-autolink.test.ts`

One file carries the whole inline link + autolink corpus (inline links, reference links,
autolinks, `<...>` autolinks, edge cases) at ~584 lines, well over the ~150-line one-concern
target. No coverage gap — purely a split-by-behavior-area chore (inline-link resolution,
reference-link resolution, autolink recognition).

**Why deferred:** a mechanical split touches many cases and earns its own bounded pass; the
Pass-3 shape sweep ledgered it here rather than bundling the churn into unrelated test work.

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

## Plugin inline widgets

### Inline-widget source editing (reveal) is unwired in table cells

**Severity:** minor (parity gap; cells render widgets but cannot edit them)
**Files:** `src/lib/components/blocks/table/TableCellBlock.svelte`,
`src/lib/components/blocks/table/cell-render.ts` vs
`src/lib/components/blocks/text/widget-interaction.ts` (the prose seam)

Cells gained widget rendering/pooling in 0.9.14 (`createSvelteWidgetPool`) but never wired
`createWidgetInteraction`: no click-to-reveal, no Enter-reveal, no blur commit, and no
containment-scoped fold. Verified on the `mathtable` seed — clicking a cell's inline `$x^2$`
widget leaves it rendered; source editing is simply unavailable inside cells. Distinct from
the reveal collapse/switch fix (which lives at the TextEditableBlock choke point and covers
every reveal-source kind there); wiring cells means threading the same interaction bundle
through the cell surface (its pending-cursor `$effect` already carries the
`document.activeElement` guard the blur-commit path needs).

**Why deferred:** cell reveal is a feature wire-up, not a regression. Cells already render
widgets (0.9.14) and a `<br>` now paints as one, so the rendering half of the cell-inline
work has landed; what remains is threading the interaction bundle through the cell surface.

### Copy during an active inline-widget reveal slices stale raw

**Severity:** minor (non-mutating; wrong clipboard bytes, no document corruption)
**Files:** `src/lib/components/blocks/text/text-clipboard.ts` (`onCopy`)

Cut and paste now fold a live source-reveal before running, so they mutate a CST
consistent with the swapped DOM. Copy takes no such guard — a deliberate asymmetry,
since copy must never mutate the document and a fold commits an edit. While an
inline-math `$…$` source is revealed, `onCopy` still slices `node.raw` at DOM-derived
offsets, so a selection spanning the revealed (DOM-only) edit copies bytes that don't
match what the user sees. The document is untouched; only the clipboard payload is wrong.

**Fix direction:** while a reveal is active, read the copy payload from the live DOM
source text rather than the stale raw slice — the read half of the same seam cut/paste
fold at, without the fold's mutation.

**Why deferred:** non-corrupting and narrow (a copy whose selection overlaps a revealed
widget source); folding on copy is disallowed, so this needs its own read-path branch.
Fold into the clipboard seam alongside the copy read.
