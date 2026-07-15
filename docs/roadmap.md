# Roadmap

aragonite is the editor module — an independent library delivered at v1.0. Downstream consumers (the limestone app is the first) live in their own repos; this roadmap is the editor's own forward plan. Shipped milestones live in `docs/changelog.md`; this file is forward-looking only.

## Product theses

The long-term goal is a fully open-source notes platform that surpasses Obsidian on the axes it cannot defend:

- **Fully open source, end to end.** Editor, backend, sync server. Revenue, if any, comes from hosted convenience, not closed-source lock-in.
- **Efficient on large docs and large vaults.** Scale is a differentiator, not a caveat. Load-bearing: without it, the asymmetric win is rhetoric.
- **Svelte / TypeScript plugin DX.** The plugin experience is the ecosystem's gravity well. Svelte-first, typed end-to-end, scaffold + hot-reload + reference plugins in-repo. Trades plugin _count_ for plugin _quality + DX_ deliberately.

## Pre-1.0 — the plugin platform (freeze at the open-source release)

**1.0 ships the editor as a plugin platform.** The plugin-authoring API is exposed _pre-freeze_ on the `aragonite/plugin` subpath and refined against real extensions; it freezes only at the public open-source release. Validation before the freeze: at least two real container consumers, the in-repo dogfood extensions, and an internal limestone integration (without open-sourcing). Build ≠ freeze — nothing external binds until release. The pre-freeze surface, the editable-content tiers, and the plugin may/may-not boundary live in `docs/design/plugin-contract.md`.

The **block-kind surface** is API-complete and hardened (0.9.13–0.9.20), the **context
spine** closed most of the extension-surface gap (0.9.21), the **decoration gap** — the
one plugin class the platform could not express — closed in 0.9.22, and the **demo/packaging
groundwork** landed in 0.9.23 (bundled plugins as `aragonite/plugins/<name>` subpaths; `/` is
the showcase shell). The remaining risk is **validation depth**: one clean-room run deep,
every consumer since in-repo and same-day. The items below are ordered by **risk first,
validation before freeze**.

1. **Enforcement-hardening program — climb the ladder before external code binds.**

   The 2026-07 audit's two dominant bug classes — sibling-path parity (one rule enforced at N−1
   of N entry paths) and offset arithmetic done outside the shared walk — are held today by dev
   guards, prose, and review: the ladder's bottom rungs. This program climbs the load-bearing
   contracts to types while the climb is still cheap. Two of the four passes are
   **breaking-if-deferred** (the freeze criterion for pre-1.0 work), and all four are contracts a
   new consumer should inherit from the compiler, not from `culture.md`:

   1. **Branded coordinate spaces.** Raw offset, ambient-inclusive DOM-text offset,
      editor-relative X, viewport X, cell index, and doc-absolute path vs scope-local index are
      all `number` today — which is why every offset bug in the audit was arithmetic mixing them.
      Brand them (zero runtime cost), minted only by their single-home modules
      (`cursor/widget-offset.ts`, the commit scope factories) — G1.16's class climbs from guarded
      to unrepresentable. The public doors (rects, decorations) keep `number` signatures and
      brand at the boundary: consumer DX unchanged, internal arithmetic protected. Scheduled
      **before** presentation modes deliberately — rung 3 is the heaviest caret/offset churn
      left and should happen under compile-time protection, not ahead of it.
   2. **The closure matrix runs as an executable battery.** The required closure block has landed:
      registration answers every cross-cutting system with an implementation, an inherit-default, or
      an explicit not-supported, so a blank matrix cell is a compile error (a required registration
      field is breaking-if-deferred) and G1.24 cross-checks the cells against the descriptor — the
      0.9.18 lesson, made unrepresentable. What remains is _execution_: the `aragonite/testing`
      container conformance kit generalizes so registering a kind _enrolls_ it in a generic
      behavioral battery (focus walk, selection/search paint, clipboard round-trip) — a matrix row
      run, not declared. The battery must precede the clean-room run, which probes the third-party
      testing story.
   3. **Readonly-by-layer CST views.** The mutable node type stays visible only inside
      `tree-operations/` and the commit ceremony; components and the entire plugin surface
      receive deep-readonly views, so writing through a shared or stale reference (G1.9's
      perimeter) becomes a type error for most of the codebase. Breaking-if-deferred on the
      public surface — a consumer who binds mutable types at 1.0 breaks when they tighten.
   4. **Sibling-path parity lints.** Where a funnel can't exist yet, the parity rule ships as a
      source-scan guard (the `invariants/lint/` pattern): "every entry path matching X routes
      through Y" fails the day path N+1 is born instead of at the next audit. The
      caret-edge/destructive-key dispatch — three sibling seams as of the decorations work — is
      deliberately _not_ consolidated here: it hands to presentation modes rung 3 as that batch's
      opening move, one churn of one layer.

2. **Inline-layer observability — the flight recorder before the field reports.**

   The inline layer is where the editor's hardest bugs live and where a field report is least
   reconstructible: per-keystroke span rebuilds make every inline state transient (cursor
   capture/restore, reveal open/fold, widget-pool adopt/sweep, IME composition, island
   application), so by the time a report is read, the state that produced it is gone. The debug
   engine dumps document-level state — CST, selection, undo, ops — and nothing inline. Three
   deliverables, built before the two events that multiply the exposure: rung 3 (which multiplies
   the inline state machines) and the limestone integration (the first external field-report
   source).

   1. **The interaction trace** — a ring buffer of inline-layer transitions (rebuild + which
      render-key segment changed, cursor capture/restore offsets, reveal open/fold + reason,
      pool adopt/sweep counts, composition start/end, island applications, sticky capture/reset),
      joining the ops log in the debug panel's Copy-all. The panel stays dev-only; the recorder
      ships in production **default-off behind one boolean per site** — the perf-instruments
      discipline without the DEV strip — surfaced through a consumer diagnostics door so a real
      app can attach the trace to a bug report. A field report becomes: reproduce, copy, paste.
   2. **Transition assertions on the named state machines.** Reveal, pending-cursor,
      pool-bracket, and composition-window transitions become explicit and dev-asserted — an
      illegal interleaving fires loudly and locally on the invariant channel the e2e watcher and
      simulation already police, instead of surfacing three layers away as a caret mystery. The
      ledgered battery-order-sensitive reveal flake is the standing exhibit of the class this
      makes diagnosable.
   3. **The IME composition harness** — the ledgered test gap closed (synthetic composition
      events at the handler level, or CDP IME), so the composition contract is pinned directly
      rather than by analogy to sibling guards. Composition is the least-tested inline state
      machine and a prime field-report generator.

   Honestly placed: nothing here is breaking-if-deferred — this item is pre-1.0 for operational
   value (rung 3 gets built _with_ these instruments; limestone exercises the field-report
   workflow end to end), not freeze necessity. If the schedule tightens, this is the item that
   shrinks: the recorder ships, the assertions ride rung 3's opening move, the harness stays
   ledgered.

3. **Presentation modes — the full live-preview ladder, pulled forward from 1.1.** Obsidian
   defaults to Live Preview and reveals syntax for the element _under the cursor_. Always-visible
   styled source is a power-user aesthetic; a consumer evaluating aragonite against Obsidian sees
   markers everywhere and bounces before reaching the good part. Styled source stays the editing
   substrate — this makes it a choice, not a ceiling. Three rungs, each independently shippable,
   built in order:

   1. **Reading mode** — markers hidden, widgets rendered, read-only. Built through public surfaces
      only, as a consumer would; shipped as a showcase toggle by item 6.
   2. **Block-granular** — unfocused blocks hide markers, the focused block shows source. The
      editable-leaf render-primary swap generalized to built-in prose kinds. The stepping stone: it
      builds the marker-island rendering and the presentation-mode seam rung 3 refines.
   3. **Inline-granular** — the target. Marker islands + reveal-on-caret-proximity (the shipped
      reveal kernel with a caret-containment trigger) + caret-affinity semantics (the one genuinely
      new piece; prior art: ProseMirror stored marks). Block-granular alone is not the Obsidian
      feel — clicking into a paragraph should not turn the whole paragraph raw. Opening move:
      consolidate the caret-edge/destructive-key dispatch into declarative edge policies (three
      sibling seams as of the decorations work) before adding reveal semantics — never a fourth
      seam.

   **The reason this is pre-1.0 is the contract, not the feature.** A plugin has no way to learn
   what presentation mode it is in, so a plugin authored against a marker-always 1.0 renders wrong
   the day preview ships — not an API break, but worse: it strands the ecosystem. And rung 3 reaches
   into the _inline_ and _caret_ layers that plugins bind to (`registerInlineWidgetKind`, the editing
   policy, edge entry). Building it after the freeze is the dangerous order; a paper litmus cannot
   validate it, because a shape with no consumer cannot be validated.

4. **Limestone internal integration** — the last unchecked box in the validation list above and
   the highest-yield finding generator left: a real app wiring save/load, dirty-state, image
   resolution, and multiple documents against `plugins`, `getEvents()`, and `getSource()`. It
   also exercises item 2's field-report workflow (trace + copy-all → attached diagnostics) end
   to end, as the first consumer that will actually file one. The
   integration code lives in limestone; what belongs here is running it before the freeze and
   landing its findings while they are still cheap. Additive API needs it surfaces ship as
   pre-freeze refinements. The first-party plugin distribution question is settled
   (0.9.23): the integration consumes the bundled plugins as `aragonite/plugins/<name>` subpath
   exports directly — the copy-source sync pattern never enters the picture.
5. **Second clean-room run, scoped to the post-0.9.12 surfaces** — a walled-off author, a
   current tarball and public docs only, building something the new seams carry — **and
   writing tests for their plugin**, so the run probes the third-party testing story item 1
   ships, not just authoring discoverability. The first
   run validated container/chrome discoverability; nothing has third-party-validated the unit,
   transforms, portal widgets, or the leaf tier. One support question is the benchmark. The
   subject should exercise **editable-leaf plain mode** — its only consumer today is the
   synthetic memo fixture — plus a paste transform; natural candidates are an Obsidian-style
   `%%` comment block or YAML front matter (whose doc-position-only grammar and `---`-vs-setext
   conflict stress the opener seam). On promotion in-repo (the admonitions precedent), port the
   plain-mode battery onto the real plugin and retire memo.
6. **Demo polish — the pitch, last** — fill the showcase route (stood up in 0.9.23) with the
   full pitch: every block kind + every bundled plugin — fixtures stay off it
   (`src/routes/test/plugins/README.md`) — theme and prop toggles, polished debug panel. This
   is the "surpass Obsidian" argument made visible. The reference-plugin aesthetic decision is
   made and shipped (restrained gutter-rail chrome on the showcased admonitions/details; chrome
   remains the plugin author's call) — the showcase inherits it; demo polish extends the same
   restraint to whatever it adds. The showcase **surfaces item 3's presentation modes as
   toggles** — reading mode and block-granular live preview beside styled source — so the first
   impression is not markers-everywhere, and the freeze litmus "the contract must not preclude
   a rendered reading mode" becomes a working proof instead of a paper check.
7. **Freeze cut at release** — in order:
   - **Scoped pre-freeze re-audit** (forge-review, passes matched to what changed since 2026-07) —
     audits before milestones, not after incidents.
   - **1.3 paper dry-run**: walk each planned post-1.0 plugin (footnotes, emoji, autolinks)
     against the contract on paper and confirm no breaking-if-deferred gap — reading cost now versus
     breaking change later.
   - **Contributor-experience pass** — the minimal CONTRIBUTING front door shipped in 0.9.17;
     at release it becomes an actual on-ramp, not a deposition. Progressive disclosure:
     quickstart → conventions → the incident casebook (culture.md absorbed but restructured so
     a weekend contributor meets the rules before the scar tissue); a CODE_OF_CONDUCT; the PR
     flow and external-contributor setup; dev-loop friction retired or documented (the SSR
     registrar-poison entry in `docs/issues.md` is contributor experience — resolve or give it
     an honest workaround section); a first pass of curated entry-level issues. The bar stays
     high — the reading order is what changes.
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
   - **Freeze litmus (extension surface)**: the two shapes 0.9.22 pins rather than builds must
     hold. `BlockCommandContext` must be able to grow document mutation as _fields_ (a later
     second context object is a breaking restructure for every bound handler), and `setup(ctx)`
     must be able to grow capabilities as fields on the same context a global command receives —
     one context object, not two.
   - **Freeze litmus (decoration tier)**: a decoration is only as good as its worst-painting
     tier. Every tier in the closure matrix must supply `measurePartialRects`, including the
     childless opaque container — otherwise the decoration API ships with a hole the
     ecosystem inherits.
   - **Freeze litmus (presentation mode)**: a plugin block, editable leaf, and inline widget must
     each be able to learn the current presentation mode and render for it. Item 4 builds all three
     rungs, so this is verified by a real consumer rather than on paper — which is the point: rung 3
     is what proves the inline and caret contracts survive marker islands and caret affinity.
   - **Freeze litmus (enforcement hardening)**: item 1 shipped whole — registration's closure
     block is required-complete (a required field added post-1.0 is a breaking change), public
     plugin-surface document/node types are readonly views, and coordinate brands are minted only
     by their single-home modules with the public doors keeping `number`. Verified by the
     re-audit's enforcement pass, not assumed.
   - **Freeze litmus (history seam)**: no frozen surface binds the snapshot shape of undo — no
     public type exposes the undo stack or its entries, and the `edit` event's `undo`/`redo`
     variants stay representation-agnostic — so the overridable history seam (§ Downstream
     boundary) remains additive. Its interface is designed at the limestone integration against
     the consumer's actual history representation, together with the `EditEvent` real-delta
     discriminant (`plugin-contract.md` § Deferred) — the two are one design, and neither is
     shaped without the consumer at the table.
   - **Post-freeze versioning**: from 1.0, breaking changes to any frozen surface ride a major
     version; additive needs ship as 1.x minors.

### The two plugin systems

There will be two, and the boundary must be stated or every reviewer reads the app half as a hole
in the editor half.

| Layer                 | Owns                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **aragonite plugins** | Anything that touches the document or the editing surface: kinds, grammar, decorations, commands over the document, presentation |
| **limestone plugins** | Anything that touches the app: ribbon, sidebar, status bar, settings tabs, modals, the command palette UI, the vault, sync       |

Thirteen of Obsidian's top twenty-five plugins are app-shell — Obsidian only conflates the two
because it _is_ the app. An editor library that grows a ribbon API has lost the plot. Vault-wide
indexing (Dataview's `FullIndex`, Omnisearch) is limestone's too: `getEvents()` plus `parse()` is
the right raw material, and the editor supplies the material, not the index.

The line is not "editor = view": _single-document_ derived state (a table of contents, footnote
numbering, tasks in this note) is the editor's, because it is a function of the one document the
editor owns. That is why the editor hands a block component its document.

### Pre-freeze plugin direction decisions

Convergent capabilities the field survey (`docs/research/plugin-extension-surfaces.md`) flagged as
answered-by-omission rather than by decision. All are **additive-later** by the freeze criterion —
none _must_ ship before freeze — so each decision is _direction + validator_, not _build-now_:

- **Plugin-local state** (ProseMirror `StateField`/`PluginKey`, TipTap `addStorage`) — every other
  ecosystem has one; aragonite should **not**. **Decided: no state API.** Half the need is already
  met better — state belonging to a node goes _on_ the node, where it undoes, redoes and (if it
  feeds `rebuildRaw`) round-trips for free, none of which a `StateField` gives you. The other half
  evaporates: the dominant use of a state field elsewhere is holding a decoration set and **mapping
  it forward** through changes, which is forced by positions being integers into a flat sequence.
  aragonite's positions are `(path, offset)` into a CST re-derived on every edit — there is nothing
  to map forward, so a decoration source is a pure `doc → Range[]`, memoized. The extension
  surface's three primitives — the document, an editor identity, a change signal — let a plugin
  build any state it wants in its own `WeakMap`, while the platform stores nothing and owns no
  lifecycle. Recorded as a
  decision so it is not cargo-culted back in later.
- **Normalize-on-commit / veto seam** (ProseMirror `appendTransaction`/`filterTransaction`) — the
  highest-leverage lever for plugin _quality_: derived content, linked edits, auto-fix, structural
  guards. **Decided: yes, post-1.0.** No pre-freeze dogfood driver needs it, and the ceremony is
  internal (plugins never bind its shape), so the hook stays additive. Direction fixed now so 1.0
  doesn't foreclose it; the freeze cut's commit-seam litmus guards it; designed-ahead in
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
- **Built-in override / replacement** (Obsidian's codeblock processors; ProseMirror schema
  swaps) — two shapes that must not be conflated, decided separately. **Single-slot subsystem
  overrides are consumer seams, not plugin registries**: one implementation per concern, chosen
  by the embedding app, behind an interface the editor owns and the ceremony still polices — the
  history module is the first (§ Downstream boundary), and each such seam is designed bespoke
  against its first real alternative implementation, never as a generic module-swap framework.
  **Registry-level replacement of a built-in kind's component or descriptor stays excluded at
  1.0** (Plugin System II, `plugin-contract.md` § Explicitly excluded): registries are
  process-global, so an override is global and last-writer-wins — the collision tax every
  surveyed ecosystem paid. The supported replacement path is **grammar-level**: a plugin kind
  claims the syntax ahead of the built-in on the opener priority ladder (the mermaid precedent —
  uninstall-safe by decline), owns its own closure-matrix row, and — once item 1's conformance
  battery lands — proves it by enrollment. An executable code block is this pattern verbatim:
  claim the fence, render the run surface, keep the bytes. If post-1.0 demand shows genuine need
  for in-place replacement, Plugin System II is its home — after the battery exists to make "you
  own what you replace" checkable.

**Standing posture — the enforcement ladder: unrepresentable > guarded > documented.** Every
load-bearing contract climbs as high as it can: prefer types/seams that make the violation
inexpressible; where types can't reach, a dev guard that fails at the gate; prose only for what
neither can hold. Two habits keep the ladder honest: every bug fix records a one-line miss-analysis
("what test should have caught this, and why didn't it") in its commit or requirement file, and every
new feature class adds a simulation gesture so the corruption oracle's coverage tracks the product's
surface. The complexity is essential — cap the downside, don't simplify.

## Post-1.0 sketch

Subject to reconsideration after v1 ships.

### 1.1 — Shell integration

The editor inside a real app shell, where focus and navigation semantics are finally concrete.
Settles what only an integrated surface can settle:

- **The per-block a11y naming model** — editable blocks carry `role=textbox` with no accessible
  name, and the focusable `role=separator` on a thematic break reads as a slider to axe. Both are
  ledgered axe exemptions today; both are consequences of the editor-root a11y structure and want
  a real shell to decide against.
- **The accent palette vs. WCAG AA** — `--color-accent` is below AA on both the editor and code
  backgrounds at full opacity, so it fails contrast wherever it lands (link text, the code-fence
  language label). Markers were fixed by raising their dim; the accent needs a lighter value, and
  that is a brand decision.

_(Presentation modes moved to pre-1.0 — see § Pre-1.0, item 3.)_

### 1.2 — Plugin DX + deferred generalizations

The plugin _authoring_ API ships at 1.0; 1.2 is the developer experience that makes the Svelte/TypeScript plugin thesis real, plus the generalizations deferred until more consumers exist:

- **DX system:** plugin scaffold, hot-reload dev loop, in-repo reference-plugin fleet (each exercising a different extension shape — callout, KaTeX, export command, image gallery, smart-HTML-paste), plugin docs site, plugin DX test suite — plus a declarative-manifest overload on the shipped `definePlugin` unit if a consumer wants one.
- **Unified command registry + palette** — migrate built-in block commands off `component.runCommand` onto the `(kind,id)` registry so dispatch has one home (the CodeMirror/ProseMirror model — a command is a function of a context, not a method on the view); a command palette enumerates the registry. Ships on the command-mint foundation (0.9.7) and the pre-1.0 global-command mint; `KeybindingOverride.kind` already spans plugin kinds (0.9.16). Mermaid v2 — its plugin-owned textarea edit mode rebuilt on the shipped editable-leaf surface — is the recipe upgrade to fold in here when wanted.
- **Selection coordinate-addressing hooks** — retire the selection layer's `kind === 'table'` gates (and the chrome×table composition) into descriptor hooks dispatched by presence, mirroring the `foreignDragHitTest` precedent. The _public rect API_ half pulled forward to pre-1.0 (the decoration tier bottlenecks on it); what remains here is retiring the internal kind gates.
- **Trigger-character suggest seam** — a `/` menu, `@`-mentions, `[[`-completion. Table stakes for a notes app, and the class Obsidian carries with `registerEditorSuggest`. Deferred deliberately: the pre-1.0 rect API makes a suggest popup _consumer_-buildable (caret geometry plus `getSelection()`), so the question 1.2 answers is whether it deserves a first-class editor seam or stays a consumer pattern. Decide against a real consumer, not on paper.
- **Inline-parser precedence overrides** — the scan-stage hook itself shipped pre-1.0 (`registerInlineSyntax`, with KaTeX as the consumer); what remains is a precedence-override variant for recognizers that must outrank built-in inline syntax, validated by the 1.3 footnotes/emoji plugins.
- **Render-primary authoring gaps** — both recorded walls shipped pre-1.0 (whole-block focus at 0.9.18; the command→component channel in the pre-1.0 hardening program). What remains here is second-round refinement against post-1.0 consumer feedback.
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
design decision the editor and its first consumer must make together). Working direction
(owner, 2026-07): limestone supplies the collaboration infrastructure; the likely editor-side
shape is an **overridable history seam** — the undo/redo module behind an interface a consumer
can replace — decided at the limestone integration, scheduled deliberately rather than ambient
(the longer the decision floats, the more code accretes against the snapshot shape).
