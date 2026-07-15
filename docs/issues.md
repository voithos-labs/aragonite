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

### Selection snapshot collapses single-block ranges to the focus caret

**Severity:** minor (consumer API gap; the geometry is reachable via the native Range)
**Files:** `src/lib/selection/native-bridge.ts` (`readCurrentSelection`),
`src/lib/selection/primitives.ts` (`EditorSelection`)

`getSelection()` (and the `selectionChange` payload) reports a single-block range as a
collapsed point: `readCurrentSelection` reads only the focus block's cursor offset, so
anchor === focus whenever both endpoints share a block. A consumer therefore cannot obtain
`(start, end)` raw offsets to feed `rangeRects` for the most common selection shape — the
consumer guide's selection-toolbar recipe documents a native-Range fallback for it. The demo toolbar
(`src/routes/test/editor/SelectionToolbar.svelte`) works around it with the native
`window.getSelection()` Range, which is honest consumer-side but bypasses the editor's own
offset semantics.

**Fix direction:** additive range fields on the `EditorSelection` payload (payload growth is
additive under the freeze rules) — decided as a pre-freeze refinement.

### Same-cell multi-match paints stacked rects instead of one collapsed rect

**Severity:** minor (visual; table cells only)
**Files:** `src/lib/components/DecorationOverlay.svelte` (cell dedupe)

The engine's cell path dedupes by `row,col,class`, so a table cell holding the active search
match plus a sibling match paints two stacked full-cell rects (active tint over normal tint — a
slightly darker patch) where the retired `MatchOverlay` collapsed to one active rect. Visually
benign (the active tint dominates) and unreachable by the shipped e2e (all table specs place
matches in distinct cells). Surfaced by the search migration onto the decoration engine.

**Fix direction:** a design call in the engine's cell dedupe — class-union (one rect carrying
both classes) vs. priority-collapse (a source-declared precedence). A search-side fix is not
possible: sources don't know about cells.

**Why deferred:** benign rendering nuance behind a design call; fold into the decoration
follow-up that also owns islands-in-cells.

### HTML entities render as the literal source instead of the decoded character

**Severity:** minor (rendering; deviates from author intent)
**Files:** `src/lib/core/inline-render.ts` (`entityReference` rendering); spec at `docs/design/inline-parsing.md` § Rendering.

Per the inline-parsing spec, an `entityReference` node renders as a span holding the literal source (`&copy;`, `&mdash;`, `&#39;`). The `decoded` field — the Unicode character the entity resolves to — is parsed but never displayed. This was a deliberate application of the "always-visible styled source" principle, but for entities it's questionable: unlike emphasis (markers _around_ styled content), an entity reference IS the entire markup — there's no separable content to style. A user typing `&copy;` to show © sees `&copy;` and is surprised; most editors (Obsidian, GitHub, VS Code preview) display the decoded glyph.

**Fix direction:** render the decoded character in a `contenteditable=false` atomic span, with offset translation between display textContent (1 char) and raw (`&...;` length) — analogous to the `ambient/` prefix translation but applied to inline mid-content. Round-trip already preserves the source via `node.raw`.

**Target:** the inline-widget path is now fully general — the editing registry shipped (0.9.10), caret-addressing keys generically off `[data-inline-widget]`/`data-source-*`, and a decoded-entity widget could ship as a component via the portal seam (0.9.14). What remains is building the entity widget itself plus re-adding the trimmed `deleteGranularity`/`onEdge` policy fields (their shapes + additive-re-add rationale live in `docs/design/plugin-contract.md` § Target shapes (designed ahead)) — entity editing is defined by atomic delete, which image's select-then-delete model doesn't cover.

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
oracles cannot see. `splitNode`'s own comment already names the empty-half state "tolerated";
the typed-into variant is the part that persists. Surfaced by 0.9.22's e2e baseline pins
(reviewer-proven).

**Fix direction:** a design look at split's trailing-newline emission — the blank-line
separator needs an owner (the first half's raw gaining the blank line, or the second half's
`leadingTrivia` carrying `'\n'`), decided against the merge/undo paths that read those bytes.

**Why deferred:** byte round-trip holds and the live session is self-consistent; the
divergence needs a save→reload boundary to observe. The separator-ownership call touches
split, merge, and trivia semantics together — a deliberate design change, not a spot patch.

## Code structure

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
settle added). Whatever battery-context state breaks the visual-line detection for this
gesture is unpinned. The product semantics (a cross-block sweep keeps the source revealed;
blur bails instead of folding) are unit-covered by the interaction factory's cross-block
bail case.

**Fix direction:** reproduce by bisecting the battery's spec set in front of this file to
find the state carrier, then pin the keyboard-extend geometry read it perturbs.

### IME composition sequences can't be driven in tests

**Severity:** minor (test gap)
**Files:** `src/lib/components/blocks/code/CodeBlock.svelte`, `src/lib/components/blocks/text/` (composition handlers)

The `insertLineBreak` composition gate (and the IME rules generally) can't be exercised — neither the unit harness nor Playwright drives `compositionstart`/`compositionend` sequences today. A minimal composition harness (synthetic composition events at the handler level, or CDP IME simulation) would let the IME contract be pinned directly instead of by analogy to sibling guards.

**Target:** pre-1.0 roadmap item 3 (inline-layer observability) — the harness is its third deliverable.

## Plugin containers

### Search replace skips matches inside childless opaque containers

**Severity:** minor (replace parity; find/highlight/navigate work today)
**Files:** `src/lib/editor-actions/search-replace.ts`

A childless opaque container (e.g. a mermaid block) is scanned as a leaf, so search finds,
highlights, and navigates to matches inside its raw. Replace skips those matches: the
container's raw is metadata-derived (`rebuildRaw`), and a generic raw substitution would
drift from metadata and trip the G1.12/G1.13 staleness probes. `replaceOne` no-ops,
`replaceAll` excludes them, and `replacedCount` reports only real replacements.

**Fix direction:** a kind-aware write path — the kind translates a raw-range edit into a
metadata update (for mermaid, a `code` rewrite) and the ceremony rebuilds `raw` from it.

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

### `<details>` chrome rebuild normalizes CRLF line ends to `\n`

**Severity:** minor
**Files:** `src/lib/plugins/details/details-kind.ts` (`rebuildDetailsRaw`)

The `:::` directive path now threads the authored line ending through metadata, so a post-edit
rebuild of a CRLF-authored directive, callout, or admonition reproduces `\r\n` on its opener and
closer chrome lines (`serializeDirective` takes a `lineEnding`). The `<details>` plugin rebuilds its
HTML chrome (`<details>` / `<summary>` / `</details>`) through a separate hand-rolled template that
still hardcodes `\n`, so a CRLF-authored `<details>` block normalizes those lines on a structural
edit. Parse→serialize stays CRLF-safe (an opaque container emits its `raw` verbatim); only a rebuild
normalizes.

**Fix direction:** thread the same authored line ending through `DetailsMetadata` and use it in
`rebuildDetailsRaw`'s template, mirroring the directive fix.

**Why deferred:** the byte round-trip holds without edits; the `<details>` HTML rebuild is a distinct
serializer from the shared `serializeDirective`, so it needs its own threading. Fold into a
line-ending-fidelity pass.

### Container components re-export the component surface member-by-member

**Severity:** trivial (authoring ergonomics; guarded, not a defect)
**Files:** `src/lib/components/BlockHost.svelte` (ref binding); every container component

A container block re-exports each `ContainerBlockComponent` member as its own `export const` so
`bind:this` on `<Comp>` in BlockHost captures the full surface — Svelte 5 instance exports are
individual top-level declarations, with no spread. That is ~11 identical lines in every container
component (callout, details, admonition, mermaid). A trailing `satisfies ContainerBlockComponent`
now turns a forgotten member into a compile error, so the block is guarded — but the ceremony
remains.

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

## Dev workflow

### Editing a registrar-adjacent module under `vite dev` 500s every editor route

**Severity:** minor (dev workflow; no production or built-output impact)
**Files:** `src/lib/schema/*` registries, `src/lib/components/built-in-blocks.ts` (registrars)

Editing any registrar-adjacent `$lib` module while `vite dev` is running invalidates the registrar
modules but keeps the registry module instances alive. On the next SSR render the registrars re-run
against a registry that still holds the prior evaluation's registrations, so the register-once contract
throws (`registerBlockComponent: "paragraph" is already registered`) and every editor route 500s until a
full `src/**` mtime touch (forcing registries + registrars to re-evaluate together) or a server restart.

**Fix direction:** either a dev-only SSR idempotence guard at the registration seam — in tension with the
culture rule "registries are code, not state" (register-once, throw-on-duplicate), so it needs a
deliberate design that scopes the guard to the HMR/dev boundary without softening the production contract
— or a documented touch/restart policy for registrar edits under the dev server.

**Why deferred:** dev-server-only; production and `svelte-package` output are unaffected. The mtime-touch
self-heal is known and cheap, so this waits on the deliberate seam design.
