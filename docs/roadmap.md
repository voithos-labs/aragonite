# Roadmap

aragonite is the editor module — an independent library delivered at v1.0. Downstream consumers (the limestone app is the first) live in their own repos; this roadmap is the editor's own forward plan. Shipped milestones live in `docs/changelog.md`; this file is forward-looking only.

## Product theses

The long-term goal is a fully open-source notes platform that surpasses Obsidian on the axes it cannot defend:

- **Fully open source, end to end.** Editor, backend, sync server. Revenue, if any, comes from hosted convenience, not closed-source lock-in.
- **Efficient on large docs and large vaults.** Scale is a differentiator, not a caveat. Load-bearing: without it, the asymmetric win is rhetoric.
- **Svelte / TypeScript plugin DX.** The plugin experience is the ecosystem's gravity well. Svelte-first, typed end-to-end, scaffold + hot-reload + reference plugins in-repo. Trades plugin _count_ for plugin _quality + DX_ deliberately.

## Pre-1.0 — the plugin platform (freeze at the open-source release)

**1.0 ships the editor as a plugin platform.** The plugin-authoring API is exposed _pre-freeze_ on the `aragonite/plugin` subpath and refined against real extensions; it freezes only at the public open-source release. Validation before the freeze: at least two real container consumers, the in-repo dogfood extensions, and an internal limestone integration (without open-sourcing). Build ≠ freeze — nothing external binds until release. The pre-freeze surface, the editable-content tiers, and the plugin may/may-not boundary live in `docs/design/editor/plugin-contract.md`.

Remaining work, ordered:

1. **Command mint** — plugin-minted command ids over the existing register-once registry. Drivers: a `callout.setKind`-style command and chrome keymap overrides.
2. **Registry hardening — before limestone binds.** Duplicate-registration guard on the inline-widget registry, own-kind-only `augmentBlockKind`, an opener late-registration policy, and a bootstrap coherence check for `reservedChrome` declarations.
3. **Inline-widget editing registry + KaTeX** — the third authoring seam: generalize the image live-widget path so a plugin inline kind gets atomic caret-addressing; KaTeX `$…$` is the driving consumer.
4. **Tarball-gate the extensions** — every dogfood extension builds and runs through the packed tarball in `examples/consumer`; forces the pending promotion of the core helpers both consumers need onto `aragonite/plugin`.
5. **Scale-gate verify** — `perf:check` green on the prod build in CI; the accept-documented limits (single-giant-paragraph keystroke, extreme flat-document load) stay accurate.
6. **Shard the CI e2e** — split the Playwright battery across a parallel job matrix; config, pays every PR.
7. **Demo polish (last)** — a showcase route exercising every block kind plus the dogfood extensions, a theme toggle, prop toggles; keep and polish the debug panel.
8. **Freeze cut at release** — final contract reconciliation; the pre-freeze labels come off; pending owner decisions land (open-state-aware height estimation for collapsed containers).

**Standing posture: invariant guards over invariant docs.** Every load-bearing contract the types can't express becomes a guard that fails at the gate, not in a vault. The complexity is essential — cap the downside, don't simplify.

## Post-1.0 sketch

Subject to reconsideration after v1 ships.

### 1.2 — Plugin DX + deferred generalizations

The plugin _authoring_ API ships at 1.0; 1.2 is the developer experience that makes the Svelte/TypeScript plugin thesis real, plus the generalizations deferred until more consumers exist:

- **DX system:** `plugins` prop on `Editor.svelte`, typed declarative manifest, plugin scaffold, hot-reload dev loop, in-repo reference-plugin fleet (each exercising a different extension shape — callout, KaTeX, export command, Mermaid fence widget, image gallery, smart-HTML-paste), plugin docs, plugin DX test suite.
- **Selection coordinate-addressing hooks** — retire the selection layer's `kind === 'table'` gates (and the chrome×table composition) into descriptor hooks dispatched by presence, mirroring the `foreignDragHitTest` precedent.
- **Component-portal widget seam** — let a plugin mount a Svelte component as an atomic inline/block widget (Lexical's `DecoratorNode` analog) instead of hand-building DOM.
- **General editable-leaf tier** — a recognizer-backed standalone plugin text block; the 1.0 chrome leaf is deliberately narrower (see the tier model in `plugin-contract.md`).
- **Inline-parser extension hook** — a scan-stage hook for custom inline syntax, built when a real consumer can validate its shape.

### 1.3 — Beyond-GFM (as plugins)

De-facto GitHub.com extensions, all built as plugins on the 1.0 authoring API + 1.2 DX — dogfood proof the API carries third-party contributions: alerts/admonitions, Mermaid diagrams, footnotes, emoji shortcodes, GitHub autolinks. If any can't be built cleanly as a plugin, that reveals an API gap — fix the API, not the plugin.

### 1.4 — Git-native integration (likely a first-party plugin)

History view, inline markdown diff, three-way merge UI for markdown conflicts, commit-from-editor, branch-aware editing.

### 2.0+ — Platform-level

Canvas/spatial view, graph view, dataview-shape queries, executable code blocks; then (3.0) a notebook environment with shared kernel state. Driven by the plugin API where possible.

## Downstream (consumer-owned, not this repo)

These belong to consumers (the limestone app), and may surface additive editor-API needs — shipped here as 1.x minors; a breaking change triggers 2.0:

- **Shell integration** — wiring the editor into an app: save/load semantics, dirty-state, scroll restoration, image URL resolution (`resolveImageUrl` against the document dir), link resolution/activation, multi-instance state scoping, a frontmatter properties panel.
- **Persistent version history / collaboration** — a CRDT-friendly or op-log document representation. The current snapshot undo model is not that shape; a joint design spike decides whether to unify undo, history, and collaboration onto one representation.
- **Web app / cloud sync** — browser editing, sync, real-time collaboration. Open-source and self-hostable per the thesis.
