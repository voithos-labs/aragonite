# Known Issues

Log of known editor issues. Each entry carries severity, affected files, a description,
reproduction (where relevant), and either a **Target** version (if scheduled via the roadmap)
or a **Why deferred** rationale (if not). Remove entries when shipped.

## Decoration & rendering

### HTML entities render as the literal source instead of the decoded character

**Severity:** minor (rendering; deviates from author intent)
**Files:** `src/lib/core/inline-render.ts` (`entityReference` rendering); spec at `docs/design/editor/inline-parsing.md` § Rendering.

Per the inline-parsing spec, an `entityReference` node renders as a span holding the literal source (`&copy;`, `&mdash;`, `&#39;`). The `decoded` field — the Unicode character the entity resolves to — is parsed but never displayed. This was a deliberate application of the "always-visible styled source" principle, but for entities it's questionable: unlike emphasis (markers _around_ styled content), an entity reference IS the entire markup — there's no separable content to style. A user typing `&copy;` to show © sees `&copy;` and is surprised; most editors (Obsidian, GitHub, VS Code preview) display the decoded glyph.

**Fix direction:** render the decoded character in a `contenteditable=false` atomic span, with offset translation between display textContent (1 char) and raw (`&...;` length) — analogous to the `ambient/` prefix translation but applied to inline mid-content. Round-trip already preserves the source via `node.raw`.

**Target:** the inline-widget path is now fully general — the editing registry shipped (0.9.10), caret-addressing keys generically off `[data-inline-widget]`/`data-source-*`, and a decoded-entity widget could ship as a component via the portal seam (0.9.14). What remains is building the entity widget itself plus re-adding the trimmed `deleteGranularity`/`onEdge` policy fields (their shapes + additive-re-add rationale live in `docs/design/editor/plugin-contract.md` § Target shapes (designed ahead)) — entity editing is defined by atomic delete, which image's select-then-delete model doesn't cover.

### Table cell Shift+Enter inserts `<br>` but renders it as literal text

**Severity:** minor (table cells only)
**Files:** `src/lib/components/blocks/table/` (cell inline rendering)

Shift+Enter inside a cell inserts a literal `<br>` at the cursor — the correct GFM representation, since cells can't carry raw newlines, and round-trip preserves the `<br>` bytes. But the cell displays it as literal text; a rendered line break depends on a follow-up migration that routes cell content through the same widget-aware inline pipeline as prose.

**Why deferred:** the byte-level behavior is correct (round-trip safe); only the in-cell rendering lags. Folds into the cell-inline-render migration.

### MatchOverlay paints no highlight for a match inside a childless opaque container

**Severity:** minor (search-highlight parity)
**Files:** `src/lib/components/MatchOverlay.svelte`

Same class as the just-fixed SelectionOverlay container gate: `MatchOverlay`'s `isContainer && !containerPaintsCells` path zeroes the rects for a childless opaque container, and its leaf path needs a `measurePartialRects` the container shim never supplies — so a search match inside a mermaid (or other childless opaque) block paints no highlight even though the match is found and navigable.

**Fix direction:** decide between a full-block paint (highlight the whole opaque block for any interior match) and a measure fallback that routes the leaf `measurePartialRects` through the container shim — mirroring the SelectionOverlay `hasChildHosts` precedent.

**Why deferred:** needs a design call (full-block paint vs measure fallback), shared with the SelectionOverlay container-gate work; the match is still found and navigable, only its highlight is missing.

## Code structure

### Whole-table keyboard reorder (Alt+↑/↓) is unavailable

**Severity:** minor (a11y; table blocks only)
**Files:** `src/lib/components/blocks/table/cell-keydown-plan.ts`, `src/lib/schema/block-kind-descriptor.ts` (`table` registration), `src/lib/components/blocks/table/TableBlock.svelte`

Alt+↑/↓ now reorders fencedCode, thematicBreak, paragraphs, and list items among their siblings via the `block.moveUp/moveDown` keymap, matching the drag handle's tooltip. A table has no non-cell focus surface, and inside a cell Alt+↑/↓ is already bound — in `cell-keydown-plan.ts`'s hard-coded `SHORTCUTS` — to ROW reorder, so there is no free gesture to reorder the whole table block, and its drag handle's keyboard equivalent is missing.

**Why deferred:** the table's structural chords live in a second, hard-coded dispatch (`cell-keydown-plan.ts`) instead of the declarative `keymap` the other kinds use, so they also bypass the consumer `keybindings` override prop. Expressing a whole-table `block.moveUp/moveDown` cleanly is part of migrating the table chords onto the declarative keymap — its own deliberate change (the consumer-guide's rebindability promise should be scoped or fulfilled with it). Code and thematic-break keyboard reorder shipped; the table case is flagged here.

### Render-primary wall ledger: command→component bridge

**Severity:** minor (authoring friction; additive)
**Files:** `src/routes/test/plugins/mermaid/` (the consumer that surfaced it); `docs/editor/plugin-guide.md` § render-primary recipe

One wall left from the reference build, a 1.2 candidate (the ledger's fence-matcher and
`normalizeLineEndings` items shipped as `aragonite/plugin` re-exports; the focus-seam wall
closed with whole-block focus — `blockFocus: 'whole-block'` + the factory's focus-el getter,
mermaid as the consumer): block commands have no component channel, so view-state commands
need a plugin-owned node→component bridge every render-primary plugin will rebuild. Also
minor: the container shim hardcodes `editable: true`.

## Test coverage

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

## Plugin containers

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
**Files:** `src/routes/test/plugins/details/details-kind.ts` (`rebuildDetailsRaw`)

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

**Why deferred:** cell reveal is a feature wire-up, not a regression; fold into the
cell-inline-render migration alongside the existing cell entries.

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
