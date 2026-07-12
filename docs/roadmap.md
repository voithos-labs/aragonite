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
likely to change later plans or to reveal contract gaps (the clean-room build) run early enough that
what they teach is still cheap to act on.

The platform surface is API-complete (0.9.13–0.9.16: the plugin unit, paste transforms,
portal widgets, the reference plugin, the editable-leaf tier). The dominant remaining risk has
inverted — it is no longer "the API is missing something" but "the validation is one clean-room
run deep, and every consumer since was in-repo and same-day." The remaining items answer that.

1. **Attribution-axes diagnosis** — the one piece of CI hardening left (the sharded battery,
   the prod-build perf gate, the watcher sweep, and the minimal CONTRIBUTING shipped in
   0.9.17): diagnose the attribution axes' settle timeout on 1MB fixtures (`docs/issues.md`)
   so the perf story carries no standing red anywhere — today the axes are excluded from the
   CI gate as recorded diagnostics. The full culture.md promotion with PR flow stays at the
   freeze cut.
2. **Limestone internal integration** — the last unchecked box in the validation list above and
   the highest-yield finding generator left: a real app wiring save/load, dirty-state, image
   resolution, and multiple documents against `plugins`, `getEvents()`, and `getSource()`. The
   integration code lives in limestone; what belongs here is running it before the freeze and
   landing its findings while they are still cheap. Additive API needs it surfaces ship as
   pre-freeze refinements. The integration also forces the first-party plugin distribution
   question — the dogfoods live in the dev harness, not the package. Position: the internal run
   consumes reference plugins by copying source (the consumer-example sync pattern); if that
   chafes in practice, the 1.2 reference-fleet packaging decision pulls forward — leaning
   package subpaths (`aragonite/plugins/<name>`) over separate npm packages: one version, one
   tarball, exports-map encapsulation already proven.
3. **Second clean-room run, scoped to the post-0.9.12 surfaces** — a walled-off author, the
   0.9.16 tarball and public docs only, building something the new seams carry. The first
   run validated container/chrome discoverability; nothing has third-party-validated the unit,
   transforms, portal widgets, or the leaf tier. One support question is the benchmark. The
   subject should exercise **editable-leaf plain mode** — its only consumer today is the
   synthetic memo fixture — plus a paste transform; natural candidates are an Obsidian-style
   `%%` comment block or YAML front matter (whose doc-position-only grammar and `---`-vs-setext
   conflict stress the opener seam). On promotion in-repo (the admonitions precedent), port the
   plain-mode battery onto the real plugin and retire memo.
4. **Demo polish — the pitch, last** — the `?plugins=1` showcase seed exists; promote it into
   the real showcase route (every block kind + every reference plugin — the fixture dogfoods
   stay off it, `src/routes/test/plugins/README.md` — theme and prop toggles, polished debug
   panel). This is the "surpass Obsidian" argument made visible. It also owns **route
   legibility**: the showcase lands on a human-named route (arguably the dev app's `/` —
   clone, `npm run dev`, see the pitch), the `?plugins=1` toggle retires, and `/test/*`
   becomes uniformly machine-facing — today the demo living at `/test/editor` is the one
   human page in a machine tree. The reference-plugin aesthetic decision is made and shipped
   (restrained gutter-rail chrome on the showcased admonitions/details; chrome remains the
   plugin author's call) — the showcase inherits it; demo polish extends the same restraint to
   whatever it adds.
5. **Freeze cut at release** — in order:
   - **Scoped pre-freeze re-audit** (forge-review, passes matched to what changed since 2026-07) —
     audits before milestones, not after incidents.
   - **1.3 paper dry-run**: walk each planned post-1.0 plugin (footnotes, emoji, autolinks)
     against the contract on paper and confirm no breaking-if-deferred gap — reading cost now versus
     breaking change later.
   - **Complete the CONTRIBUTING** — the minimal front door ships in item 1; at release it
     absorbs `docs/culture.md` (the incident-backed rule set) and gains the public wrapper (PR
     flow, external-contributor setup), becoming the front door for contributors who haven't
     lived the repo's history.
   - **Collapse the 0.9.x changelog working notes into one tight 0.9 entry** — the changelog's own
     pre-v1 style rule; the per-patch notes served the pre-1.0 window and their detail lives in
     `git log`.
   - Final contract reconciliation; pre-freeze labels come off; pending owner decisions land:
     per-scope keying for the reveal mount-waiter registry (multi-instance), the `env.ts`
     toolchain-seam decision (route direct `import.meta.env` reads through `editorEnv` vs narrowing
     the claim), grouping `BlockComponent`'s optional capability probes into named facets, an
     a11y strings table (announcements are hardcoded English today), and the dist-pruning stance —
     the tarball ships every internal module's `.d.ts` (encapsulation is exports-map-level: deep
     imports blocked, files greppable), and the clean-room author read them as the designed
     types-reference; decide prune vs. document-as-contract.
   - **Freeze litmus**: the contract must not preclude a consumer-built rendered reading mode
     (markers hidden, widgets rendered) — always-visible-styled-source is the editor's default, not
     a wall; verify no frozen surface hard-binds it.
   - **Freeze litmus (commit seam)**: verify the owned-view / copy-path-on-write protocol (G1.9)
     can extend to a _plugin-contributed_ mutation inside the ceremony — the real hazard of a
     post-1.0 normalize-on-commit / veto seam (§ Pre-freeze plugin direction decisions) is not "did
     we preclude the hook" but "can a plugin append a mutation without breaking the aliasing
     invariant."
   - **Freeze litmus (accumulated surface checks)**: the per-surface litmuses recorded in
     `plugin-contract.md` § pre-freeze authoring surface — the plugin unit's additive room
     (enablement layer / lazy setup / declarative-manifest overload), the synchronous-only
     ambient attribution boundary, and `FenceOpen`'s verbatim-byte return contract — each
     re-verified at the cut.
   - **Post-freeze versioning**: from 1.0, breaking changes to any frozen surface ride a major
     version; additive needs ship as 1.x minors.

### Pre-freeze plugin direction decisions

Three convergent capabilities the prior-art review (`docs/research/plugin-system-prior-art.md`)
flagged as answered-by-omission rather than by decision. All three are **additive-later** by the
freeze criterion — none _must_ ship before freeze — so each decision is _direction + validator_,
not _build-now_:

- **Normalize-on-commit / veto seam** (ProseMirror `appendTransaction`/`filterTransaction`) — the
  highest-leverage lever for plugin _quality_: derived content, linked edits, auto-fix, structural
  guards. **Decided: yes, post-1.0.** No pre-freeze dogfood driver needs it, and the ceremony is
  internal (plugins never bind its shape), so the hook stays additive. Direction fixed now so 1.0
  doesn't foreclose it; the item-4 commit-seam litmus guards it; designed-ahead in
  `plugin-contract.md` § Target shapes. Invariant enforcement stays editor-owned — this augments a
  commit, it does not bypass the invariants.
- **First-class plugin paste** — the paste-surface mechanism is built and used internally by the
  chrome/container seams; only the `registerPasteSurface` export is withheld. **Decided at the
  clean-room build: stays internal at 1.0.** The driver (GitHub-alert → admonition conversion)
  needed a content-keyed pre-parse clipboard transform, which the target-kind-keyed surface cannot
  express — registering for prose kinds collides with the built-in default surfaces, and the type
  closure drags commit-coordinator machinery public. Exposing it would have frozen an export that
  fails its own driving use case. The conversion-config seam (Editor.js `pasteConfig` analog) —
  content-keyed and paste-scoped, distinct from the target-keyed surface — **shipped pre-1.0 as
  `registerPasteTransform`**: pasted text runs through named, install-ordered transforms before the
  parse, and the GitHub-alert → admonition driver migrated onto it (the document-rewrite pattern,
  `getSource()` → transform → `source` re-sync, stays the consumer-side answer for whole-document
  migration). `registerPasteSurface` stays internal, unchanged.
- **Generic `:::name` directive primitive** (remark-directive) — **shipped 0.9.11**: one opener owning
  all `:::`/`::`/`:` syntax, dispatch by name, three tiers, a lossless generic fallback, and a public
  `activateDirectives()`. Byte-losslessness is confirmed (adversarial round-trip property), so the one
  remaining decision is the **1.0-vs-1.2 freeze cut** — whether the directive surface freezes at 1.0 —
  taken at the freeze against the clean-room build's discoverability findings (shipped 0.9.12 — the
  build needed no directive reach-ins; its findings were doc gaps, all fixed in-flight). The per-kind
  opener stays the general escape hatch.

**Standing posture — the enforcement ladder: unrepresentable > guarded > documented.** Every
load-bearing contract climbs as high as it can: prefer types/seams that make the violation
inexpressible; where types can't reach, a dev guard that fails at the gate; prose only for what
neither can hold. Two habits keep the ladder honest: every bug fix records a one-line miss-analysis
("what test should have caught this, and why didn't it") in its commit or requirement file, and every
new feature class adds a simulation gesture so the corruption oracle's coverage tracks the product's
surface. The complexity is essential — cap the downside, don't simplify.

## Post-1.0 sketch

Subject to reconsideration after v1 ships.

### 1.1 — Presentation modes (the live-preview ladder)

Styled source stays the default and the editing substrate; these make it a choice rather than
a ceiling. Evaluated 2026-07: achievable without fighting the architecture — the operative
caret invariant since widgets is "every DOM region declares its raw span", not
"textContent equals raw" — so hidden markers are source-spanned islands over shipped
machinery. Three rungs, each independently shippable:

1. **Reading mode** — markers hidden, widgets rendered, read-only; a stylesheet plus a
   read-only mode, buildable by a consumer through public surfaces (the 1.0 freeze litmus
   guarantees the contract allows it; this rung makes it real, with a consumer toggle as the
   proof).
2. **Block-granular live preview** — unfocused blocks render markers-hidden; the focused block
   shows styled source. The editable-leaf render-primary swap (block math) generalized to
   built-in prose kinds. Likely the bulk of the perceived live-preview win at a fraction of
   rung 3's cost.
3. **Inline-granular live preview** — the full Notion/Obsidian feel: marker islands +
   reveal-on-caret-proximity (the shipped reveal kernel with a caret-containment trigger) +
   caret-affinity semantics (the one genuinely new piece; prior art: ProseMirror stored marks).
   A scanner-rework-sized milestone. **Decide after rung 2 ships** — real usage tells whether
   block-granular already feels like enough.

### 1.2 — Plugin DX + deferred generalizations

The plugin _authoring_ API ships at 1.0; 1.2 is the developer experience that makes the Svelte/TypeScript plugin thesis real, plus the generalizations deferred until more consumers exist:

- **DX system:** plugin scaffold, hot-reload dev loop, in-repo reference-plugin fleet (each exercising a different extension shape — callout, KaTeX, export command, image gallery, smart-HTML-paste), plugin docs site, plugin DX test suite — plus a declarative-manifest overload on the shipped `definePlugin` unit if a consumer wants one.
- **Unified command registry + palette** — migrate built-in block commands off `component.runCommand` onto the `(kind,id)` registry so dispatch has one home (the CodeMirror/ProseMirror model — a command is a function of a context, not a method on the view); a command palette enumerates the registry. Ships on the command-mint foundation (0.9.7); `KeybindingOverride.kind` already spans plugin kinds (0.9.16). Mermaid v2 — its plugin-owned textarea edit mode rebuilt on the shipped editable-leaf surface — is the recipe upgrade to fold in here when wanted.
- **Selection coordinate-addressing hooks** — retire the selection layer's `kind === 'table'` gates (and the chrome×table composition) into descriptor hooks dispatched by presence, mirroring the `foreignDragHitTest` precedent.
- **Inline-parser precedence overrides** — the scan-stage hook itself shipped pre-1.0 (`registerInlineSyntax`, with KaTeX as the consumer); what remains is a precedence-override variant for recognizers that must outrank built-in inline syntax, validated by the 1.3 footnotes/emoji plugins.
- **Render-primary authoring gaps** (the reference builds' recorded walls, `docs/issues.md`): a public focus-actions seam for render-only containers (the childless-container caret dead-end behind mermaid's `focusable: false`), and a command→component channel so view-state block commands stop needing a plugin-owned bridge.
- **Decoded-entity inline widget** — `&copy;` renders its glyph as an atomic component widget (the portal seam's natural next consumer); re-adds the trimmed `deleteGranularity`/`onEdge` editing-policy fields with entity editing as their driving consumer.

### 1.3 — Beyond-GFM (as plugins)

De-facto GitHub.com extensions, all built as plugins on the 1.0 authoring API + 1.2 DX — dogfood proof the API carries third-party contributions: footnotes, emoji shortcodes, GitHub autolinks (admonitions and Mermaid already shipped pre-1.0 as reference plugins). If any can't be built cleanly as a plugin, that reveals an API gap — fix the API, not the plugin.

### 1.4 — Git-native integration (likely a first-party plugin)

History view, inline markdown diff, three-way merge UI for markdown conflicts, commit-from-editor, branch-aware editing.

### 2.0+ — Platform-level

Canvas/spatial view, graph view, dataview-shape queries, executable code blocks, notebook
environments — platform ambitions that live with consumers and their repos; the editor's role
is supplying the plugin surfaces they need, shipped as 1.x minors (breaking → 2.0).

## Downstream boundary

Consumer-owned work (shell integration, sync, collaboration, app features) lives in consumer
repos and their own roadmaps — not here. Two standing editor-side commitments: additive API
needs surfaced by consumers ship as 1.x minors, breaking changes ride a major; and the one
joint decision worth naming — the **persistent version-history / collaboration representation
spike** — stays joint because it constrains editor internals (the snapshot undo model is not
CRDT/op-log shaped, and unifying undo, history, and collaboration onto one representation is a
design decision the editor and its first consumer must make together).
