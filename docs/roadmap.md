# Roadmap

aragonite is the editor module — an independent library delivered at v1.0. Downstream consumers (the limestone app is the first) live in their own repos; this roadmap is the editor's own forward plan. Shipped milestones live in `docs/changelog.md`; this file is forward-looking only.

## Product theses

The long-term goal is a fully open-source notes platform that surpasses Obsidian on the axes it cannot defend:

- **Fully open source, end to end.** Editor, backend, sync server. Revenue, if any, comes from hosted convenience, not closed-source lock-in.
- **Efficient on large docs and large vaults.** Scale is a differentiator, not a caveat. Load-bearing: without it, the asymmetric win is rhetoric.
- **Svelte / TypeScript plugin DX.** The plugin experience is the ecosystem's gravity well. Svelte-first, typed end-to-end, scaffold + hot-reload + reference plugins in-repo. Trades plugin _count_ for plugin _quality + DX_ deliberately.

## Pre-1.0 — Editor Module Deliverable

The v1.0 milestone ships the editor as a polished, GFM-complete, scale-proven, plugin-ready standalone library. With the extraction to this repo done, the remaining pre-1.0 work is:

- **Table-row drag** — a hover drag handle for table body rows, completing the row-reorder affordance the block-drag handle gives top-level blocks (keyboard row reorder shipped 0.8.9). Rows render outside the generic block-host drag path, so this needs a table-specific handle + drop hit-test. Feedback-driven.
- **`/test/editor` demo polish** — the route is the demo surface someone cloning the repo runs to see the editor without touching anything else.
- **Library packaging** — `svelte-package` build with a published `exports` map (`import { Editor } from 'aragonite'`), `svelte` + `highlight.js` as peer/deps, and a verified `npm pack` artifact. (The repo is already structured for this: `src/lib` is the package, `src/routes` the demo app.)
- **Scale gate** — `perf:check` gates the 10MB keystroke latency of every renderable shape (flat + single-container, all O(viewport)) against the committed baseline; the prod build is the reference for the "efficient on large docs" claim. The intra-block single-giant-paragraph axis stays recorded-not-gated (O(paragraph length) span rebuild); an extreme flat document's multi-second load stays accept-documented (O(node-count) reactive-tree materialization, mount still windowed).

Already in place (see changelog): GFM Section 1+2 coverage, a documented + versioned public API, editor-owned theme assets, consumer docs, the block-kind schema surface, and a keybinding-override surface.

## Post-1.0 sketch

Subject to reconsideration after v1 ships.

### 1.2 — Plugin System I + Plugin DX

Static registries + documented public primitive API + the developer experience that makes the Svelte/TypeScript plugin thesis real. Core surface (locked from 0.8.3's contract freeze):

- Schema-driven kind registration via module-augmented `BlockKindMap`; component registry replacing `BlockHost`'s hardcoded dispatch; parser registry with priority-ordered dispatch; runtime `MERGE_ROLE` + `rebuildContainerRaw` dispatch; `measurePartialRects?` hook.
- **Selection coordinate-addressing hooks** — the selection layer hardcodes `kind === 'table'` at ~6 generic gates; a plugin grid block needs descriptor hooks dispatched by presence (`usesCoordinateAddressing`, `normalizeSelectionEndpoint?`, `coverageDelete?`, `serializeSelectionPortion?`), mirroring the `foreignDragHitTest` precedent.
- **Inline-widget editing registry** — promote the hardcoded `kind === 'image'` live-widget gate to an inline-kind registry (`{kind, isLive, buildWidget, editControls?}`). First consumer: HTML-entity decoded rendering (`&copy;` → `©`), whose keyboard interaction needs atomic-inline caret-addressing the image path can't share.
- **Inline-parser extension hook** (from 0.8.2) — a scan-stage hook for custom inline syntax, built when a real consumer can validate its shape.
- **Component-portal widget seam** — let a plugin mount a Svelte component as an atomic inline/block widget (Lexical's `DecoratorNode` analog) instead of hand-building DOM.
- **Command / dispatch seam** — named dispatchable operations over the existing commit ceremony (not a transaction/intercept layer).
- `plugins` prop on `Editor.svelte`.

**Plugin DX:** in-repo reference plugins (each exercising a different extension shape — callout block, KaTeX math, export-to-PDF command, Mermaid code-fence widget, image gallery, smart-HTML-paste); plugin scaffold; hot-reload dev loop; typed manifest; plugin docs; plugin DX test suite.

### 1.3 — Beyond-GFM (as plugins)

De-facto GitHub.com extensions, all built as plugins on the 1.2 API — dogfood proof the API carries third-party contributions: alerts/admonitions, math (KaTeX), Mermaid diagrams, footnotes, collapsible `<details>`, emoji shortcodes, GitHub autolinks. If any can't be built cleanly as a plugin, that reveals a 1.2 API gap — fix the API, not the plugin.

### 1.4 — Git-native integration (likely a first-party plugin)

History view, inline markdown diff, three-way merge UI for markdown conflicts, commit-from-editor, branch-aware editing.

### 2.0+ — Platform-level

Canvas/spatial view, graph view, dataview-shape queries, executable code blocks; then (3.0) a notebook environment with shared kernel state. Driven by the plugin API where possible.

## Downstream (consumer-owned, not this repo)

These belong to consumers (the limestone app), and may surface additive editor-API needs — shipped here as 1.x minors; a breaking change triggers 2.0:

- **Shell integration** — wiring the editor into an app: save/load semantics, dirty-state, scroll restoration, image URL resolution (`resolveImageUrl` against the document dir), link resolution/activation, multi-instance state scoping, a frontmatter properties panel.
- **Persistent version history / collaboration** — a CRDT-friendly or op-log document representation. The current snapshot undo model is not that shape; a joint design spike decides whether to unify undo, history, and collaboration onto one representation.
- **Web app / cloud sync** — browser editing, sync, real-time collaboration. Open-source and self-hostable per the thesis.
