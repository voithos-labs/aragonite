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

**Target:** 1.2 — the inline-widget editing registry's first consumer (`docs/roadmap.md` § 1.2). Decoded rendering is prototyped; entity keyboard interaction (edge-delete, arrow step-over, shift-extend) needs the registry's atomic-inline caret-addressing, currently hardcoded to `kind === 'image'`.

### Table cell Shift+Enter inserts `<br>` but renders it as literal text

**Severity:** minor (table cells only)
**Files:** `src/lib/components/blocks/table/` (cell inline rendering)

Shift+Enter inside a cell inserts a literal `<br>` at the cursor — the correct GFM representation, since cells can't carry raw newlines, and round-trip preserves the `<br>` bytes. But the cell displays it as literal text; a rendered line break depends on a follow-up migration that routes cell content through the same widget-aware inline pipeline as prose.

**Why deferred:** the byte-level behavior is correct (round-trip safe); only the in-cell rendering lags. Folds into the cell-inline-render migration.

## Code structure

### Table reorder-drag lifecycle is duplicated across the row and column controllers

**Severity:** minor (structure; no behavior impact)
**Files:** `src/lib/components/blocks/table/table-reorder-drag.ts`

`startRowReorderDrag` and `startColumnReorderDrag` are ~98-line near-identical controllers — teardown / commit-on-release / pointermove / pointerup / cancel / key handling and listener registration are byte-identical; only the per-axis `process()`, the axis, and the insertion-line shape differ. The cross-block `editor-actions/reorder-drag.ts` is a third drag controller but diverges enough (delegated capture-phase install, ghost label, no drag threshold) that folding it in would leak.

**Why deferred:** a pure refactor with no functional gain and real divergences; do it as its own commit gated on the full row + column + windowed + wide-table drag e2e. Clean seam (validated against the live code by the 2026-07 review, with two amendments): `process` must RETURN `{ line, dropTo }` rather than mutate closure state — which also makes the axis clamps pure-testable — and the `axis` param is only the autoscroll axis (name it `autoScrollAxis`). The header-clamp now has a direct controller-level unit test (`table-reorder-drag-clamp.test.ts`), so the refactor's clamp behavior is pinned in advance. A `pointerId` filter on `onUp` (both controllers commit on any pointerup today) is a real fix to land as its own guarded change, not silently inside the refactor.

### Whole-table keyboard reorder (Alt+↑/↓) is unavailable

**Severity:** minor (a11y; table blocks only)
**Files:** `src/lib/components/blocks/table/cell-keydown-plan.ts`, `src/lib/schema/block-kind-descriptor.ts` (`table` registration), `src/lib/components/blocks/table/TableBlock.svelte`

Alt+↑/↓ now reorders fencedCode, thematicBreak, paragraphs, and list items among their siblings via the `block.moveUp/moveDown` keymap, matching the drag handle's tooltip. A table has no non-cell focus surface, and inside a cell Alt+↑/↓ is already bound — in `cell-keydown-plan.ts`'s hard-coded `SHORTCUTS` — to ROW reorder, so there is no free gesture to reorder the whole table block, and its drag handle's keyboard equivalent is missing.

**Why deferred:** the table's structural chords live in a second, hard-coded dispatch (`cell-keydown-plan.ts`) instead of the declarative `keymap` the other kinds use — the S1 single-source gap. Expressing a whole-table `block.moveUp/moveDown` cleanly (a distinct chord, or routing the block-level chord through the cell plan's `native` fallthrough) is part of that keymap migration, a Tier-3 concern out of this batch's scope. Code and thematic-break keyboard reorder shipped; the table case is flagged here.

## Tables & selection (review 2026-07 minors)

### Table-branch range-delete ceremony lacks the chrome branch's hardening

**Severity:** minor (latent; benign only because cascade deletes solely empty containers)
**Files:** `src/lib/selection/range-delete-table.ts` vs `range-delete-chrome.ts`

The chrome branch filters deletion candidates to subtree roots and identity-gates each delete; the table branch splices nested covered paths child-by-child and cascades over pre-deletion paths. Unify on the chrome branch's ceremony on the next pass over this file.

## Plugin containers

### A plugin rebinding chrome Enter to block.split leaves a dead undo entry

**Severity:** trivial (plugin misuse; unreachable via seam defaults)
**Files:** `src/lib/editor-actions/plugin-chrome-leaf.ts` (chrome keymap), `src/lib/editor-actions/block-edit-core.ts` (`split`)

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

**Why deferred:** out of the Task-6 descope-hatched bound; the END direction is the shipped,
reachable-today gesture. Fold the START direction into the 1.2 clipboard/hook family with the
container-exit walk change.
