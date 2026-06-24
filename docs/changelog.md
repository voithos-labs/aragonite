# Changelog

Editor version history (CST block editor). **Style (pre-v1):** one tight entry per minor version; patch versions are working notes that collapse into the parent minor at the next bump — per-bug narratives belong in `git log`.

### 0.9.1 — Pre-1.0 polish: theming for extraction, consumer docs, hygiene

Module-readiness polish ahead of the standalone-repo extraction.

- **Theming scoped for extraction (single-flow).** All tokens moved off `:root` to the editor's own scope (`.editor`, plus an opt-in `.limestone-editor-theme` class for non-editor chrome), so the module no longer injects custom properties into a consumer's global scope and a consumer themes the editor through one channel — overriding tokens at the editor scope. Light/dark keys on a `data-editor-theme` attribute driven by a new `theme` prop (`'dark'` / `'light'` / custom name), replacing the global `:root[data-theme-type]` toggle. The `--color-*` chrome tokens gained light+dark defaults too, so the editor (search bar, image, code backgrounds) renders correctly in both modes host-less. The limestone consumers drive the prop from the active app theme via a new `currentThemeType` store, so the in-app editor follows app light/dark.
- **Consumer guide completed.** The `getSearch()` controller and `searchBar` prop, the named CST utilities (`parseInline` / `getContentRange` / `isProseKind`), the `EditEvent` / `EditorError` payload envelopes, a minimal mount example, and the theming scope/toggle/override contract.
- **Hygiene.** Dimmed-marker opacity tokenized (`--syntax-marker-dim`); code/mono surfaces unified on `--font-editor`; the `/test/editor` route gained a landing affordance and lifted its `window.__test` probe surface into a module. List indent/promote now adopt the destination bullet glyph within the unordered axis.

Internal only.

### 0.9.0 — Remaining GFM + public API

Closed the last CommonMark autolink gap and made the editor's public API truthful, per-instance, and overridable.

- **Angle-bracket absolute-URI autolinks.** `<scheme:…>` for any valid scheme (`<ftp://…>`, `<mailto:…>`, custom) now autolinks — the former `http(s)`-only recognition generalized to the CommonMark absolute-URI grammar, closing the one §6.8 gap.
- **Keybinding-override prop.** A per-instance `keybindings` prop rebinds, adds, or disables bindings over the built-in command vocabulary without forking, consulted ahead of the built-in keymaps at every dispatch site. The override map flows through context (no module-global mutation), so two editors can carry different bindings; the full `CommandId` vocabulary and the chord format are exported as public types. Undo/redo chords are overridable too — the input-layer history interception (which suppresses native browser undo) now routes through the override-aware dispatch with precise chord matching, fixing a loose key check that also mis-caught Ctrl+Alt+Y as redo.
- **Public-API truthfulness.** The production consumer and the demo import `Editor` from the `$lib/editor` barrel (proving extraction is mechanical); `EditorSelection` and a named `EditorInstance` handle are exported; `EditorProps` is single-sourced so the component consumes its own published type and can't drift, guarded by a compile-time conformance check.

### 0.8.10 — Perf attribution + flat-shape gate

Closed out the 0.8 performance line. Measurement overturned the working model: the apparent flat high-block-count keystroke residual was a harness artifact, not editor cost.

- **Flat keystroke is O(viewport).** The latency harness settled each keystroke by summing `docLengthInPage` over the whole `$state`-proxy children array (O(children) per poll), inflating flat high-block-count rows — many-small-blocks-10MB read 231ms where the editor cost is ~3ms. Attribution (`axisS`: mounted/renders/CDP-ScriptDuration flat across 1k–30k blocks) confirmed windowing fully bounds the keystroke; fixed the settle to read the edited block's own length term.
- **Flat shapes now gated at 10MB.** With the artifact gone, `perf:check` enforces every renderable shape's 10MB keystroke (flat 10MB rows were previously excluded for the now-removed artifact). Baseline re-blessed.
- **Sticky-nav scan bounded.** `findOffsetNearestX` scanned every offset in the block; it now scans only the probed visual line's neighborhood (O(lines-near-edge), not O(raw length)), so sticky Up/Down through a giant paragraph no longer measures a rect per character.
- **Two limitations accept-documented** (`docs/perf/performance.md`): the intra-block single-giant-paragraph keystroke (Axis 5 — O(paragraph-length) span rebuild, ~177ms prod @ 1MB; synthetic and transient — Enter splits the paragraph), and flat load (O(node-count) reactive-tree materialization, sub-second at realistic sizes, ~22s only at the 392k-block 10MB extreme).

Internal only.

### 0.8.9 — Editor quality pass

A batch of editor polish across reorder, find/replace, and link safety.

- **Keyboard table-row reorder** — Alt+↑/↓ inside a cell moves the focused body row one slot among the body rows (building on 0.8.7 block reorder): one identity-preserving structural reorder, a single undo entry, focus following the row in its column, and a live-region announcement. The header row is positionally fixed; a boundary press is a no-op. Keyboard-only; the drag affordance is roadmapped.
- **Find/replace polish** — undo after replacing nested content restores the caret to the exact nested leaf (list item / table cell), not the top-level block; a zero-width regex match (`a*`, `^`) no longer paints an invisible highlight sliver.
- **Default link activation hardening** — the editor's default link handler is now policy-gated through the scheme allowlist (`isAllowedHrefScheme`), so a host that supplies no `onLinkActivate` won't open a `javascript:` / control-byte URL by default.

Internal only.

### 0.8.8 — In-document find/replace

Find and replace within a document: a toggleable top-right floating bar plus a public engine API. Search is a read-only lens over the CST — scanning and highlighting never mutate the tree, parser, or inline cache.

- **Engine** — a pure `search/` module scans editable leaves for matches (case / whole-word / regex toggles; regex with `$1` capture refs and an invalid-pattern error state), keyed by block path. Container raw and ambient prefixes are never scanned.
- **Highlighting** — a per-block `MatchOverlay` (sibling to the selection overlay) paints matches through the existing `measurePartialRects` hook, so windowing bounds highlight cost to the viewport. Table cells, which render outside the block-host path, paint as whole-cell highlights via a selection-independent `cellRect`.
- **Replace** — per affected top-level subtree, the substituted source is reparsed and committed as one identity-preserving `replace`, batched into a single undo entry; cost is O(affected), not O(document), and untouched top-level blocks keep their identity. Table-cell replacements escape `|` and newline so a row can't be split. Replace and Replace All; regex replacements expand `$1`/`$&` and `\n`/`\t` escapes.
- **Bar + API** — `searchBar` prop (default on) renders the built-in bar (Ctrl+F find, Ctrl+H replace, Esc closes and restores focus); `editor.getSearch()` exposes the controller so a consumer can disable the bar and drive a custom UI. Re-scan runs only while the bar is open, deferred off the keystroke path (zero added keystroke cost). Known limitation (`docs/issues.md`): off-window rows of a windowing-active giant table don't re-measure highlights — shared with the selection overlay.

Internal only.

### 0.8.7 — Block reordering

Move a block among its siblings — top-level blocks, list items within their list, and a blockquote's children — over one structural reorder operation reachable two ways.

- **Keyboard** — Alt+↑/↓ nudges the focused block past a sibling, with a screen-reader live-region announcement of the new position. Always available.
- **Mouse drag** — a hover handle (revealed on the innermost reorder host only) drags the block; a ghost follows the pointer and a single insertion line marks the drop gap, with no mid-drag reflow and one commit on release. Escape or pointer-cancel aborts cleanly. The handle is consumer-toggleable via `blockDragHandles` (default on).
- **Off-window targets via autoscroll** — drop hit-tests against mounted siblings, so a target below the fold is reached by holding the pointer near the viewport edge to autoscroll it into the window, not by spacer-region hit-testing. There is no precise off-window drop; this is the intended reach for large, windowed documents.

### 0.8.5 — Lazy `inlineContent`

The inline tree — a derived Phase-2 rendering cache — moves from eager to cost-on-read, consistent with container-raw (0.7.4) and virtual rendering (0.8.6): inline cost becomes O(viewport-rendered + on-demand-touched), not O(document).

- **Cost-on-read accessor** — non-render consumers read inline content through an accessor backed by a node-keyed, non-reactive WeakMap, validated on read by `raw` plus the link-reference signature (no dirty flag; a shared/unchanged node hits, a copy-on-write or in-place `raw` change misses and recomputes). The render path computes locally and caches nothing.
- **Eager work deleted** — the whole-document inline sweep at load and per commit is gone, along with its `inline-dirty-set` scoping; undo/redo and link-reference edits no longer re-parse the document inline, and the common keystroke no longer double-parses the edited block.
- **LRD-map rebuild gated** off the keystroke hot path — the link-reference map rebuilds only when a commit could change the reference set, not on an ordinary paragraph keystroke.
- **`inlineContent` removed from `CstNode`** — accessor-only, which narrows the 0.8.3 plugin freeze before any plugin binds (see `docs/design/editor/plugin-contract.md`). The retired render-path corruption guard (G4.2) downgrades to a perf-hygiene lint — with no reactive cache field, the read/write cycle it guarded cannot recur.
- **Scale gate un-capped** — the giant-single-list/blockquote/table fixtures, capped at 1MB on a stale (never-measured) assumption their 10MB load wouldn't complete, are now measured and gated at 10MB: load is linear and windowing bounds the mount, so the keystroke is O(viewport). reference-heavy un-caps too (lazy inline removed its keystroke's whole-document sweep).
- **0.8.1 incremental parsing dropped** after measurement — parse is a small linear fraction of load and structural edits already re-parse per block, so block-level incremental parse addressed no measured cost. Its one residual is the long-single-paragraph intra-block axis (Axis 5), tracked separately.

### 0.8.3 — Plugin-API contract freeze (foundation)

Freezes the foundational plugin-facing contract — the shapes external plugin code binds to at 1.2 — while changing it is still cheap, before any binding. Not exposed from `index.ts` yet; 1.2 flips the switch. Design record (with the breaking-if-deferred vs additive-later decision table that justifies the scope): `docs/design/editor/plugin-contract.md`.

- **Node identity** — `CstNode.kind` widens from `BlockKind` to `AnyBlockKind` (built-in union + branded plugin kinds), so a plugin-kind node is a first-class CST citizen through render, measure, and serialize. A structural `isBlockNode` guard (`'raw' in node`) replaces kind-based `CstNode | Document` narrowing, which the widening made unsound (a plugin could name a kind `document`).
- **Registries are code, not state** — the five kind-keyed registries (block-kind descriptors, components, openers, commands, paste surfaces) are register-once: a duplicate registration throws (the `customElements` model), making real what `consumer-guide.md` already promised. `augmentBlockKind` stays the deliberate-merge path; no runtime unregister/replace (a Plugin System II concern). A unified test reset clears non-built-ins; registration modules are dev-HMR boundaries (a register-once edit needs a reload).
- **Plugin-kind naming** — `declarePluginKind` rejects collisions with built-in kinds, the reserved structural sentinel `document`, and previously-declared plugin kinds.
- **Events access** — `getEvents()` ratified as the canonical accessor; stale `editor.events` references corrected across the docs.
- **Scoped out, in writing** — manifest / `plugins` prop / lifecycle (target shapes, built at 1.2); the `EditEvent` snapshot/real-delta discriminant (additive, designed with its post-v1 version-history consumer — the naive `snapshot`-derived flag would mislabel ordinary typing); the 0.8.2 inline-parser hook.

Internal only.

### 0.8.2 — Inline-widget registry (consolidation)

The decision "is this inline node a live atomic widget, and how is its widget-ness recognized" is single-sourced into one `core/inline/` registry, replacing logic previously spread across a model predicate, the renderer's raw-HTML branch, the `<br>` tag allowlist, and an unenforced doc comment.

- **Recognition is registry-owned** — one predicate answers widget-ness for every consumer (vertical-skip, edge-select, cursor adjacency, clipboard, the renderer); a new widget inline kind registers rather than editing scattered branches.
- **Builders dispatch by layer** — the core `<br>` builder is registered; the image builder stays injected per-render (it carries the per-instance broken-URL cache) and is never process-global. The per-block `renderImagesAsWidgets` policy stays on the block-kind descriptor — a separate axis from kind-level widget recognition.
- Behaviour-preserving (identical widget set), internal only. This is the consolidation half of 0.8.2; the parser-stage extension hook stays open (see roadmap) — widget-ness is a render+model decision, not a parse one, so that hook awaits a real inline-syntax consumer.

### Forge-review hardening (post-0.8.6)

A four-pass review of the editor module with tiered fixes. Substantive seams:

- **Cross-block table selection** — a whole-row snap at the selection-normalize chokepoint makes highlight, copy, and cross-block delete agree on a mid-row table endpoint, closing a Cut data-loss; pointer-drag endpoints carry cell coordinates like the keyboard path.
- **Commit rollback** — a throwing container/multi-scope commit now restores each scope's pre-mutation children, so the live tree is never left partially mutated.
- **Editor-root keystroke routing** — when the caret's block is windowed out and native focus drops to the document body, a document-level listener routes cross-block and undo/redo keystrokes (focus parks on the editor root on unmount), closing undo/redo-inert-when-unmounted.
- **Editable-surface factory** — the contenteditable plumbing shared by the three editable blocks is extracted into one `createEditableSurface` factory behind a cursor-backend seam.
- **Forward-delete + list markers** — nested code-block forward-delete uses a focus-layer move-or-noop instead of a root-vs-container index mismatch; ordered markers adopt the destination punctuation on indent/promote.
- **Per-instance state** — the image broken-URL cache is per editor instance; the "global schema, per-instance state" contract is documented for consumers.
- **Test coverage + structure** — the simulation oracle now exercises tables and runs fenced-code/image round-trip checks in CI; the undo ceremony is grouped under `editor-actions/undo/` and block components are colocated per kind.

Residual: viewport-follow on an off-window cross-block extend for deep-nested lists (tracked in `docs/issues.md`). Internal only.

### 0.8.6 — Virtual rendering (windowing)

Mounted block components bounded to the viewport at every nesting depth, turning steady-state keystroke cost from O(mounted) to O(viewport). Design record: `docs/design/editor/virtual-rendering.md`. Seams:

- **Top-level windowing** — `BlockList` self-activates (hysteresis watermarks), rendering a sliced window between top/bottom spacers so native scrollbar geometry stays real. A per-kind height oracle (O(1) `raw` estimate, replaced by measured height cached by stable id) feeds a Fenwick index↔offset model; a `revealPath` primitive scrolls off-window focus/caret/undo/selection targets into the window and awaits their mount before acting, with the focused block pinned mounted. Nested-containers 1MB keystroke p50 collapsed to flat-prose parity as mounted components dropped to viewport scale; a machine-independent mounted-count ceiling joins the commit gate.
- **Recursive container windowing** — extends into blockquote, list-item, and long-flat-list scopes (a `list` / `table` bypasses `BlockList` and windows its own `{#each}` children directly). One shared `createListWindowing` per scope composes the oracle + model + window; the absolute-index slice contract is single-sourced in `sliceWindow`. Measured heights propagate upward through two passive index-keyed channels (leaf and subtotal); `revealByPath` descends nested levels.
- **Table-row windowing** — a giant table windows its rows, reusing the shared wiring wholesale; the one new mechanic is grid geometry (row height read from a cell, spacers span the full grid width). Row→cell path descent also closes the cross-block-command-can't-reach-a-table-cell gap, and the pass fixed a chain of pre-existing table cross-block selection bugs (cross-block edit wiping a table body, collapse-to-start cell landing, last-block delete leaving one empty paragraph).
- **`useContainerWindowing` extraction** — the per-scope wiring boilerplate collapses into one hook so a future or plugin container kind inherits windowing by naming only its variation.
- **Pressure-test hardening** — width/resize invalidation, manual scroll-anchor correction (`overflow-anchor` disabled), the scope-owned batched read-all-then-write measure pass, bounded reveal, off-window pure-data vertical-transparency, per-scope width estimates, and sticky-column geometry from the first mounted row — backed by non-vacuous regression guards (layouts-per-mount bound, settled-scroll-position compensation).

Known limitations at the time: single-giant-container shapes windowed rendering but their 10MB _load_ stayed capped at 1MB in the harness (since un-capped in 0.8.5 — load is linear and the keystroke is O(viewport)). (The block-scoped-keydown focus drop and the column-width drift listed here were fixed in the later forge-review hardening pass.) Internal only.

### 0.8.0 — Latency attribution + first-edit re-render fix

Opens the 0.8 performance line. The profiling harness gains block-render and in-page keystroke instruments plus a prod-vs-dev capture project; the attribution (record: `docs/perf/performance.md`) traces the nested-1MB keystroke cost (~375ms prod) to two sources — a dominant steady-state framework reactive-flush proportional to mounted components (ratifying virtual rendering (0.8.6) as the primary spine) and a one-time first-edit full-document re-render, fixed here: the `$state` link-reference resolver was reassigned a fresh identity on every edit, re-rendering every block that read it at mount; it now reassigns only on LRD-signature change, and the render path reads it only for bracket-bearing blocks. Guarded by `block-render-scoping.spec.ts`. Internal only.

### 0.7.12 — Module-readiness completion

Closes the Track B module-readiness line. `index.ts` is curated to exactly what an `<Editor>` consumer needs (the component + its props/resolve/policy types, `parse`/`serialize` and inline preprocessing, node/inline and event-payload types); internal plumbing leaks are pulled back (`LIST_CONTEXT_KEY`, the tree-op primitives, `createUndoManager`/`cloneDocument`/`assignIds`, `editor-keys.ts`) on the asymmetry that adding an export later is non-breaking but removing one is breaking. The four test/debug methods move behind `editor.__test`. Two consumer docs land: a module `README` and `docs/editor/consumer-guide.md`. `dev-warn.ts` decouples from the build toolchain via an injectable `env.ts` seam (`configureEditorEnv`). Per-file unit coverage closes the transitive-coverage gap for `cursor/sticky-measure.ts`, `cursor/visual-lines.ts`, and `devWarn`. No behavior change. Internal only.

### 0.7.11 — CSS ownership migration

The editor module owns its CSS. Two stylesheets ship under `src/lib/styles/`: `editor.css` (structural painting rules for imperatively-built DOM, auto-imported) and `editor-theme.css` (editor-owned token values, consumer-imported). Every painting rule is wrapped in `:where(.editor)` — full namespacing at zero added specificity. Editor-owned tokens (`--syntax-*`, `--code-tok-*`, `--font-editor`, promoted presentational tokens) are declared at `:root`; host tokens (`--color-*`, `--radius-*`) are only read-with-fallback so the host's `applyTheme()` keeps winning. Divergent fallbacks collapsed to one canonical value per host token; engineered zero-visible-change and verified pixel-identical in both palettes. New G4.6 source-scan guard keeps `app.css` clean. Internal only.

### 0.7.10 — Editor boundary-hardening

Three waves of boundary work, pre-staging the 0.8.3 freeze's error-reporting contract. Internal only.

- **Error boundary + commit rollback** — a new `error` channel on the editor's event surface (`EditorError`, `origin: subscriber | render | commit`); each block wrapped in a `<svelte:boundary>` so a render-throw degrades to a recoverable failed-block fallback with siblings intact; the commit ceremony captures both undo stacks before the push and restores them via `UndoManager.restoreStacks` on a throwing mutation (never publishing a partial tree).
- **URL / link policy + seam** — a pure scheme allowlist (`core/url-policy.ts`) enforced at the render sinks blocks `javascript:`/`vbscript:`/`file:` (and `data:` in `href`), defeating control-char obfuscation; a blocked scheme renders an inert `span.md-link-blocked`. Three consumer seams land with today's behavior as default: `resolveLinkUrl`, `imageLoadPolicy`, and `onLinkActivate` (replacing the hardcoded `window.open`).
- **Accessibility baseline + axe gate** — WCAG 2.1 AA declared as target; the editor root gains `role="group"` + `aria-label`; the AT-invisible cross-block selection is announced through a visually-hidden `aria-live` region fed by a pure `createSelectionDescription` builder. A new `e2e-a11y` project runs `@axe-core/playwright` over `.editor` and fails on any violation outside a committed, only-shrinking baseline allowlist (the milestone-tied log of deferred AA work).

### 0.7.9 — Command registry + per-kind keybinding declaration

Closes the Track B keybinding work. Per-block-kind keybindings become declarative — `BlockKindDescriptor.keymap` maps a normalized chord (`Mod` = Ctrl/Cmd) to a command id — dispatched through a command registry that replaces the scattered `onKeyDown` branches. The registry is a `schema/` leaf: `schema/commands.ts` single-sources the vocabulary and registers global commands as free functions, exposing `dispatchKeyCommand` (per-kind keymap → global fallthrough, for a focused leaf) and `resolveKindBinding` (kind-only, for container bubble handlers); `schema/keybindings.ts` owns chord parse/normalize. Block-local bodies run on the focused component via `BlockComponent.runCommand(id, arg?)`, which reads the caret live so cross-block dispatch operates at the collapsed position. The cross-block delete-then-redispatch hack retires (a source-scan guard forbids `new KeyboardEvent` in runtime source); new bootstrap invariant G1.11 (keymap coherence). One deliberate tightening: normalized chords match modifiers exactly, so modifier-augmented variants the old loose guards incidentally caught now fall through to native. Behavior-preserving against the full e2e + simulation; a double-undo regression (container bubble re-firing undo because a leaf's async handler `preventDefault`s only after an `await`) was caught by the gate and fixed by the kind-only container resolution.

### 0.7.8 — Schema seam

Three waves making the block-kind schema the single dispatch authority, scoped to 0.7's module-readiness. Behavior-preserving.

- **Op-vocabulary substrate** — `OperationDetailMap` (`schema/operations.ts`) derives `OperationKind`, `OpDescriptor`, and `EditEvent` so kind/detail drift is a compile error (retiring the widening casts). Plugin kinds become nameable via a branded `PluginBlockKind` (`declarePluginKind`, rejects built-in collisions); `CstNode.kind` deliberately stays `BlockKind` until the 0.8.3 freeze.
- **Declarative per-kind entry** — the parser's opener chain is registry-driven (kinds declare `{priority, tryOpen, interruptsParagraph}` in `schema/block-openers.ts`), and the paragraph-interrupt scan derives from the same declarations (new G1.10 guard). Container paste-merge is declarative (`BlockKindDescriptor.containerPaste`); the tableCell structural-paste special case moves to an `onScopedStructuralPaste` hook. Accepted, measured cost: registry dispatch adds ~8–16% to full-document parse on block-dense shapes (load-path only; keystroke re-parse unaffected).
- **UnwrapRole + declared rebuilders** — containers declare Backspace-unwrap behavior (`unwrapRole` names a first-child and middle-child strategy); `rebuildRaw` is declared at registration (bodies in `schema/container-rebuilders.ts`), retiring the post-augment patch-in. The G4.3 conformance kit holds container kinds to all three declaration families.

### 0.7.7 — Performance harness + inline-sweep scoping

The scale gate becomes measurable. A deterministic fixture corpus (six seeded shapes at any byte target, golden-pinned) feeds three layers: dev-mode perf instruments at five seams with a `__test.perf` bridge; a vitest bench suite (`perf:editor`) over parse, clone, and ancestry rebuild with a machine-stamped baseline; and a PERF-gated Playwright project (`perf:e2e`) recording fixture load and per-keystroke p50/p95. Machine-independent counter ceilings join the commit gate (`test:editor:perf`). Riding the harness: ten dead resolver-less `parseAllInlineContent` calls deleted, and the per-edit inline sweep scoped to a dirty-set (one top-level subtree on the typing path; whole-doc only on LRD-signature change or structural ops). Honest attribution recorded in the baselines — the sweep was not the dominant per-keystroke cost. A real bug surfaced: a typing batch displaced within the debounce window dropped its `input` event, leaving the previous block's inline cache resolver-less; displaced batches now flush on key change. `parseBlocks(lines, start, end)` is named a stable seam for range re-parse.

### 0.7.6 — Block-edit ladder + decomposition (Track A close)

Three waves closing Track A's architectural-hardening line. Behavior-preserving (full e2e + simulation unchanged).

- **Decomposition wave 1** — the keystroke debounce/batch state machine extracted into a named text-batch lifecycle (`editor-actions/text-batch.ts`); one owned `ContainerScope` shape across container/multi-scope/paste commits; `commitMultiScope` restructured onto `prepareScopeView`/`publishScopeView`; the `skipSnapshot` boolean replaced by an `undoEntry: 'own' | 'join'` option. Pure cores extracted with direct unit tests (`cellKeydownPlan`, `core/inline/ranges.ts`, `consumeStickyLanding`, `replacePreservingFirst`, and others), plus image-overlay orchestration out of `Editor.svelte` into `ImageOverlayHost`.
- **Decomposition wave 2** — by-convention couplings single-sourced, plus two logged defects closed (the IME-composition cross-block delete converged onto the commit primitive; `cascadeCleanupEmptyAncestors` no longer drifts a surviving ancestor's `childIds`). New seams: `pushChild`/`spliceChildren` lockstep helpers (`tree-operations/children.ts`), `updateNodeContent` speaking the `StructuralChange` return language, table column mutators returning per-row `StructuralChange`s, and the terminate-and-splice list-item weld.
- **Block-edit ladder core** — the top-level and container `BlockEditActions` factories stop duplicating their structural-edit bodies: a `CommitScope` adapter captures every per-level difference and `createBlockEditCore` writes split / merge / delete / replaceBlock / metadata once against it; the paste preDelete-fold single-sources into `foldPasteReplacement`. `insertParsedBlocks` and `updateBlockContent` stay per-factory by necessity (the dual-emit paste event, and the divergent load-bearing kind-change undo-batching — unification attempted and reverted). Closes Track A.

### 0.7.5 — Property/fuzz-test the invariants

Generator-based (fast-check) coverage over the load-bearing invariants: round-trip/parser-totality over arbitrary and malformed input, EOF edge states, inline-conformance corpus, the `textContent === ambientPrefix + raw` spine, inline-offset partition, serialization purity, selection partition, split/merge id↔ref↔children alignment, and the paste op-kind dual-emit. Reactivity and timing rules become source-scan guards; a registry-derived conformance kit holds any container kind to the per-container invariants. New `test:editor:invariants` area under `test/invariants/`.

### 0.7.4 — Structural-sharing undo

Undo checkpoints stop deep-cloning the document. The container-raw decision (`docs/perf/performance.md`) keeps materialized container raw and spends the work on the undo axis, where the cliffs were. Snapshots now share the live tree's nodes, marked by an editor-level sharing epoch (`ownerEpoch`, `undo/sharing.ts`); a push costs O(top-level children) — ~1000× down — and per-snapshot heap drops to KB-scale spine divergence. The cost moves to mutation discipline: copy-path-on-write everywhere (`tree-operations/unshare.ts`), with the commit primitives owning the protocol. Aliasing is guarded three ways: invariant G1.9 (no mutation writes serialized bytes through a snapshot-shared node) with negative fixtures; a DEV integrity oracle digesting and re-verifying each snapshot at every commit and restore; and a keystone fast-check property driving random op sequences through the real action factories. The multi-seed simulation joined the default battery after the oracle caught a real Svelte 5 proxy bug; the fix — write the copy into the `$state` tree, then re-read it through the tree before further use — is now the canonical-reference discipline in the unshare contract.

### 0.7.3 — Spec/doc accuracy

Design-doc reconciliation surfaced by the architecture review: documented the table/grid exemption from the container-internal invariant, `unrecognized` as a reserved kind, the container-strip inline coordinate spaces, the commit-ceremony-vs-event-seam distinction, and the state-registry WeakMap-GC reality; unified (or justified) the scroll-ancestors divergence. Added the `docs/design/editor/invariants.md` catalog.

### 0.7.2 — Node-model & schema guardrails

Convention-enforced invariants become compile-time and runtime-checked. Compile-time: typed `metadataOf`/`BlockMetadataByKind` (retires ~68 metadata `as`-casts), `defineBlockComponent`, union-derived `BLOCK_KIND_TABLE`, a `containerContract: 'strip' | 'grid'` descriptor field, branded `CURSOR_END`/`SELECTION_END` sentinels, and a cell-coordinate discriminant on `SelectionPoint`. Runtime: a dev-only, non-crashing `assertInvariant` channel wiring DEV checks (G1.1–G1.8) at the commit primitive, bootstrap, `cloneNode`, and the nested-actions helper; BlockHost renders a visible raw block for a kind with no registered component. Drove the svelte-check baseline from 21 errors / 18 warnings to 0 / 11.

### 0.7.1 — selection→table DAG inversion + issue-log sweep

Closes the `selection/ → components/` dependency inversion: the table foreign-drag hit-test moves behind an optional `foreignDragHitTest` descriptor hook registered from the top-of-DAG wire-up, so `drag-pointer.ts` dispatches by `data-block-kind` through the descriptor registry. Bundles the editor issue-log sweep: reference blocks re-render when an LRD changes elsewhere (render memo keys on the LRD signature, gated to reference-bearing blocks); blockquote-into-blockquote paste no longer destroys the target paragraph; type/paste across two top-level tables no longer corrupts the grid raw (carets are char-addressable deep paths with identity-resolved survivor paths); table cells now render inline content through the same pipeline as prose via a `cell-render.ts` factory, with widget-aware cell offset reads and cursor I/O.

### 0.6 — Complete GFM Coverage

Every GFM construct parses, renders, and edits (shipped as 0.6.1–0.6.7.1; per-patch narratives in git log). Task list items gained click-to-toggle checkboxes on a new `AmbientPrefix` interactive-range contract, with a source-preserving `taskMarker` metadata field. CommonMark §6.1/§6.2 pre-passes added backslash escapes and HTML character references. Tables became per-cell editable containers (Tab/arrow/Enter navigation, rectangular selection, row/column ops, alignment cycle, three-stage Ctrl+A, pipe-aware paste) and moved per-container ids onto `node.childIds`. Images render as atomic inline widgets (`contenteditable="false"`, dimension hints, drag/Shift+Arrow resize, a `resolveImageUrl` hook). Autolinks closed the GFM §6.9 gaps. Reference-style links and images resolve in all three forms with document-level resolver reactivity. HTML blocks meet §4.6 per-type close conditions and the paragraph-interrupt rule; inline raw HTML (§6.10) parses with allowlisted tags as atomic widgets. The paste-into-list family converged on one rule — absorb on matching list type, break out on mismatch, newline-terminated splices, pre-splice marker computation — and Enter on an empty nested item outdents one level. An eight-pass decomposition sweep (0.6.1.x) cleaned the layer DAG and retired shelf-named directories before the feature work resumed.

### 0.5 — Forge-Review Hardening + Pre-Coverage Seams

The full forge-review audit became the v0.6 baseline, worked off in five tiers (per-patch narratives in git log). Structural spine: every structural mutation unified on the `__commit` primitive with the `editor.events` seam (`edit` + `selectionChange`), multi-scope commits for cross-container mutations, `StructuralChange` descriptors auto-syncing ids/refs, a metadata-only commit path, and the `BlockListState` registry closing children-mutation bypass sites. One paste dispatcher replaced five paste sites, pinned by a clipboard regression suite. The debug engine and `/test/editor` panel gave investigations a structured CST/selection/undo/ops view. The list marker moved inside the contenteditable as the ambient-prefix contract (unblocking task checkboxes), `SELECTION_END` and the sticky-column two-axis contract were pinned before tables, and module-DAG consolidations made `BlockKindDescriptor` the single dispatch authority. Correctness sweeps fixed cross-block typing event emission, id preservation through IME, ambient-aware measurement, multi-line link reference definitions, and CRLF hard-break matching.

### 0.4 — Cross-Block Selection & Clipboard

Cross-block selection, overlay rendering, keyboard/pointer extension, and clipboard operations spanning multiple blocks. Path-based addressing (`path: number[]`) replaces flat block indices throughout selection and undo layers; lazy `SelectionState` (null in single-block mode) with cross-container "start wins" semantics; `SelectionOverlay` mounted at `BlockHost`; Shift+Arrow / Ctrl+Shift+Home/End / double Ctrl+A keyboard extension; rAF-throttled pointer drag with autoscroll; cross-block Copy/Cut/Paste/Delete/Backspace/type-replace; undo restores cross-block selection state. Follow-up patches (0.4.1–0.4.3): the organizational pass, paste correctness + code-block Enter through the CST + list-exit content preservation, and the pre-v0.5 sweep.

### Pre-0.4 history

Compact summary; see git log for the full record.

- **0.3.5** — Code-block rewrite: `<textarea>` → `contenteditable` with live highlight.js syntax (17 bundled languages via plugin-shaped registry), sticky-column participation (retires the "opaque block" category), Tab / Shift+Tab indent, ArrowLeft / ArrowRight boundary navigation, paste fence-length bump.
- **0.3.4** — Architecture refactor (no user-visible change). `EditorActions` god interface split into four concern-specific sub-interfaces; container-state primitive layer extracted; `tree-operations.ts` and `parser.ts` split per-kind into directories; `inline-parser.ts` split by pipeline stage; cursor/visual-line helpers extracted to `text-surface/`.
- **0.3.3** — List/blockquote unwrap rules (U1/U2/M1), cross-container Backspace merge, MergeRole role refactor (replaced `MERGEABLE_PAIRS` set), pixel-X sticky column foundation. Fixed `isItemEmpty` data-loss bug + blockquote stuck-caret traversal.
- **0.3.2** — Foundations: geometry-based focus traversal, recursive list parsing (nested sub-lists, continuation lines, multi-paragraph items), multi-block paste, forward delete, Tab/Shift+Tab list indent, Ctrl+B/I inline formatting. Fixed `bind:ref` ref-array drift after structural ops.
- **0.3.1** — Container raw propagation for nested edits (lists + blockquotes); list-item marker round-trip preservation.
- **0.3** — Inline parsing: backtick spans, delimiter-run emphasis/strong/strikethrough, links/images/autolinks, hard line breaks. Inline renderer with dimmed marker spans, cursor save/restore through the span tree, per-input re-render. Markers extracted via `raw.slice()`, never reconstructed.
- **0.2** — Block editing: editor shell with CST ownership, full component hierarchy (Text/Code/ThematicBreak/Blockquote/List/ListItem), tree ops (split/merge/delete/updateContent), merge eligibility rules, container raw reconstruction, undo/redo with snapshot-based CST cloning + debounced batching, parallel ID array for stable keyed rendering, list Enter behavior. Fixed container ID desync on undo/redo, double chars, cursor loss in leaf↔container transitions.
- **0.1** — CST foundation: single-pass line-oriented GFM block parser producing mutable `CstNode` tree, all block types with recursive container parsing, metadata extraction (heading level, fence markers, list markers, task items, etc.), lossless `serialize(parse(source)) === source` round-trip, `leadingTrivia` / `prefix` / `suffix` whitespace fidelity.
