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

**Target:** the inline-widget editing registry (pre-1.0 — `docs/roadmap.md` § Pre-1.0, the KaTeX item); entities are a natural early consumer. Decoded rendering is prototyped; entity keyboard interaction (edge-delete, arrow step-over, shift-extend) needs the registry's atomic-inline caret-addressing, currently hardcoded to `kind === 'image'`.

### Table cell Shift+Enter inserts `<br>` but renders it as literal text

**Severity:** minor (table cells only)
**Files:** `src/lib/components/blocks/table/` (cell inline rendering)

Shift+Enter inside a cell inserts a literal `<br>` at the cursor — the correct GFM representation, since cells can't carry raw newlines, and round-trip preserves the `<br>` bytes. But the cell displays it as literal text; a rendered line break depends on a follow-up migration that routes cell content through the same widget-aware inline pipeline as prose.

**Why deferred:** the byte-level behavior is correct (round-trip safe); only the in-cell rendering lags. Folds into the cell-inline-render migration.

## Code structure

### Whole-table keyboard reorder (Alt+↑/↓) is unavailable

**Severity:** minor (a11y; table blocks only)
**Files:** `src/lib/components/blocks/table/cell-keydown-plan.ts`, `src/lib/schema/block-kind-descriptor.ts` (`table` registration), `src/lib/components/blocks/table/TableBlock.svelte`

Alt+↑/↓ now reorders fencedCode, thematicBreak, paragraphs, and list items among their siblings via the `block.moveUp/moveDown` keymap, matching the drag handle's tooltip. A table has no non-cell focus surface, and inside a cell Alt+↑/↓ is already bound — in `cell-keydown-plan.ts`'s hard-coded `SHORTCUTS` — to ROW reorder, so there is no free gesture to reorder the whole table block, and its drag handle's keyboard equivalent is missing.

**Why deferred:** the table's structural chords live in a second, hard-coded dispatch (`cell-keydown-plan.ts`) instead of the declarative `keymap` the other kinds use, so they also bypass the consumer `keybindings` override prop. Expressing a whole-table `block.moveUp/moveDown` cleanly is part of migrating the table chords onto the declarative keymap — its own deliberate change (the consumer-guide's rebindability promise should be scoped or fulfilled with it). Code and thematic-break keyboard reorder shipped; the table case is flagged here.

### Table-branch range-delete ceremony lacks the chrome branch's hardening

**Severity:** minor (latent; benign only because cascade deletes solely empty containers)
**Files:** `src/lib/selection/range-delete-table.ts` vs `range-delete-chrome.ts`

The chrome branch filters deletion candidates to subtree roots and identity-gates each delete; the table branch splices nested covered paths child-by-child and cascades over pre-deletion paths. Unify on the chrome branch's ceremony on the next pass over this file.

### MatchOverlay's cell branch still scans all matches

**Severity:** minor (perf; search-open only)
**Files:** `src/lib/components/MatchOverlay.svelte` (grid/table branch)

The prose branch now reads its own per-path bucket from the match index; the table-cell branch still walks the full match list because its cell addressing needs a seam the overlay doesn't have. Extend the bucket read to cells when that seam is next touched.

## Test coverage

### Attribution perf axes time out on 1MB setSource settle (pre-existing)

**Severity:** minor (diagnostic instruments only — the `PERF-GATE` rows and typing-latency rows pass with 2-3× headroom, so `perf:check`'s regression gate is intact)
**Files:** `src/lib/e2e/tests/perf/attribution.perf.spec.ts`

9 of 13 attribution axes fail on `page.waitForFunction` (60s) waiting for `settle()` after `__test.setSource` of a 1MB fixture. Proven pre-existing: axis1 fails identically at 0.9.7 (`d7135f3`), so this is not a 0.9.8 regression. The failure means the in-page document never reaches the expected byte length within the timeout — diagnose the settle predicate against current `setSource` behavior on 1MB fixtures before trusting any attribution numbers.

**Why deferred:** baseline-proven pre-existing; the diagnosis belongs to a perf-harness pass, not the conformance/registry batch that surfaced it.

### `lineInterruptsParagraph` is a second grammar-read seam without flush/latch

**Severity:** trivial (unreachable today)
**Files:** `src/lib/schema/block-openers.ts`

`getOrderedOpeners` flushes pending registration checks and trips the grammar-consumed latch; `lineInterruptsParagraph` reads the same grammar but does neither. Unreachable outside a parse that already ran opener dispatch, but it is the sibling-path shape (a rule at N−1 of N entry paths) one refactor away from real.

**Why deferred:** no reachable bug; mirror the two calls when the seam is next touched.

### Conformance reference version has no drift-guard test

**Severity:** trivial
**Files:** `src/lib/test/conformance/reference.ts`

`REFERENCE_VERSION` is hand-maintained beside the exact-pinned `commonmark` devDependency; nothing red ties them together. A bump that misses `reference.ts` would shift divergences and fail the slice ratchet loudly anyway — the ratchet is the de-facto guard.

**Why deferred:** add the direct pin when the harness is next touched.

### No composition-driving harness; IME guards are pinned by parity, not by tests

**Severity:** minor (test gap)
**Files:** `src/lib/components/blocks/code/CodeBlock.svelte`, `src/lib/components/blocks/text/` (composition handlers)

The `insertLineBreak` composition gate (and the IME rules generally) can't be exercised — neither the unit harness nor Playwright drives `compositionstart`/`compositionend` sequences today. A minimal composition harness (synthetic composition events at the handler level, or CDP IME simulation) would let the IME contract be pinned directly instead of by analogy to sibling guards.

## Plugin containers

### A plugin rebinding chrome Enter to block.split leaves a dead undo entry

**Severity:** trivial (plugin misuse; unreachable via seam defaults)
**Files:** `src/lib/editor-actions/plugin/chrome-leaf.ts` (chrome keymap), `src/lib/editor-actions/block-edit-core.ts` (`split`)

The chrome keymap binds Enter to `chrome.descendToBody` by default. A plugin that rebinds it to `block.split` gets a noop split — the chrome is single-line, so nothing structurally changes — through a commit that still pushes an undo entry.

**Why deferred:** reachable only by a plugin overriding the documented single-line chrome contract; not worth a guard until a real consumer needs `block.split` on chrome.

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
