# Roadmap

aragonite is the editor module — an independent library delivered at v1.0. Downstream consumers (the first is limestone, the note-taking app aragonite was extracted from, not itself public) live in their own repos; this roadmap is the editor's own forward plan. Shipped milestones live in `docs/changelog.md`; this file is forward-looking only.

## Product theses

The long-term goal is a fully open-source notes platform that surpasses Obsidian on the axes it cannot defend:

- **Fully open source, end to end.** Editor, backend, sync server. Revenue, if any, comes from hosted convenience, not closed-source lock-in.
- **Efficient on large docs and large vaults.** Scale is a differentiator, not a caveat. Load-bearing: without it, the asymmetric win is rhetoric.
- **Svelte / TypeScript plugin DX.** The plugin experience is the ecosystem's gravity well. Svelte-first, typed end-to-end, scaffold + hot-reload + reference plugins in-repo. Trades plugin _count_ for plugin _quality + DX_ deliberately.

## Pre-1.0 — the plugin platform (freeze at the open-source release)

**1.0 ships the editor as a plugin platform.** The plugin-authoring API is exposed _pre-freeze_ on the `aragonite/plugin` subpath and refined against real extensions; it freezes only at the public open-source release. Validation before the freeze: at least two real container consumers, the in-repo dogfood extensions, and the limestone integration, which ran in 2026-07. Build ≠ freeze — nothing external binds until release. The pre-freeze surface, the editable-content tiers, and the plugin may/may-not boundary live in `docs/design/plugin-contract.md`.

1. **Limestone integration — remaining scope.** The integration ran (2026-07) and paid
   as predicted: the editor is the app's editor, the findings landed as 0.9.36 refinements, and
   the consumer-lens directions below are its architectural residue. The 0.9.25 **field-report
   workflow** has now run end to end against the real app (reproduce → `serializeDiagnostics()` →
   attach), so the door is proven rather than assumed; what it left forward is narrower — the
   embedder must hold and expose the editor instance for the diagnostics door to be reachable at
   all (an example-app requirement), and the trace behind the report covers the inline layer only.
   What has NOT yet run, and stays here as forward work: the **overridable-history-seam joint
   design** (§ Downstream boundary — the integration is named as the design table, and the table
   has not convened); and landing whatever the consumer's remaining manual passes (journal
   surface, real-webview gestures) surface before the freeze.

2. **Clean-room 2 residue: the plain-mode promotion decision.** The second run executed
   2026-08-01 (front matter subject: editable-leaf plain mode, a paste transform, its own
   `aragonite/testing` suite; its artifacts stay internal records), and
   its findings landed as pre-freeze refinements — the docs pack carried three of the five
   requirements unaided, and one support question was the recorded benchmark. What stays
   forward: if a plain-mode kind promotes in-repo (the admonitions precedent — front matter is
   the natural candidate), port the plain-mode battery onto the real plugin and retire the memo
   fixture; until one does, memo remains plain mode's only consumer. The external-author gate at
   the freeze cut stays a separate box — the run probed discoverability, not external evidence.
3. **Fully live mode — the fifth presentation rung.** Pulled forward from the post-1.0 sketch
   (owner, 2026-08-08): the preview-inline beta cohort reports zero defects and asks for fully
   live, which is the real-use data the entry's own gate demanded. Fully rendered while
   editable — markers never visible, even in the focused construct. The single render path
   carries the paint as it carried the other four rungs (marker visibility over the same
   spans, never a second pipeline), and hidden marker runs join the one DOM↔raw offset walk
   the way widget and ambient contributions already do. The genuinely new work is the editing
   semantics the reveal hatch used to make unnecessary: a collapsed-caret formatting affinity
   (the Mod+B/I toggle — the first stored-marks-shaped state in the editor, kept deliberately
   minimal), construct-edge caret and unwrap-on-Backspace policy declared per construct family
   at a choke point, and enrollment in the caret-door simulation families at birth (G2.12:
   every caret-placing change is a data-loss candidate until proven otherwise). Gap-caret
   scale: multi-wave, reviewed per wave. Shipping pre-freeze means `PresentationMode` freezes
   with five rungs; the litmus's union-growth clause then guards the rungs after it.
4. **Two hardening items from the 2026-08-08 assessment**, both before the freeze because each
   is a class the session's defect discoveries kept paying into:
   - **The separator-settle funnel.** Five seams hand-call the restore/drop door pair (the
     #73/#96 class); a probe-based `settleSeparator` at the splice level closes the class
     structurally and absorbs the container-match and absorb arms free. It was priced out of
     the keystroke path once; the build carries the measurement that clears or re-prices that.
     Validator: the becomes-blank sweep reads zero divergent outside #61's class, and the
     hand-carried seam count drops to one.
   - **Gate-visible warnings.** `devWarn` returns early under test and the e2e console watch
     sees only `[invariant:` fires (#63), so every DEV-only guard is invisible to every gate —
     the #98 caret-drift warn is the shipped example. Direction: a warn fails the unit run by
     default behind an expected-warn allowlist, and the collector widens. Validator: #98's
     warn class reds a gate the day it regresses.
5. **Freeze cut at release** — in order:
   - **Scoped pre-freeze re-audit** (a structured review pass, matched to what changed since 2026-07) —
     audits before milestones, not after incidents. Most of the accumulated freeze-review
     pointers from the 2026-07 burn-down landed in the 2026-08 open-source prep (conformance
     guards for `conformanceFixture` and the `bodyWrite`/`terminatorCollision` pairing, the
     checked fixture-position contract, the G4.28 bare-`.raw =` arm, the re-derived
     `normalizeRawWrite` docstring, the one-place collision-policy statement, `isFirstInWindow`
     removed). Still open for the re-audit: `chordsForCommand` lands with the 1.2 unified
     command registry, and `EditorRects` naming (the embedding instance says `getRects()`, the
     plugin context says `.rects`, each consistent with its own surface's convention; decide
     whether the two surfaces should agree), and one decision the mount-waiter rekeying left
     behind: every production reveal caller supplies `isInWindow`, so the waiter registry has
     no production reader today; with `RefSlots` public, either require the option and delete
     the wait path, or keep the registry as the documented fallback and say so at the type.
     The collision policy's consumer-facing half stays ledgered as #70. Also for the re-audit:
     the separator family's parent types unified 2026-08-08 (`SeparatorParent` is the one
     shape), and the `settleSeparator` funnel itself moved up to pre-1.0 item 4 rather than
     riding here as a pointer.
   - **External-author gate** — the freeze does not cut on first-party evidence alone: at
     least one plugin built by a genuinely external developer from the tarball and the docs
     pack, unassisted, with the friction log treated as blocking input — additive findings
     land as pre-freeze refinements; a structural finding moves the cut. Decoupled from
     publishing (owner, 2026-08-02): a 0.9.x/0.10 package ships to npm explicitly unstable
     BEFORE the freeze, the gate runs against that published package, and 1.0 cuts when the
     gate passes — gated by the importants column and contract completeness, never by the
     minor tail or an empty ledger.
   - **1.3 dry-run** — the beyond-GFM reference plugins shipped pre-freeze rather than as paper
     probes: footnotes, the riskiest, on the 0.9.33 inline precedence ladder (build-probed 0.9.30,
     then promoted whole), and emoji on the 0.9.34 bare-`:` rung, so this check rests on shipped
     consumers where it matters most. At the cut, confirm the one deliberately-excluded item (the
     GitHub repo-context autolink sugar, § 1.3) carries no breaking-if-deferred gap.
   - **Contributor-experience pass** — the minimal CONTRIBUTING front door shipped in 0.9.17;
     at release it becomes an actual on-ramp, not a deposition. Progressive disclosure:
     quickstart → conventions → the incident casebook (culture.md absorbed but restructured so
     a weekend contributor meets the rules before the scar tissue); a CODE_OF_CONDUCT (shipped
     2026-08-07); the behavior-to-seam codebase map (pre-freeze, with a reference-existence
     lint so staleness fails CI; the 2026-08-07 cold-start probes' friction logs are its
     checklist, and the interactive-tutorial direction resolved to demo-embedded material
     only); an anatomy-of-a-change case study traced from the gap-caret arc; the PR
     flow and external-contributor setup; dev-loop friction retired or documented (the SSR
     registrar-poison class was structurally fixed in 0.9.27 — dev re-registration replaces
     instead of throwing; only the chorded plugin-global-command residual remains); a first pass of curated entry-level issues. The bar stays
     high — the reading order is what changes.
   - **Collapse the 0.9.x changelog working notes into one tight 0.9 entry** — the changelog's own
     pre-v1 style rule; the per-patch notes served the pre-1.0 window and their detail lives in
     `git log`.
   - Final contract reconciliation; **pre-freeze labels come off** — the `(pre-freeze)` section
     markers in `src/lib/plugin.ts` are the published signal telling an external author which
     parts of the frozen contract are not yet frozen, so `grep -c pre-freeze src/lib/plugin.ts`
     returning nonzero after the cut means the API is lying about its own stability. The
     pending owner decisions this bullet used to carry landed in the 2026-08 prep: the env
     seam's split is deliberate and lint-enforced (G4.25; the override door ships on
     `aragonite/testing`), `BlockComponent` members stay flat with the three-layer grouping as
     documentation, the a11y strings table shipped for core chrome (bundled plugins own their
     strings, the import-boundary lint makes a shared table unrepresentable), and the shipped
     `.d.ts` surface is documented as contract in `plugin-contract.md` rather than pruned.
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
     each be able to learn the current presentation mode and render for it. The mode contract is
     shipped (the `PresentationMode` union, `EditorContext.presentationMode` + change event, the
     leaf/widget mode reads, the `data-presentation` root attribute) with all four rungs as
     consumers — reading, block-granular, and inline-granular preview (the last rung activated
     with zero API change, proving the union-ships-whole bet; it needed no new DOM contract —
     CSS construct-reveal over the existing marker spans, not marker islands). The caret-affinity
     contract shipped with 0.9.26 and dissolved to raw offsets + inclusive reveal edges — no
     stored-marks machinery; the litmus reads satisfied-by-construction at the cut, with the
     reading-gate parity residual tracked as issue #38. A fifth rung ships pre-freeze (item 3,
     Fully live mode), so the union freezes at five; the litmus still verifies it can GROW in
     a minor for any rung after it: no frozen surface may demand exhaustiveness over
     `PresentationMode`, and non-exhaustive handling is the documented consumer contract.
   - **Freeze litmus (enforcement hardening)**: the 0.9.24 program shipped whole — registration's closure
     block is required-complete (a required field added post-1.0 is a breaking change), public
     plugin-surface document/node types are readonly views, and coordinate brands are minted only
     at their home modules with the public doors keeping `number`. The liveness pass
     (shipped 0.9.29) extends the program: no frozen deps field whose contract is a liveness
     rule remains value-shaped — every live read on the public surface is a thunk. Re-verified
     by the re-audit's enforcement pass, not assumed.
   - **Freeze litmus (gap caret)**: the between-blocks caret ships with its position outside
     the public `SelectionPoint` union — `getSelection()` reads null while a gap is live, and
     the settled-emission contract is pinned. Verify no frozen surface precludes publishing a
     gap representation later as an additive read-side shape rather than a union member every
     consumer must switch over.
   - **Freeze litmus (history seam)**: no frozen surface binds the snapshot shape of undo — no
     public type exposes the undo stack or its entries, and the `edit` event's `undo`/`redo`
     variants stay representation-agnostic — so the overridable history seam (§ Downstream
     boundary) remains additive. Its interface is designed at the limestone integration against
     the consumer's actual history representation, together with the `EditEvent` real-delta
     discriminant (`plugin-contract.md` § Deferred) — the two are one design, and neither is
     shaped without the consumer at the table.
   - **Branch protection at the flip to public**: run `node scripts/apply-branch-protection.mjs`
     as part of the flip, which is the first point the API accepts protection rules for this repo;
     the required status contexts mirror ci.yml's job names (a job rename updates the script).
   - **Post-freeze versioning**: from 1.0, breaking changes to any frozen surface ride a major
     version; additive needs ship as 1.x minors.

### The consumer lens — architecture directions from the first integration

What the limestone run taught that no in-repo battery could, recorded as direction so the next
milestone that touches each area inherits it rather than rediscovering it:

- **Inline-widget _editing_ is where a consumer's defect density concentrates.** The integration's
  finds clustered overwhelmingly in one region: what happens when a caret, a keystroke, or a
  command meets an inline widget (the reveal-fold seam, caret mutual exclusion, collapsed-caret
  formatting, the syntax-of-origin family and its `rewriteImage` hook). Gathering the editing
  capabilities a rung carries into one facet was assessed and rejected: they sit in two key
  spaces, rung and kind, and the split is the design, so what 1.2 inherits is the layering
  direction (§ 1.2) rather than a consolidation. Standing direction: a new inline-editing
  capability picks its key space deliberately and enrolls in the inline conformance kit, which
  is where a rung's behavior is held now.
- **The webview host boundary is where consumer bugs live, and the in-repo harness cannot see it.**
  Three integration finds were invisible to any Chromium-driven battery: clipboard events
  retargeting to `document.body` off a caret-less endpoint, the host webview's built-in
  accelerator keys consuming chords before the page, and the image-src scheme policy meeting
  a real host protocol. The consumer guide's webview-host section is the documented half.
  Direction: post-1.0 a minimal **Tauri example consumer** joins `examples/`, so this class is
  exercised by a gate rather than discovered by a user. Validator: each webview find of the next
  integration lands as a row in that example's checklist, not a surprise.
- **Singletons earn their keep only until the second claimant arrives.** The process-global
  reveal anchor produced two consumer-visible defects, the interaction trace interleaves
  instances by design, and the reveal mount-waiter registry had to move off its bare-index
  process-global key. Standing direction for anything new: a process-global slot is a
  deliberate choice with a written second-claimant story, not a default.
- **Every gesture that places a caret is a data-loss candidate until proven otherwise.** The
  precondition no suite had ever built — a live cross-block range before a caret-placing
  gesture — hid two whole-document losses. G2.12 fails new pointer gestures at birth, but its
  perimeter is pointer-only by design and a caret can land through doors it cannot see at all
  (the navigation API is the shipped example), so a new caret-placing door joins the simulation's
  range-interrupt family by hand or goes unprobed.

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
  uninstall-safe by decline), owns its own closure-matrix row, and — with the conformance
  battery (0.9.24) — proves it by enrollment. An executable code block is this pattern verbatim:
  claim the fence, render the run surface, keep the bytes. If post-1.0 demand shows genuine need
  for in-place replacement, Plugin System II is its home — after the battery exists to make "you
  own what you replace" checkable.
- **GitHub's rendered extras that aragonite keeps literal** — inline HTML as live widgets
  (`<kbd>`, `<sub>`, `<sup>`, `<ins>`) and the diagram fences past mermaid (geoJSON, topoJSON,
  STL). **Decided: neither pre-1.0** (owner, at the 2026-07 GitHub-parity run). Both are
  plugin-shaped on surfaces that already ship, so deferring forecloses nothing. A curated tag
  set is a prefix rung on the reserved `<` trigger rendering an atomic widget over unchanged
  bytes (the entity-reference mold); the whole design question is the curation — which tags
  earn a widget, and the answer for every other tag staying "render as literal source", which
  is also its uninstall story. A diagram fence is a fence claim on the mermaid precedent,
  priced ahead of `fencedCode` and declining every info string it does not own; those
  additionally drag heavy render engines for a niche audience, which is why they sit as
  post-1.0 candidates rather than pre-freeze work.
- **Heading-anchor `#fragment` navigation** (GitHub/Obsidian in-note links) — a `[jump](#deep-heading)`
  prose link scrolling to the matching heading. **Decided: deferred, additive-later** (assessed at
  toc v2, 0.9.35). The heading half is cheap and in reach: a pure `slugify` over the same
  `heading-outline` walk — GitHub's rule (lowercase, drop all but word chars / spaces / hyphens,
  spaces → `-`), then dedupe collisions with `-1`, `-2`… in document order — yields a `slug → path`
  map. The blocker is the **resolution seam**: aragonite has no inline-link-click hook, and in a
  contenteditable a plain click on a link places the caret (editing), so intercepting it to navigate
  needs a new editor-level convention (a modifier-click, or a rendered-link activation seam) plus DOM
  identification of the link's fragment — cross-cutting inline-render / pointer work past a toc-local
  ~150-line budget, and a which-gesture-navigates-vs-edits UX decision the toc plugin cannot make
  alone. Direction: when built, the slug utility ships on the plugin barrel beside `headingLevel`, and
  resolution rides whatever inline-link-activation seam the editor grows, reading the one
  `heading-outline` walk. No pre-freeze driver forces it.

**Standing posture — the enforcement ladder: unrepresentable > guarded > documented.** Every
load-bearing contract climbs as high as it can: prefer types/seams that make the violation
inexpressible; where types can't reach, a dev guard that fails at the gate; prose only for what
neither can hold. Two habits keep the ladder honest: every bug fix records a one-line miss-analysis
("what test should have caught this, and why didn't it") in its regression test's requirement file, and every
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
- **Token-role audit** — the first integration found two token-hygiene classes worth one deliberate
  pass: a token serving two visual roles at once (`--syntax-separator` tinted marker glyphs AND
  painted the full-width thematic-break rule, so a consumer's palette choice for one was the wrong
  loudness for the other), and a chrome token with no mode response (`--color-ui-faint`,
  identical in both palettes and hue-odd among its siblings). The audit asks of every token: one
  role, both modes answered, and a stated reason for any exception.

_(Presentation modes shipped pre-1.0 in 0.9.26.)_

### 1.2 — Plugin DX + deferred generalizations

The plugin _authoring_ API ships at 1.0; 1.2 is the developer experience that makes the Svelte/TypeScript plugin thesis real, plus the generalizations deferred until more consumers exist:

- **DX system:** plugin scaffold, hot-reload dev loop, in-repo reference-plugin fleet (each exercising a different extension shape — callout, KaTeX, export command, image gallery, smart-HTML-paste), plugin docs site, plugin DX test suite — plus a declarative-manifest overload on the shipped `definePlugin` unit if a consumer wants one.
- **Unified command registry + palette** — migrate built-in block commands off `component.runCommand` onto the `(kind,id)` registry so dispatch has one home (the CodeMirror/ProseMirror model — a command is a function of a context, not a method on the view); a command palette enumerates the registry. Ships on the command-mint foundation (0.9.7) and the pre-1.0 global-command mint; `KeybindingOverride.kind` already spans plugin kinds (0.9.16). Mermaid v2 — its plugin-owned textarea edit mode rebuilt on the shipped editable-leaf surface — is the recipe upgrade to fold in here when wanted.
- **Selection coordinate-addressing hooks** — retire the selection layer's `kind === 'table'` gates (and the chrome×table composition) into descriptor hooks dispatched by presence, mirroring the `foreignDragHitTest` / `caretTargetAtPoint` precedent (two hooks now, and their split is the pattern: one answers the exact hit a drag needs, the other the nearest target a caret gesture needs). The _public rect API_ half pulled forward to pre-1.0 (the decoration tier bottlenecks on it); what remains here is retiring the internal kind gates.
- **Trigger-character suggest seam** — a `/` menu, `@`-mentions, `[[`-completion. Table stakes for a notes app, and the class Obsidian carries with `registerEditorSuggest`. Deferred deliberately: the pre-1.0 rect API makes a suggest popup _consumer_-buildable (caret geometry plus `getSelection()`), so the question 1.2 answers is whether it deserves a first-class editor seam or stays a consumer pattern. Decide against a real consumer, not on paper.
- **Render-primary authoring gaps** — both recorded walls shipped pre-1.0 (whole-block focus at 0.9.18; the command→component channel in the pre-1.0 hardening program). What remains here is second-round refinement against post-1.0 consumer feedback.
- **The math render seam still carries no theme term** — the mermaid renderer took one pre-1.0 (a theme in its render context, a theme-keyed memo, a redraw on flip); the injected `MathRenderer` did not, and its memo key has no theme term either. Latent rather than live: the shipped KaTeX adapter emits CSS-styled markup that inherits the editor's colors, where a drawn diagram carries its own. An injected engine emitting color literals would repeat the mermaid case exactly. Direction: when a second engine asks, the math seam takes the shape the mermaid one already has rather than a second design.
- **Per-rung editing policy for a borrowed built-in kind** — a rung that mints a built-in kind can re-serialize its own bytes (`rewriteImage`) but cannot give its own instances an editing behavior distinct from the built-in's. The caret-edge dispatch resolves policy by kind, so an Obsidian-style `![[embed]]` minted as an `image` necessarily edits like a GFM image: same edge policy, same delete granularity, same selected-key handling. The only lever today is `augmentInlineWidgetKind('image', …)`, which changes behavior for **every** image in the document, including ones the plugin never claimed. Direction: a claim-keyed policy lookup layered over the kind-keyed one (consult the node's syntax claim first, fall back to the kind), which preserves both key spaces instead of merging them, and is additive rather than breaking. Deliberately not taken pre-1.0: no consumer has asked, the layering is straightforward whenever one does, and the merged-facet alternative would break the built-in widget kinds (which carry policies and have no rung at all) to reach the same place.

### 1.3 — Beyond-GFM (as plugins)

De-facto GitHub.com extensions built as plugins on the 1.0 authoring API, dogfood proof the API carries third-party contributions. The reference-plugin set shipped pre-1.0: admonitions, Mermaid, and footnotes (footnotes rode the 0.9.33 inline precedence ladder), and emoji shipped on the 0.9.34 bare-`:` rung as the last of them. GitHub autolinks need no plugin (bare, `www.`, and email autolinks are already native GFM), and the remaining GitHub.com repo-context sugar (issue/PR refs like `#123`, `@`-mentions, cross-repo `user/repo#123`) stays deliberately excluded: it resolves against a repo/vault the editor does not own, so it belongs to the consumer, not the editor library. The milestone's forward scope is therefore closed; it stands as the record that the authoring API carried every beyond-GFM extension it was asked to. Had any failed to build cleanly as a plugin, that would have revealed an API gap to fix; none did.

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

A second named joint decision: **host-scrollport windowing (the journal shape).** Windowing is
deliberately inactive in host-scroll mode today; the height model reads its viewport and offset
from the editor root, which a page-scrolled shell never scrolls. The port is characterized: a
scrollport abstraction supplying rect, offset, writer, change signal, and content width, which
converges on the `UserScrollport` resolution the autoscroll seam already owns. A
single-editor-per-scrollport version is mechanical plus one stated trade (native scroll
anchoring and windowing's manual correction cannot coexist on one editor, so the mode drives
the declaration). The open design, and the journal's actual shape, is N editors sharing one
scrollport: N windowing roots correcting one scroll offset needs a coordinator that owns the
write. Sequenced after the owner exercises the real journal surface; the coordinator is decided
jointly with the consumer, not sketched ahead of it.
