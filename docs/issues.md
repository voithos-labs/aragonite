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
