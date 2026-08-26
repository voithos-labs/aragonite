# Roadmap

aragonite is the editor module, an independent library delivered at v1.0. Downstream consumers live in their own repos (the first is limestone, the note-taking app aragonite was extracted from, not itself public), so this roadmap is the editor's forward plan and nobody else's. Shipped milestones live in `docs/changelog.md`. This file is forward-looking only, which means if you find something in here that already exists, that is a defect in the document, not a feature of it.

## Product theses

The long-term goal is a fully open-source notes platform that beats Obsidian on the axes Obsidian cannot defend. Three of them:

- **Fully open source, end to end.** Editor, backend, sync server. Revenue, if there ever is any, comes from hosted convenience rather than closed-source lock-in.
- **Efficient on large docs and large vaults.** Scale is a differentiator, not a caveat. This one is load-bearing: without it the asymmetric win is rhetoric.
- **Svelte / TypeScript plugin DX.** The plugin experience is the ecosystem's gravity well. Svelte-first, typed end-to-end, scaffold + hot-reload + reference plugins in-repo. Trades plugin _count_ for plugin _quality + DX_ deliberately, and yes, that is a bet.

## Pre-1.0 — the plugin platform (freeze at the open-source release)

**1.0 ships the editor as a plugin platform.** The plugin-authoring API is exposed _pre-freeze_ on the `@voithos-labs/aragonite/plugin` subpath and refined against real extensions; it freezes only at the public open-source release. Before the freeze it has to survive validation: at least two real container consumers, the in-repo dogfood extensions, and the limestone integration, which ran in 2026-07. Build ≠ freeze, and nothing external binds until release, which is the whole reason a surface can ship early and still be wrong without anyone getting hurt. The pre-freeze surface, the editable-content tiers, and the plugin may/may-not boundary live in `docs/design/plugin-contract.md`.

1. **Limestone integration, remaining scope.** The integration ran (2026-07) and paid out
   as predicted: the editor is the app's editor, the findings landed as 0.9.36 refinements, and
   the consumer-lens directions below are its architectural residue. The 0.9.25 **field-report
   workflow** has now run end to end against the real app (reproduce → `serializeDiagnostics()` →
   attach), so the door is proven rather than assumed. What it left forward is narrower: the
   embedder must hold and expose the editor instance for the diagnostics door to be reachable at
   all (an example-app requirement), and the trace behind the report covers the inline layer only.
   What stays here as forward work is the owner's manual half of the real-webview gesture pass
   (real IME, host accelerators, DPI moves, and the checklist for all of it is written), whose
   findings land before the freeze. The automated half ran 2026-08-14 in the real WebView2
   (clipboard settle re-probed and its watch closed; boot, bridge and console clean). The
   journal-surface pass ran the same day, and the overridable-history-seam design this item once
   carried was dissolved by the consumer decision recorded in § Downstream boundary.

2. **Freeze cut at release**, in order. (The scoped pre-freeze re-audit and the
   contributor-experience pass both ran 2026-08-14/15 and left the roadmap with the audit's
   decision items all closed: `chordsForCommand`
   confirmed 1.2, the `getRects()`/`.rects` split recorded as deliberate convention, the
   mount-waiter fallback documented at its type, #70 closed by the consumer-guide pattern.
   The 1.3 dry-run confirm is answered too: the repo-context autolink exclusion is additive to
   close, with the leftward-claim limitation recorded in `plugin-contract.md` § Inline
   authoring.)
   - **External-author gate.** The freeze does not cut on first-party evidence alone. It needs at
     least one plugin built by a genuinely external developer from the tarball and the docs
     pack, unassisted, with the friction log treated as blocking input. Additive findings
     land as pre-freeze refinements; a structural finding moves the cut. Decoupled from
     publishing (owner, 2026-08-02): a 0.9.x/0.10 package ships to npm explicitly unstable
     BEFORE the freeze, the gate runs against that published package, and 1.0 cuts when the
     gate passes, gated by the importants column and contract completeness, never by the
     minor tail or an empty ledger.
   - Final contract reconciliation; **pre-freeze labels come off**. The `(pre-freeze)` section
     markers in `src/lib/plugin.ts` are the published signal telling an external author which
     parts of the frozen contract are not yet frozen, so `grep -rc pre-freeze src/lib/plugin.ts src/lib/index.ts`
     returning nonzero after the cut means the API is lying about its own stability (the
     consumer barrel carries the same markers since the command door landed). The
     pending owner decisions this bullet used to carry landed in the 2026-08 prep: the env
     seam's split is deliberate and lint-enforced (G4.25; the override door ships on
     `@voithos-labs/aragonite/testing`), `BlockComponent` members stay flat with the three-layer grouping as
     documentation, the a11y strings table shipped for core chrome (bundled plugins own their
     strings, the import-boundary lint makes a shared table unrepresentable), and the shipped
     `.d.ts` surface is documented as contract in `plugin-contract.md` rather than pruned.
   - **Freeze litmus**: the contract must not preclude a consumer-built rendered reading mode
     (markers hidden, widgets rendered). Always-visible-styled-source is the editor's default, not
     a wall; verify no frozen surface hard-binds it.
   - **Freeze litmus (commit seam)**: verify the owned-view / copy-path-on-write protocol (G1.9)
     can extend to a _plugin-contributed_ mutation inside the ceremony. The real hazard of a
     post-1.0 normalize-on-commit / veto seam (§ Pre-freeze plugin direction decisions) is not "did
     we preclude the hook" but "can a plugin append a mutation without breaking the aliasing
     invariant."
   - **Freeze litmus (accumulated surface checks)**: the per-surface litmuses recorded in
     `plugin-contract.md` § pre-freeze authoring surface, meaning the plugin unit's additive room
     (enablement layer / lazy setup / declarative-manifest overload), the synchronous-only
     ambient attribution boundary, and `FenceOpen`'s verbatim-byte return contract. Each one gets
     re-verified at the cut.
   - **Freeze litmus (extension surface)**: the two shapes 0.9.22 pins rather than builds must
     hold. `BlockCommandContext` must be able to grow document mutation as _fields_ (a later
     second context object is a breaking restructure for every bound handler), and `setup(ctx)`
     must be able to grow capabilities as fields on the same context a global command receives.
     One context object, not two.
   - **Freeze litmus (decoration tier)**: a decoration is only as good as its worst-painting
     tier. Every tier in the closure matrix must supply `measurePartialRects`, including the
     childless opaque container. Miss one and the decoration API ships with a hole the
     whole ecosystem inherits.
   - **Freeze litmus (presentation mode)**: a plugin block, editable leaf, and inline widget must
     each be able to learn the current presentation mode and render for it. The mode contract is
     shipped (the `PresentationMode` union, `EditorContext.presentationMode` + change event, the
     leaf/widget mode reads, the `data-presentation` root attribute) with all four rungs as
     consumers: reading, block-granular, and inline-granular preview (the last rung activated
     with zero API change, proving the union-ships-whole bet; it needed no new DOM contract at
     all, just CSS construct-reveal over the existing marker spans, not marker islands). The
     caret-affinity contract shipped with 0.9.26 and dissolved to raw offsets + inclusive reveal
     edges, no stored-marks machinery, so the litmus reads satisfied-by-construction at the cut,
     with the reading-gate parity residual closed with #38. The fifth rung, fully live, shipped
     pre-freeze (0.9.36, `docs/design/live-mode.md`), so the union freezes at five; the litmus
     still verifies it can GROW in a minor for any rung after it: no frozen surface may demand
     exhaustiveness over `PresentationMode`, and non-exhaustive handling is the documented
     consumer contract.
   - **Freeze litmus (enforcement hardening)**: the 0.9.24 program shipped whole. Registration's closure
     block is required-complete (a required field added post-1.0 is a breaking change), public
     plugin-surface document/node types are readonly views, and coordinate brands are minted only
     at their home modules with the public doors keeping `number`. The liveness pass
     (shipped 0.9.29) extends the program: no frozen deps field whose contract is a liveness
     rule remains value-shaped, so every live read on the public surface is a thunk. Re-verified
     by the re-audit's enforcement pass, never assumed.
   - **Freeze litmus (gap caret)**: the between-blocks caret ships with its position outside
     the public `SelectionPoint` union, so `getSelection()` reads null while a gap is live, and
     the settled-emission contract is pinned. Verify no frozen surface precludes publishing a
     gap representation later as an additive read-side shape rather than a union member every
     consumer must switch over.
   - **Freeze litmus (history seam)**: no frozen surface binds the snapshot shape of undo. No
     public type exposes the undo stack or its entries, and the `edit` event's `undo`/`redo`
     variants stay representation-agnostic. No history-module replacement is planned (§
     Downstream boundary carries the consumer decision); the litmus stays as future-proofing,
     so a collaboration representation adopted later remains additive.
   - **Branch protection at the flip to public**: run `node scripts/apply-branch-protection.mjs`
     as part of the flip, which is the first point the API accepts protection rules for this repo;
     the required status contexts mirror ci.yml's job names (a job rename updates the script).
   - **Post-freeze versioning**: from 1.0, breaking changes to any frozen surface ride a major
     version; additive needs ship as 1.x minors.

### The consumer lens — architecture directions from the first integration

What the limestone run taught that no in-repo battery could, written down as direction so the next
milestone touching each area inherits it instead of rediscovering it the expensive way:

- **Inline-widget _editing_ is where a consumer's defect density concentrates.** The integration's
  finds clustered in one region, and it was not a subtle cluster: what happens when a caret, a
  keystroke, or a command meets an inline widget (the reveal-fold seam, caret mutual exclusion,
  collapsed-caret formatting, the syntax-of-origin family and its `rewriteImage` hook). Gathering
  the editing capabilities a rung carries into one facet was assessed and rejected: they sit in
  two key spaces, rung and kind, and the split _is_ the design, so what 1.2 inherits is the
  layering direction (§ 1.2) rather than a consolidation. Standing direction: a new inline-editing
  capability picks its key space deliberately and enrolls in the inline conformance kit, which
  is where a rung's behavior is held now.
- **The webview host boundary is where consumer bugs live, and the in-repo harness cannot see it.**
  Three integration finds were invisible to any Chromium-driven battery: clipboard events
  retargeting to `document.body` off a caret-less endpoint, the host webview's built-in
  accelerator keys consuming chords before the page, and the image-src scheme policy meeting
  a real host protocol. The consumer guide's webview-host section is the documented half.
  Direction: post-1.0 a minimal **Tauri example consumer** joins `examples/` (possibly in this
  repo), so this class gets exercised by a gate rather than discovered by a user, which is the
  expensive way to find out. Validator: each
  webview find of the next integration lands as a row in that example's checklist, not a
  surprise. Cross-platform webview coverage rides the same item (owner, 2026-08-14): WebKitGTK
  is reachable from Linux CI or WSL, and a macOS/WKWebView lane needs a real or virtualized
  macOS runner; both are future gates, not pre-1.0 work. Contenteditable is the most
  engine-divergent API the editor sits on, and the ledger still carries a Safari-shaped watch
  (#37) that only Apple hardware can close. The per-release Playwright-WebKit lane
  (`docs/contributing/testing.md` § The WebKit lane) is the closest available proxy and prices
  part of that gap, but a green lane is weaker evidence than its pass count suggests, so #37
  stays open until a real WKWebView runs the suite.
- **Singletons earn their keep only until the second claimant arrives.** The process-global
  reveal anchor produced two consumer-visible defects, the interaction trace interleaves
  instances by design, and the reveal mount-waiter registry had to move off its bare-index
  process-global key. Standing direction for anything new: a process-global slot is a
  deliberate choice with a written second-claimant story, not a default.
- **Every gesture that places a caret is a data-loss candidate until proven otherwise.** The
  precondition no suite had ever built (a live cross-block range sitting there before a
  caret-placing gesture) was hiding two whole-document losses. G2.12 fails new pointer gestures
  at birth, but its
  perimeter is pointer-only by design and a caret can land through doors it cannot see at all
  (the navigation API is the shipped example), so a new caret-placing door joins the simulation's
  range-interrupt family by hand or goes unprobed.

### The two plugin systems

There will be two of them, and the boundary has to be stated out loud, or every reviewer reads the
app half as a hole in the editor half.

| Layer                 | Owns                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **aragonite plugins** | Anything that touches the document or the editing surface: kinds, grammar, decorations, commands over the document, presentation |
| **limestone plugins** | Anything that touches the app: ribbon, sidebar, status bar, settings tabs, modals, the command palette UI, the vault, sync       |

Thirteen of Obsidian's top twenty-five plugins are app-shell, and Obsidian only conflates the two
because it _is_ the app. An editor library that grows a ribbon API has lost the fucking plot.
Vault-wide indexing (Dataview's `FullIndex`, Omnisearch) is limestone's too: `getEvents()` plus
`parse()` is the right raw material, and the editor supplies the material, never the index.

_So the line is just "editor = view"?_ It is not. _Single-document_ derived state (a table of
contents, footnote numbering, tasks in this note) is the editor's, because it is a function of the
one document the editor owns. That is why the editor hands a block component its document.

### Pre-freeze plugin direction decisions

Convergent capabilities the field survey (`docs/research/plugin-extension-surfaces.md`) flagged as
answered-by-omission rather than by decision, which is the polite phrasing of "nobody had actually
decided them". All are **additive-later** by the freeze criterion and none _must_ ship before the
freeze, so each entry below is _direction + validator_, not _build-now_:

- **Plugin-local state.** Settled and permanent, so it lives with the other exclusions in
  `plugin-contract.md` § Explicitly excluded rather than here.
- **Normalize-on-commit / veto seam** (ProseMirror `appendTransaction`/`filterTransaction`). The
  highest-leverage lever for plugin _quality_ there is: derived content, linked edits, auto-fix,
  structural guards. **Decided: yes, post-1.0.** No pre-freeze dogfood driver needs it, and the
  ceremony is internal (plugins never bind its shape), so the hook stays additive. The direction
  is fixed now so 1.0 doesn't foreclose it; the freeze cut's commit-seam litmus guards it; it is
  designed-ahead in `plugin-contract.md` § Target shapes. Invariant enforcement stays
  editor-owned, because this augments a commit, it does not bypass the invariants.
- **First-class plugin paste.** The content-keyed half **shipped pre-1.0 as
  `registerPasteTransform`**: pasted text runs through named, install-ordered transforms before the
  parse, and the GitHub-alert → admonition driver rides it. The document-rewrite pattern
  (`getSource()` → transform → `source` re-sync) stays the consumer-side answer for whole-document
  migration. Why `registerPasteSurface` itself stays internal is in `plugin-contract.md`
  § Explicitly excluded.
- **Generic `:::name` directive primitive** (remark-directive), **shipped 0.9.11**: one opener owning
  all `:::`/`::`/`:` syntax, dispatch by name, three tiers, a lossless generic fallback, and a public
  `activateDirectives()`. Byte-losslessness is confirmed (adversarial round-trip property), so the one
  remaining decision is the **1.0-vs-1.2 freeze cut**, meaning whether the directive surface freezes
  at 1.0. That gets taken at the freeze against the clean-room build's discoverability findings
  (shipped 0.9.12, and that build needed no directive reach-ins; its findings were doc gaps, all
  fixed in-flight). The per-kind opener stays the general escape hatch.
- **Built-in override / replacement** (Obsidian's codeblock processors; ProseMirror schema
  swaps). Two shapes that must not be conflated, so they get decided separately. **Single-slot
  subsystem overrides are consumer seams, not plugin registries**: one implementation per concern,
  chosen by the embedding app, behind an interface the editor owns and the ceremony still polices.
  The history module is the first (§ Downstream boundary), and each such seam is designed bespoke
  against its first real alternative implementation, never as a generic module-swap framework.
  **Registry-level replacement of a built-in kind's component or descriptor stays excluded at
  1.0** (Plugin System II, `plugin-contract.md` § Explicitly excluded): registries are
  process-global, so an override is global and last-writer-wins, which is the collision tax every
  surveyed ecosystem has already paid once. The supported replacement path is **grammar-level**: a
  plugin kind claims the syntax ahead of the built-in on the opener priority ladder (the mermaid
  precedent, uninstall-safe by decline), owns its own closure-matrix row, and, with the conformance
  battery (0.9.24), proves it by enrollment. An executable code block is this pattern verbatim:
  claim the fence, render the run surface, keep the bytes. If post-1.0 demand shows genuine need
  for in-place replacement, Plugin System II is its home, once the battery exists to make "you
  own what you replace" checkable.
- **GitHub's rendered extras that aragonite keeps literal.** Inline HTML as live widgets
  (`<kbd>`, `<sub>`, `<sup>`, `<ins>`) and the diagram fences past mermaid (geoJSON, topoJSON,
  STL). **Decided: neither pre-1.0** (owner, at the 2026-07 GitHub-parity run). Both are
  plugin-shaped on surfaces that already ship, so deferring forecloses nothing. A curated tag
  set is a prefix rung on the reserved `<` trigger rendering an atomic widget over unchanged
  bytes (the entity-reference mold); the whole design question is the curation, meaning which tags
  earn a widget, with the answer for every other tag staying "render as literal source", which
  is also its uninstall story. A diagram fence is a fence claim on the mermaid precedent,
  priced ahead of `fencedCode` and declining every info string it does not own; those
  additionally drag heavy render engines for a fairly niche audience, which is why they sit as
  post-1.0 candidates rather than pre-freeze work.
- **Heading-anchor `#fragment` navigation** (GitHub/Obsidian in-note links), meaning a `[jump](#deep-heading)`
  prose link scrolling to the matching heading. **Decided: deferred, additive-later** (assessed at
  toc v2, 0.9.35). The heading half is cheap and well within reach: a pure `slugify` over the same
  `heading-outline` walk, applying GitHub's rule (lowercase, drop all but word chars / spaces /
  hyphens, spaces → `-`), then deduping collisions with `-1`, `-2`… in document order, which yields
  a `slug → path` map. The blocker is the **resolution seam**: aragonite has no inline-link-click
  hook, and in a contenteditable a plain click on a link places the caret (editing), so intercepting
  it to navigate needs a new editor-level convention (a modifier-click, or a rendered-link
  activation seam) plus DOM identification of the link's fragment. That is cross-cutting
  inline-render / pointer work well past a toc-local ~150-line budget, plus a
  which-gesture-navigates-vs-edits UX decision the toc plugin has no business making alone.
  Direction: when built, the slug utility ships on the plugin barrel beside `headingLevel`, and
  resolution rides whatever inline-link-activation seam the editor grows, reading the one
  `heading-outline` walk. No pre-freeze driver forces it.

**Standing posture, the enforcement ladder: unrepresentable > guarded > documented.** Every
load-bearing contract climbs as high as it can: prefer types/seams that make the violation
inexpressible; where types can't reach, a dev guard that fails at the gate; prose only for what
neither can hold. Two habits keep the ladder honest: every bug fix records a one-line miss-analysis
("what test should have caught this, and why didn't it") in its regression test's requirement file, and every
new feature class adds a simulation gesture so the corruption oracle's coverage tracks the product's
surface. The complexity here is essential, so cap the downside rather than pretending it can be simplified away.

## Post-1.0 sketch

All of it subject to reconsideration once v1 actually ships.

### 1.1 — Shell integration

The editor inside a real app shell, which is where focus and navigation semantics finally get
concrete. Settles what only an integrated surface can settle:

- **The per-block a11y naming model.** Editable blocks carry `role=textbox` with no accessible
  name, and the focusable `role=separator` on a thematic break reads as a slider to axe. Both are
  ledgered axe exemptions today, both fall out of the editor-root a11y structure, and both want
  a real shell to decide against.
- **The accent palette vs. WCAG AA.** `--color-accent` is below AA on both the editor and code
  backgrounds at full opacity, so it fails contrast wherever it lands (link text, the code-fence
  language label). Markers were fixed by raising their dim; the accent needs a lighter value, and
  that is a brand decision, not a code one.
- **Token-role audit.** One deliberate pass over the whole token set, asking the same of every
  token: one visual role, both modes answered, the right tier (host-chrome vs editor-owned), and a
  stated reason for any exception. The two classes the first integration found (a token painting
  two roles at once, a chrome token blind to the mode) were each fixed where they were spotted,
  and never swept for.

_(Presentation modes shipped pre-1.0 in 0.9.26.)_

### 1.2 — Plugin DX + deferred generalizations

The plugin _authoring_ API ships at 1.0. 1.2 is the developer experience that makes the Svelte/TypeScript plugin thesis real, plus the generalizations deferred until more consumers exist:

- **DX system:** plugin scaffold, hot-reload dev loop, in-repo reference-plugin fleet (each exercising a different extension shape: callout, KaTeX, export command, image gallery, smart-HTML-paste), plugin docs site, plugin DX test suite, plus a declarative-manifest overload on the shipped `definePlugin` unit if a consumer wants one.
- **Unified command registry + palette.** Migrate built-in block commands off `component.runCommand` onto the `(kind,id)` registry so dispatch has one home (the CodeMirror/ProseMirror model, where a command is a function of a context rather than a method on the view); a command palette then enumerates the registry. Ships on the command-mint foundation (0.9.7) and the pre-1.0 global-command mint; `KeybindingOverride.kind` already spans plugin kinds (0.9.16). Mermaid v2, its plugin-owned textarea edit mode rebuilt on the shipped editable-leaf surface, is the recipe upgrade to fold in here when wanted.
- **Selection coordinate-addressing hooks.** Retire the selection layer's `kind === 'table'` gates (and the chrome×table composition) into descriptor hooks dispatched by presence, mirroring the `foreignDragHitTest` / `caretTargetAtPoint` precedent (two hooks now, and their split _is_ the pattern: one answers the exact hit a drag needs, the other the nearest target a caret gesture needs). The _public rect API_ half pulled forward to pre-1.0 (the decoration tier bottlenecks on it); what remains here is retiring the internal kind gates.
- **Trigger-character suggest seam.** A `/` menu, `@`-mentions, `[[`-completion. Table stakes for a notes app, and the class Obsidian carries with `registerEditorSuggest`. Deferred deliberately: the pre-1.0 rect API already makes a suggest popup _consumer_-buildable (caret geometry plus `getSelection()`), so the question 1.2 answers is whether it deserves a first-class editor seam or stays a consumer pattern. Decide that against a real consumer, not on paper.
- **Render-primary authoring gaps.** Both recorded walls shipped pre-1.0 (whole-block focus at 0.9.18; the command→component channel in the pre-1.0 hardening program). What remains here is second-round refinement against post-1.0 consumer feedback.
- **The math render seam still carries no theme term.** The mermaid renderer took one pre-1.0 (a theme in its render context, a theme-keyed memo, a redraw on flip); the injected `MathRenderer` did not, and its memo key has no theme term either. Latent rather than live: the shipped KaTeX adapter emits CSS-styled markup that inherits the editor's colors, where a drawn diagram carries its own. An injected engine emitting color literals would repeat the mermaid case exactly. Direction: when a second engine asks, the math seam takes the shape the mermaid one already has rather than a second design nobody needed.
- **Per-rung editing policy for a borrowed built-in kind.** A rung that mints a built-in kind can re-serialize its own bytes (`rewriteImage`) but cannot give its own instances an editing behavior distinct from the built-in's. The caret-edge dispatch resolves policy by kind, so an Obsidian-style `![[embed]]` minted as an `image` necessarily edits like a GFM image: same edge policy, same delete granularity, same selected-key handling. The only lever today is `augmentInlineWidgetKind('image', …)`, which changes behavior for **every** image in the document, including the ones the plugin never claimed. Direction: a claim-keyed policy lookup layered over the kind-keyed one (consult the node's syntax claim first, fall back to the kind), which preserves both key spaces instead of merging them, and is additive rather than breaking. Deliberately not taken pre-1.0: no consumer has asked, the layering is straightforward whenever one does, and the merged-facet alternative would break the built-in widget kinds (which carry policies and have no rung at all) to arrive at the same place.

### 1.3 — Beyond-GFM (as plugins)

This milestone's scope is closed. Every beyond-GFM extension it named shipped pre-1.0 as a plugin, and the changelog holds the record. What stays deliberately out is GitHub.com's repo-context sugar (issue and PR refs, `@`-mentions, cross-repo `user/repo#123`), which resolves against a repo or vault the editor does not own, and therefore belongs to the consumer rather than to the library.

### 1.4 — Git-native integration (likely a first-party plugin)

History view, inline markdown diff, three-way merge UI for markdown conflicts, commit-from-editor, branch-aware editing.

### 2.0+ — Platform-level

Canvas/spatial view, graph view, dataview-shape queries, executable code blocks, notebook
environments. Platform ambitions, all of which live with consumers and their repos; the editor's
role is supplying the plugin surfaces they need, shipped as 1.x minors (breaking → 2.0).

### Structural directions — from the live-mode hardening (unscheduled)

Where live mode's complexity actually arrives, and the consolidations that cap it. Minted from
the 2026-08 arcs. Each is a direction rather than a promise, and none is freeze-bound, since it
is all internal machinery.

- **A non-fence open absorber declines the terminator mint silently.** The #180 discriminator
  correctly identifies today's absorbing class as exactly the fence family, whose closer is
  derivable; a future grammar whose open absorber has no derivable terminator would fall back
  to the fold with no mint and no warn. Revisit when such a kind exists; the probe's seam is
  where the answer lands.

## Downstream boundary

Consumer-owned work (shell integration, sync, collaboration, app features) lives in consumer
repos and on their own roadmaps, not here. One standing editor-side commitment: additive API
needs surfaced by consumers ship as 1.x minors, and breaking changes ride a major.

The overridable-history-seam direction this section once carried is dissolved (owner +
consumer, 2026-08-14): cloud sync and limestone's history need only the serialized markdown,
which aragonite's serializer answers fast, so no history-module replacement is planned for the
coming two quarters. Collaboration sits half a year to a year out by the consumer's own
estimate; its representation spike is designed when it nears, jointly, and until then the
history-seam freeze litmus above is what keeps that future additive.

The host-scrollport windowing item this section once carried shipped in 0.10.0 (the
single-editor scrollport; `docs/design/virtual-rendering.md` is the spec). The
N-editors-one-scrollport coordinator was dropped, not deferred, when the consumer's shape
resolved to one mounted editor everywhere (2026-08-14). It comes back only if a continuous
multi-day surface ever materializes.
