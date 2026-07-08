# Roadmap

aragonite is the editor module — an independent library delivered at v1.0. Downstream consumers (the limestone app is the first) live in their own repos; this roadmap is the editor's own forward plan. Shipped milestones live in `docs/changelog.md`; this file is forward-looking only.

## Product theses

The long-term goal is a fully open-source notes platform that surpasses Obsidian on the axes it cannot defend:

- **Fully open source, end to end.** Editor, backend, sync server. Revenue, if any, comes from hosted convenience, not closed-source lock-in.
- **Efficient on large docs and large vaults.** Scale is a differentiator, not a caveat. Load-bearing: without it, the asymmetric win is rhetoric.
- **Svelte / TypeScript plugin DX.** The plugin experience is the ecosystem's gravity well. Svelte-first, typed end-to-end, scaffold + hot-reload + reference plugins in-repo. Trades plugin _count_ for plugin _quality + DX_ deliberately.

## Pre-1.0 — the plugin platform (freeze at the open-source release)

**1.0 ships the editor as a plugin platform.** The plugin-authoring API is exposed _pre-freeze_ on the `aragonite/plugin` subpath and refined against real extensions; it freezes only at the public open-source release. Validation before the freeze: at least two real container consumers, the in-repo dogfood extensions, and an internal limestone integration (without open-sourcing). Build ≠ freeze — nothing external binds until release. The pre-freeze surface, the editable-content tiers, and the plugin may/may-not boundary live in `docs/design/editor/plugin-contract.md`.

Remaining work, ordered. Sequencing principle: **risk first, validation before freeze** — the items most
likely to change later plans or to reveal contract gaps (the KaTeX seam, the clean-room build) run
early enough that what they teach is still cheap to act on.

1. **Inline-widget editing registry + KaTeX** — the third authoring seam: generalize the image
   live-widget path so a plugin inline kind gets atomic caret-addressing; KaTeX `$…$` is the driving
   consumer. Decide the `AnyInlineKind` widening here (mirror `AnyBlockKind`), even if the registry
   ships later — breaking if deferred past the freeze.
2. **Clean-room freeze validator** — build one real extension (alerts/admonitions — a third container
   consumer) under third-party conditions: the author gets the public docs and `aragonite/plugin`
   ONLY, no reading `src/lib` internals. The dogfood plugins validated the API's _sufficiency_ with
   full source access; this validates its _discoverability_, which is what the DX thesis actually
   rests on. Every reach-in the author needs and every doc gap they hit is a freeze blocker, fixed
   while fixing is free. (Mermaid/footnotes stay post-1.0 on purpose — they need the portal and
   inline-hook seams that are deliberately deferred; see the freeze-cut dry-run below.) It is also
   the driver for two deferred plugin surfaces (§ Pre-freeze plugin direction decisions): the generic `:::name` directive primitive is built and docs-published _before_ this build starts, so
   the clean-room author consumes it as a published API (validating its discoverability) rather than
   co-authoring a core primitive under third-party conditions — if it is not ready in time, this build
   runs against per-kind openers first and the directive comparison follows as a separate,
   non-clean-room step; and `registerPasteSurface` is exposed on the plugin barrel if the extension
   needs custom paste.
3. **Tarball-gate the extensions** — every dogfood extension (now including the clean-room one)
   builds and runs through the packed tarball in `examples/consumer`, proving the authoring surface
   from outside the repo at the package boundary.
4. **Scale-gate verify** — `perf:check` green on the prod build in CI; the accept-documented limits
   (single-giant-paragraph keystroke, extreme flat-document load) stay accurate.
5. **Shard the CI e2e** — split the Playwright battery across a parallel job matrix; config, pays
   every PR. Fold in completing the invariant-watcher fixture adoption sweep (shipped in 14 specs;
   remaining specs are a one-line import each) — finish it before external contributors arrive, since
   the fixture is the safety net for people who haven't internalized the invariants.
6. **Demo polish (last)** — a showcase route exercising every block kind plus the dogfood
   extensions, a theme toggle, prop toggles; keep and polish the debug panel.
7. **Freeze cut at release** — in order:
   - **Scoped pre-freeze re-audit** (forge-review, passes matched to what changed since 2026-07) —
     audits before milestones, not after incidents.
   - **1.3 paper dry-run**: walk each planned post-1.0 plugin (Mermaid, footnotes, emoji, autolinks)
     against the contract on paper and confirm no breaking-if-deferred gap — reading cost now versus
     breaking change later.
   - **Promote `docs/culture.md` into the public CONTRIBUTING** — the incident-backed rule set
     exists; at release it gains the practical wrapper (setup, PR flow, gate tiers) and becomes the
     front door for contributors who haven't lived the repo's history.
   - Final contract reconciliation; pre-freeze labels come off; pending owner decisions land:
     per-scope keying for the reveal mount-waiter registry (multi-instance), the `env.ts`
     toolchain-seam decision (route direct `import.meta.env` reads through `editorEnv` vs narrowing
     the claim), grouping `BlockComponent`'s optional capability probes into named facets, and an
     a11y strings table (announcements are hardcoded English today).
   - **Freeze litmus**: the contract must not preclude a consumer-built rendered reading mode
     (markers hidden, widgets rendered) — always-visible-styled-source is the editor's default, not
     a wall; verify no frozen surface hard-binds it.
   - **Freeze litmus (commit seam)**: verify the owned-view / copy-path-on-write protocol (G1.9)
     can extend to a _plugin-contributed_ mutation inside the ceremony — the real hazard of a
     post-1.0 normalize-on-commit / veto seam (§ Pre-freeze plugin direction decisions) is not "did
     we preclude the hook" but "can a plugin append a mutation without breaking the aliasing
     invariant."

### Pre-freeze plugin direction decisions

Three convergent capabilities the prior-art review (`docs/research/plugin-system-prior-art.md`)
flagged as answered-by-omission rather than by decision. All three are **additive-later** by the
freeze criterion — none _must_ ship before freeze — so each decision is _direction + validator_,
not _build-now_:

- **Normalize-on-commit / veto seam** (ProseMirror `appendTransaction`/`filterTransaction`) — the
  highest-leverage lever for plugin _quality_: derived content, linked edits, auto-fix, structural
  guards. **Decided: yes, post-1.0.** No pre-freeze dogfood driver needs it, and the ceremony is
  internal (plugins never bind its shape), so the hook stays additive. Direction fixed now so 1.0
  doesn't foreclose it; the item-7 commit-seam litmus guards it; designed-ahead in
  `plugin-contract.md` § Target shapes. Invariant enforcement stays editor-owned — this augments a
  commit, it does not bypass the invariants.
- **First-class plugin paste** — the paste-surface mechanism is built and used internally by the
  chrome/container seams; only the `registerPasteSurface` export is withheld. **Decided:
  1.0-eligible, build-on-driver.** Exposure is one additive export; the clean-room admonitions build
  (item 2) is the forcing function — expose it there if that extension needs custom paste, else
  defer. The richer _conversion config_ (Editor.js `pasteConfig` analog) is 1.2 DX ergonomics over
  the same mechanism.
- **Generic `:::name` directive primitive** (remark-directive) — one directive opener owning all
  `:::` syntax instead of N plugins colliding on opener priority, giving authors a lossless
  container/leaf/text grammar. **Decided: prototype pre-freeze**, built and docs-published _before_
  the item-2 clean-room build so that build validates its discoverability rather than co-authoring it
  under third-party conditions (admonitions consumes it); the 1.0-vs-1.2 cut follows the prototype's
  byte-lossless confirmation. The per-kind opener stays the general escape hatch.

**Standing posture — the enforcement ladder: unrepresentable > guarded > documented.** Every
load-bearing contract climbs as high as it can: prefer types/seams that make the violation
inexpressible; where types can't reach, a dev guard that fails at the gate; prose only for what
neither can hold. Two habits keep the ladder honest: every bug fix records a one-line miss-analysis
("what test should have caught this, and why didn't it") in its commit or requirement file, and every
new feature class adds a simulation gesture so the corruption oracle's coverage tracks the product's
surface. The complexity is essential — cap the downside, don't simplify.

## Post-1.0 sketch

Subject to reconsideration after v1 ships.

### 1.2 — Plugin DX + deferred generalizations

The plugin _authoring_ API ships at 1.0; 1.2 is the developer experience that makes the Svelte/TypeScript plugin thesis real, plus the generalizations deferred until more consumers exist:

- **DX system:** `plugins` prop on `Editor.svelte`, typed declarative manifest, plugin scaffold, hot-reload dev loop, in-repo reference-plugin fleet (each exercising a different extension shape — callout, KaTeX, export command, Mermaid fence widget, image gallery, smart-HTML-paste), plugin docs, plugin DX test suite.
- **Unified command registry + palette** — migrate built-in block commands off `component.runCommand` onto the `(kind,id)` registry so dispatch has one home (the CodeMirror/ProseMirror model — a command is a function of a context, not a method on the view); a command palette enumerates the registry. Widen `KeybindingOverride.kind` to plugin kinds here too, so a consumer can rebind a plugin container's command chords (additive; command mint left it `BlockKind`-only). Ships on the command-mint foundation (0.9.7).
- **Selection coordinate-addressing hooks** — retire the selection layer's `kind === 'table'` gates (and the chrome×table composition) into descriptor hooks dispatched by presence, mirroring the `foreignDragHitTest` precedent.
- **Component-portal widget seam** — let a plugin mount a Svelte component as an atomic inline/block widget (Lexical's `DecoratorNode` analog) instead of hand-building DOM.
- **General editable-leaf tier** — a recognizer-backed standalone plugin text block; the 1.0 chrome leaf is deliberately narrower (see the tier model in `plugin-contract.md`).
- **Inline-parser extension hook** — a scan-stage hook for custom inline syntax, built when a real consumer can validate its shape (footnotes/emoji from 1.3 are the natural validators).
- **Rendered reading mode as a consumer-buildable view** — always-visible-styled-source is a deliberate default and a taste some users won't share; prove a consumer can build a markers-hidden reading view through public surfaces without forking the render path (the 1.0 freeze litmus guarantees the contract allows it; this item makes it real).

### 1.3 — Beyond-GFM (as plugins)

De-facto GitHub.com extensions, all built as plugins on the 1.0 authoring API + 1.2 DX — dogfood proof the API carries third-party contributions: alerts/admonitions, Mermaid diagrams, footnotes, emoji shortcodes, GitHub autolinks. If any can't be built cleanly as a plugin, that reveals an API gap — fix the API, not the plugin.

### 1.4 — Git-native integration (likely a first-party plugin)

History view, inline markdown diff, three-way merge UI for markdown conflicts, commit-from-editor, branch-aware editing.

### 2.0+ — Platform-level

Canvas/spatial view, graph view, dataview-shape queries, executable code blocks; then (3.0) a notebook environment with shared kernel state. Driven by the plugin API where possible.

consumer specific (limestone): shared env for executable code block, start with python and javascript. Probably this type of executable code block will be a plugin in the limestone codebase.

## Downstream (consumer-owned, not this repo)

These belong to consumers (the limestone app), and may surface additive editor-API needs — shipped here as 1.x minors; a breaking change triggers 2.0:

- **Shell integration** — wiring the editor into an app: save/load semantics, dirty-state, scroll restoration, image URL resolution (`resolveImageUrl` against the document dir), link resolution/activation, multi-instance state scoping, a frontmatter properties panel.
- **Persistent version history / collaboration** — a CRDT-friendly or op-log document representation. The current snapshot undo model is not that shape; a joint design spike decides whether to unify undo, history, and collaboration onto one representation.
- **Web app / cloud sync** — browser editing, sync, real-time collaboration. Open-source and self-hostable per the thesis.
