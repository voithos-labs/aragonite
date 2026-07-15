# Editor Plugin Contract

## What this document is

At 1.0, aragonite becomes a plugin platform and its plugin API stops moving. This document is the list of what stops moving — plus what is still soft, and what was left out on purpose.

It is not a tutorial. `docs/guide/plugin-guide.md` teaches you how to write a plugin; this tells you what you can safely build on.

One idea drives all of it: **structure is cheapest to fix before external code binds to it.** The moment a third-party plugin imports a type or relies on a behavior, changing that type or behavior breaks the plugin. So the shapes plugins bind to get settled first, and everything downstream binds to a foundation that has stopped moving instead of one that hasn't.

## Two freeze layers

The contract freezes in two stages, because the two halves matured at different times.

| Layer                 | What's in it                                                                                                                                                                                                                        | Frozen                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Registration base** | Node identity (`AnyBlockKind`), the register-once/conflict-on-duplicate registry model, plugin-kind naming (`declarePluginKind`), the no-node-field inline-content shape (a kind declares `supportsInline`), the `getEvents()` seam | **Since 0.8.3.** No breaking change from here |
| **Authoring surface** | Everything on the `aragonite/plugin` subpath: the container and editable-leaf factories, chrome leaves, directives, inline authoring, commands, paste transforms (see § The pre-freeze authoring surface)                           | **At the public 1.0 release** — not before    |

The authoring surface stays unstable-labeled until the release cut. It freezes only once it has been validated by at least two real container consumers, the in-repo dogfood extensions, and an internal limestone integration. Until then it may change without notice — nothing external binds to it yet.

The rest of the DX system — declarative manifest, scaffold, hot-reload dev loop, packaged reference fleet — stays 1.2 (see the roadmap).

## The freeze criterion

A surface belongs in the freeze if, and only if, **changing it later would force a breaking change on external code that has bound to it.**

| Verdict                  | Rule                                                                                    | Action                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Breaking-if-deferred** | A later change breaks bound external code                                               | Finalize now, even with no consumer yet                                                               |
| **Additive-later**       | A later change only _adds_ (new field on a payload consumers receive, new optional API) | No freeze pressure — safe to change later; **whether to build it now is a separate call** (see below) |

The distinction is sharper than "does it have a consumer today." A required field added to an event payload, for instance, never breaks a _receiver_ — so an event-payload extension is additive-later even though it sounds like a contract change.

### Freeze-scope is not build-scope

"Additive-later" answers one question — _must this be frozen now?_ → **no.** It does **not** answer _should this be built now?_ Those are separate axes; collapsing them into a flat "defer" is a trap (it under-scoped a batch once — a surface read as "don't build" when it was only "need not freeze").

Deciding whether to build an additive-later surface pre-freeze:

- **Build now** when it rides machinery already being built (marginal cost), **or** a dogfood/in-repo consumer can validate the _mechanism_ pre-freeze. "A shape with no consumer can't be validated" has an escape hatch — writing a dogfood consumer _is_ the validation, which is what the dogfood plugins exist for.
- **Defer** when neither holds and building it would expose a _bound shape you would only be guessing at_ — the `EditEvent` snapshot/real-delta discriminant is the canonical case: its semantic needs its real post-v1 consumer.

The rule both branches serve: **get the shapes plugins _bind to_ exact before freeze; keep _additive capability surfaces_ minimal, so later growth stays an _add_, never a _restructure_.** Adding a field to a payload or context a consumer receives is safe; changing a signature or shape they bind to is the breaking restructure.

## Decision table

> The durable content is the verdict column — breaking-if-deferred versus additive-later, the 0.8.3 scoping logic. The status column reads current: where each surface actually landed.

| Surface                                                                  | Verdict              | In the freeze?                                                                        | Reason                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CstNode.kind` widening to `AnyBlockKind`                                | breaking-if-deferred | **Yes — implemented**                                                                 | A closed `switch (node.kind)` in external code goes non-exhaustive the moment a plugin kind appears                                                                                                             |
| Registry model: global, register-once, conflict-on-duplicate             | breaking-if-deferred | **Yes — implemented**                                                                 | Flipping silent-override → conflict after plugins bind changes observable behavior they relied on                                                                                                               |
| Plugin-kind naming + collision rules (`declarePluginKind`)               | breaking-if-deferred | **Yes — implemented**                                                                 | The collision contract is what a plugin's kind name binds to                                                                                                                                                    |
| Events access seam (`getEvents()` + `EditorContext.events`)              | additive-later       | **Both paths shipped**                                                                | `getEvents()` is the consumer canonical; `EditorContext.events` is the plugin subscribe-only view (`Pick<…,'on'>`) — an additive second path, exactly as the additive-later verdict allowed                     |
| `EditEvent` / `EditorError` payload shapes                               | additive-later       | Bound as-is; extensible                                                               | New fields/origins never break a _receiver_                                                                                                                                                                     |
| Plugin manifest / `plugins` prop                                         | additive-later       | **Unit + prop + per-instance options shipped pre-1.0; manifest stays 1.2**            | The prop's element type is now the `EditorPluginEntry` union (`plugin \| { plugin, options }`) — an additive widening; the declarative manifest overload still awaits the 1.2 reference plugins to validate     |
| Plugin-op vocabulary extension                                           | additive-later       | Sketched                                                                              | No plugin ops exist; extension mechanism is additive                                                                                                                                                            |
| `EditEvent` snapshot/real-delta discriminant                             | additive-later       | **Deferred**                                                                          | Its binding consumer (persistent version history) is post-v1 app-infra, and its semantic must be designed _with_ that consumer (see Deferred)                                                                   |
| Inline-parser _stage_ hook                                               | n/a                  | **Excluded**                                                                          | A parse-pipeline stage, distinct from the shipped `registerInlineSyntax` scanner hook (see Explicitly excluded)                                                                                                 |
| Selection coordinate-addressing / inline-widget / component-portal seams | additive-later       | **Inline-widget + component-portal shipped pre-1.0; coordinate-addressing stays 1.2** | Per-hook seams built against this foundation; additive                                                                                                                                                          |
| Runtime unregister / replace                                             | n/a                  | **Excluded (Plugin System II)**                                                       | The static-registry model has no runtime unload                                                                                                                                                                 |
| Lazy `inlineContent` (contract narrowing)                                | breaking-if-deferred | **Yes — implemented**                                                                 | Dropping the `inlineContent` field from `CstNode` removes a public-type member; a plugin binds inline content by declaring `supportsInline`, not by reading a node field — narrowed while cheap, before binding |

## The frozen foundation

### Node identity — `AnyBlockKind`

A block's kind is `AnyBlockKind = BlockKind | PluginBlockKind`. `BlockKind` stays the closed union of built-ins; `PluginBlockKind` is a branded string minted by `declarePluginKind`. `CstNode.kind` is `AnyBlockKind`, so a plugin-kind node is a first-class CST citizen that flows through render, measurement, and serialization.

`BLOCK_KIND_TABLE` remains the built-in completeness enforcer (a `Record<BlockKind, true>` the compiler checks); `isBuiltinBlockKind` is the runtime discriminant that narrows `AnyBlockKind` back to `BlockKind`. Code that must exhaustively handle built-ins keeps switching over `BlockKind` after that narrowing; code that dispatches by registry lookup keys on `AnyBlockKind` and tolerates unknown kinds.

**Unknown-kind rule:** any exhaustive `switch` over kind needs a default arm that degrades safely — the height oracle estimates an unknown kind as prose, serialization round-trips it via `raw`, and a kind with no registered component renders a visible raw fallback.

A **descriptor** is different: it is required infrastructure (`getBlockKindDescriptor` is read throughout — merge rules, container rebuild, selection), so a descriptor-less kind throws at first use, a render-path throw contained by the per-block error boundary as a failed-block fallback. Built-in descriptor completeness is bootstrap-checked (G1.2 over the closed union). Plugin descriptors are **partly** checked: a plugin kind that registers an opener (G1.10) or declares `reservedChrome` (G1.18) fails bootstrap if its descriptor is missing. A plugin kind with neither — a kind reachable only by direct construction — is not validated; a full plugin-lifecycle check is a 1.2 concern.

### Node shape — inline content is not a node field

`CstNode` carries no `inlineContent` field. A prose node's inline tree is derived from `raw`: the render path computes it locally, and the editor's non-render internals read it through an internal, non-reactive accessor — not a surface a plugin calls. What a plugin binds to is a single descriptor flag: an inline-bearing kind declares `supportsInline` and gets lazy inline for free, with no node-field cache to assume.

This narrows the frozen contract — `inlineContent` was a public member of the node type. It is done now by the freeze's own criterion: a derived-cache field leaking into the node shape is exactly the thing to remove while it is still cheap. After binding the removal would be breaking; before binding it is free.

### Schema registries — global, register-once, conflict-on-duplicate

The block grammar is a set of **process-global** registries — block-kind descriptors, block components, block openers, global commands (in `schema/`), and per-kind paste surfaces (in `tree-operations/`) — each keyed by `AnyBlockKind` (or command id). This is the `customElements` model: a kind is a _definition_ every editor instance in the process shares, exactly as `customElements.define` defines an element for every document.

```
Registration model
┌─────────────────────────────────────────────┐
│  Definitions (kinds, components, openers,   │  ← process-global, register-once
│  commands)  =  CODE                         │
├─────────────────────────────────────────────┤
│  State (selection, undo, render caches,     │  ← per editor instance
│  broken-url cache)  =  STATE                │
└─────────────────────────────────────────────┘
```

- **Register-once.** Registering a kind that is already registered is a **conflict** — it throws — not a silent override. A plugin colliding with a built-in (or another plugin) is a loud, immediate error instead of last-writer-wins corruption. It also makes the code match what `docs/guide/consumer-guide.md` already promises.
- **Augmentation is distinct from registration.** `augmentBlockKind` merges fields into an _existing_ registration (the top-of-DAG wire-up uses it to patch in behavior that can't live in the schema layer without a downstream import). Augmenting an unregistered kind throws. Augmentation is deliberate and idempotent-by-intent; registration is once.
- **No unregister, no replace.** A static registry has no runtime unload. Runtime plugin loading/unloading with sandboxing is Plugin System II, explicitly out of this contract.
- **A global opener means global syntax recognition.** A plugin that registers a block opener teaches the _parser_ to recognize that syntax process-wide — so a second editor in the process parses plugin blocks even if its consumer did not pass the plugin. This is the chosen consequence of definitions-are-global (per-instance _enablement_, if ever needed, is the policy layer above), not a latent surprise.
- **Reset is a test affordance; HMR needs a reload.** Because registration throws on duplicate, any path that re-registers would otherwise throw. For tests, `__resetSchemaRegistriesForTests()` clears every _non-built-in_ schema registration (built-ins survive, so tests that mint plugin/test kinds isolate without losing the grammar); the paste-surface registry, living in `tree-operations/`, keeps its own full-clear reset. For dev HMR, a registration module cannot be hot-swapped in place under register-once — editing one requires a page reload (a deliberate, dev-only consequence; the modules carry no HMR-accept magic). The per-registry resets stay internal; the one sanctioned public seam is the `aragonite/testing` subpath's `resetPluginPlatformForTests()`, which aggregates them so a third-party plugin's own test suite can re-install between cases, and throws outside a detected test environment.

**Why global, given the per-instance `plugins` prop?** The tension resolves cleanly: kind _definitions_ are global because, like custom elements, a kind cannot be defined differently for two editors in one process. The `plugins` prop is a registration _trigger and declaration of intent_ — passing the same plugin to two editors registers once. If per-instance _enablement_ (editor A renders callouts, editor B does not) is ever needed, that is a per-instance policy layer over the global definitions, not per-instance registration. It is not built now (no demand — YAGNI).

### Plugin-kind naming + collision rules

`declarePluginKind(name)` is the single mint point for a `PluginBlockKind`. It enforces the name pattern and rejects collisions with **built-in kinds**, **previously-declared plugin kinds**, and **reserved structural sentinels** — currently `document`, the CST-root discriminant. The brand keeps `BlockKind` switches exhaustive over built-ins while letting the registries key plugin kinds. Plugin-vs-plugin collision detection requires a record of declared plugin kinds — minted names are tracked, so a second `declarePluginKind` with the same name throws.

The `document` reservation matters less than it looks: node-vs-document narrowing is structural (`'raw' in node`), so a plugin kind named `document` would not corrupt the tree. Reserving it keeps the contract unsurprising and the sentinel unambiguous.

### Events access seam — `getEvents()` canonical

The editor's event surface (`edit`, `selectionChange`, `error`) has two sanctioned access paths, one per audience. A **consumer** reaches the full surface through the component method `getEvents()` (via `bind:this`); `on(event, handler)` returns a disposer. A **plugin** reaches it through `EditorContext.events`, the subscribe-only view (`Pick<EditorEvents, 'on'>` — `on` only, no `emit`) handed to an `onEditor` callback, a global-command handler, or a block command's `ctx.editor`. The narrowing is deliberate: plugin-visible `emit` would freeze at 1.0, so the plugin path exposes subscription and nothing more. The internal `setContext` wiring that hands the same emitter to child components is not part of the contract.

## The pre-freeze authoring surface (1.0)

Everything a plugin author reaches today comes through the `aragonite/plugin` subpath. This section is the inventory of what freezes at the release cut.

### Plugin unit + `plugins` prop

`definePlugin({ name, setup })` packages a plugin's global registrations into one installable unit; the editor's set-once `plugins` prop installs each once per process, before the instance's first parse. `installPlugins` on the main barrel is the editor-less entry for `parse()` pipelines; `isPluginInstalled` probes an install. `definePluginBlock` is the single-block shorthand — one kind, one component, one register step — for the common case that needn't touch `definePlugin` and `registerBlockComponent` directly.

The decided shape is an **imperative `setup(ctx)`** unit; a declarative manifest stays **additive-later** (a `definePlugin` overload, not a restructure). Install is once-per-process keyed by name: same-identity re-install no-ops, same-name/different-identity is first-wins with a dev-warn, a setup that throws stays failed. Kind declarations made during a setup are attributed to their plugin, so a duplicate-registration error names the first declarer. All four dogfood extensions and the consumer examples install through it.

**The per-instance context spine.** `setup` receives a `PluginSetupContext`; its `ctx.onEditor(cb)` registers a callback fired once per `<Editor>` instance, receiving an **`EditorContext`** — instance identity (`editorId`, stable per mount), a live `document` getter, the subscribe-only `events` view, and typed `options`. The callback may return a disposer, run at unmount. This is what makes derived state, edit reaction, and per-instance configuration possible without a plugin-state field: a plugin keys its own `Map` on `editorId`. `definePlugin<Options>` carries the option type through to `editor.options`. Registration is **synchronous-only** — a context leaked past `setup` throws, the same boundary as kind attribution.

**Per-instance options** ride the `plugins` prop's `EditorPluginEntry` element type (`plugin | { plugin, options }`), so two editors sharing one process-global registration can still run different options — the split-pane case. A plugin factory's own argument stays correct only for a process-global dependency (a render engine); anything two instances would vary belongs in the prop entry, read through `editor.options`.

_Freeze litmus._ The unit's frozen shape must leave additive room for (a) a per-instance _enablement_ policy layer over the global definitions, (b) lazy/deferred setup, and (c) a declarative-manifest overload — none needed by a pre-freeze consumer, all additive. Two boundaries are load-bearing. The ambient marker that attributes a setup's kind declarations to its plugin is **synchronous-only by design** — a future async or lazy setup path must thread the owning plugin explicitly rather than widen the ambient mechanism. And the **one-context-object litmus is satisfied by construction**: the `EditorContext` an `onEditor` callback receives, a `registerGlobalCommand` handler receives, and a block command reads through `ctx.editor` are one type with one shape — the platform never ships two context objects to reconcile.

### Registration base (frozen)

Kind declaration (plus `declaredPluginKind`, the checked accessor that recovers a declared brand in another module without a cast); descriptor, component, and opener registration; `defineBlockComponent`, which types a Svelte component as a `BlockComponent` without an `as unknown as` cast; idempotent-registration probes for all three registries; and typed per-node plugin metadata (`setPluginMetadata` / `getPluginMetadata`), which stores a plugin kind's own shape without casting through the built-in metadata union.

### Parse + serialize helpers

The recognizer and serializer halves an opener and a `rebuildRaw` need, promoted off `core/` deep paths so the packaged artifact carries them:

- `parse` — body → `Document`.
- `serializeChildren` — join child bytes back.
- `trimTrailingLineEnding` — CRLF-correct display text.
- `normalizeLineEndings` — normalize external text to LF before it enters the tree, so Windows clipboards don't leak CRLF into notes.
- `ParsedLine` — the line shape an opener reads off `ctx.lines` (raw bytes, text, line ending, offsets).

### Fence grammar (pre-freeze)

`matchFenceOpen` / `matchFenceClose` and the `FenceOpen` shape: the built-in CommonMark fence recognizers, exposed so a plugin claiming a fence (` ```mermaid `) never reimplements the fence rules. `matchFenceOpen` returns the opener's verbatim indent and info bytes — the bytes a byte-exact `rebuildRaw` has to replay — and `matchFenceClose` tests a candidate closer against that opener. Recorded as an authoring wall before it existed: every fence-claiming plugin was rewriting the same rules, subtly wrong.

### Renderer + opener utilities

- `createBoundedMemo` — a bounded LRU memo for a renderer's per-source work. Sync (with an optional clone-on-read for live DOM) or async (the value is the render promise, so in-flight work is shared and a rejection caches).
- `OPENER_PRIORITIES` — the published built-in priority ladder a plugin opener prices its own placement against. An offset from a named built-in, never a bare integer.

### Container authoring

`createContainerBlock` wires a nested-`BlockList` container (list state, ancestor contexts, nested actions, windowing, the `BlockComponent` surface) so a plugin container is as thin as the built-in blockquote. It returns a `ContainerBlockComponent` — the container methods it always supplies typed as required, so a host re-exports them with no per-member assertion — plus the props for the `BlockList` component itself, which is on the barrel because the plugin's own markup mounts it. `BlockComponentProps` names the props BlockHost passes every component.

### Editable chrome

One `registerChromeLeaf` call binds a container's title/summary leaf with a default keymap (Enter descends to the body; chord-keyed overrides). The container _declares_ its chrome slot on its descriptor, and the machinery enforces the **reserved-chrome contract**: the slot is always present, single-line (unsplittable; paste flattens inline), cleared — never node-deleted — by destructive ranges, and kind-stable through every edit. `chromeChild` mints that reserved child-0 node (the title text plus its trailing newline) for an opener building the container.

### Collapsible containers

The declaration optionally carries a pure collapse probe (`isCollapsed` over the node). From that one declaration, every child-adjacency operation — merge from below, focus walks in and out, Enter-descend, reveal — is collapse-aware; the container factory derives its window clamp from the same probe (the body genuinely unmounts, so there is no separate collapse dep to thread); and the height oracle estimates a collapsed container at one chrome row. `isCollapsedContainer` reads that probe off the descriptor, so a component's own disclosure UI and the model-layer walks share one definition. The factory also returns a metadata-commit handle (`updateOwnMetadata`) for behavioral fields like a collapsible's open state — merged, raw-rebuilt, and undoable in one commit.

### Editable-leaf authoring

`createEditableLeaf` is the container factory's sibling for leaves: getter deps (`node`/`index`/`path` + `getEl()`), its own context reads, and a returned surface the component re-exports as one-liners. Two modes: `plain` (always-editable, per-keystroke commits, prose undo batching, factory-owned view sync) and `render-primary` (component-owned render↔source swap; the reveal→edit→blur cycle commits as one undo entry). Commits land through the block-edit ladder, so multi-block text structurally re-splits at the shared choke point. `StickyColumnDirection` (`'above' | 'below'`) is on the barrel because a leaf's `focusAtColumn` receives it — it says which side the caret arrived from. Block math is the render-primary validator; the `%%` memo harness kind is the plain validator.

### Supporting descriptor fields

Context-dependent kinds (no standalone recognizer — kept through edits); an opaque container contract (raw is authoritative, not a strip decomposition); and whole-block focus (`blockFocus: 'whole-block'`, opting an opaque childless block into the focus-then-delete model — arrow traversal stops on it, a caret-adjacent Backspace focuses it before a second press deletes, and the merge-fallback twins focus rather than dead-end). All invariant-guarded.

`estimateHeight(node, { width })` is the optional height-oracle hook for windowing: an O(1) per-kind pixel estimate the oracle consults after the collapse probe and before its built-in default, so a kind that renders at a stable size (a Mermaid diagram at its skeleton height) scrolls right before it mounts. The measured cache still supersedes it, and a collapsed container still estimates at one chrome row (`docs/design/virtual-rendering.md`).

### Paste transforms

`registerPasteTransform` records a content-keyed, pre-parse rewrite of pasted plain text: named, register-once (a duplicate throws, attributed to the owning plugin), run in install order at every paste site before the parse. It is **paste-scoped and content-keyed** — distinct from the internal, target-kind-keyed `registerPasteSurface` (which stays unexposed): a transform keys off the clipboard _content_ it recognizes, not the block kind the paste lands in. That is the shape the GitHub-alert → admonition conversion needs, and it validates the 1.2 conversion-config direction a milestone early.

### Inline authoring

The inline mirror of the block surface: an inline-kind mint with an idempotence probe (`declarePluginInlineKind`, `declaredPluginInlineKind`, `isInlineKindDeclared`); an inline-syntax recognition hook (`registerInlineSyntax` — the plugin hands the scanner a trigger character and a recognizer); and an inline-widget editing registry (`registerInlineWidgetKind`, carrying a per-kind `InlineWidgetEditingPolicy` on the `InlineWidgetDescriptor`, plus `InlineWidgetEditingContext` and `InlineSyntaxRecognizer`; `InlineNode` is on the barrel) that gives a plugin inline kind atomic, caret-addressed editing. KaTeX is the validating consumer — the renderer is injected, not bundled.

Three freeze-time decisions ride this surface:

- **Recognition precedence (additive).** The hook fires only for a trigger character no built-in scanner already claims — built-in delimiter dispatch runs first. This limit is part of the hook contract; a precedence-override variant can layer on additively later, without changing the base signature. The limit is **guarded, not merely documented**: registering a recognizer on a claimed trigger (`` ` `` `&` `<` `*` `_` `~` `[` `]` `!` `\` newline) throws at registration, because the scanner would never consult it — a silent no-op is the one failure a public API must not have.
- **Builder injection (resolved).** Three builder paths coexist: the recommended `component` (a Svelte component mounted through the render layer's injected portal builder and kept live across per-keystroke rebuilds by a keyed reuse pool), the stateless registry `buildWidget`, and image's stateful builder on the internal `augmentInlineWidgetKind` seam. The descriptor gained an optional `component` field (mutually exclusive with `buildWidget`) plus the `InlineWidgetComponentProps` shape on the barrel; the internal augment seam stays unexposed. KaTeX inline migrated onto the component path as the validator.
- **Error rendering (additive-later).** No shared error-render seam — each renderer handles its own errors (the KaTeX path renders a legible inline message). Add an optional error-render hook only if a second renderer starts duplicating it.

### Directive authoring

One shared opener owns the `:::`/`::`/`:` fence family and dispatches by name (`registerDirective`, probed by `isDirectiveRegistered`) across three tiers — container, single-line leaf, and atomic inline text — so N plugins never collide on opener priority. A registered name renders through its own first-class kind; an unregistered name round-trips byte-for-byte through a generic fallback, so a document survives its plugin being uninstalled.

The `fromDirective` factory is required for container, optional for leaf, and rejected for text (kind-only), enforced at registration. `parseDirectiveAttributes` is an opt-in, one-way `info → { label, id, classes, properties }` reader over the remark convention — the verbatim opener info stays the round-trip truth. `serializeDirective` writes a fence back losslessly, and `createDirectiveRebuild` builds the `rebuildRaw` for a directive container whose child 0 is an editable title, owning the title→opener mapping, body serialization, and CRLF line-ending threading.

Activation is the explicit idempotent `activateDirectives()` call, not an import side effect: the authoring symbols alone do not claim `:::`. See `docs/guide/directives.md`.

### Command mint

`registerBlockCommand` binds a `(kind, name)` block-command and hands back its id, which a plugin binds in its kind's keymap (`CommandId` names a built-in command a binding can target; `KeyBinding` is the per-kind chord→command shape; `AnyCommandId` spans both). Dispatch reaches the two surfaces that can supply a handler its context — the editable leaf's keymap and the container bubble — and that context carries the mounted component's own view-state handles (`ctx.hooks`, threaded by the container/leaf factories' `commandHooks` getter), so a view-state command drives the live component with no node-keyed side map. It also carries `ctx.editor`, the dispatching instance's `EditorContext`, for document/events/options reads (see § Target shapes for the growth-as-fields pin).

`registerGlobalCommand(name, handler, { chord? })` is the editor-wide sibling: a process-wide command whose handler receives the dispatching instance's `EditorContext` — the same object `onEditor` hands out — so it fires regardless of which block holds focus. An optional chord binds in the **plugin-global tier**, which resolves last (after every consumer override, built-in kind keymap, and built-in global chord); built-in chords and the reserved search chords (`Mod+F` / `Mod+H`) are unstealable, and a collision throws before the command is minted, so a failed registration leaves no orphaned name behind.

A handler throw is contained at the dispatch seam and surfaces as an `error` of origin `command`, attributed to kind (block) or plugin (global), command, and owning plugin. A block command bound on a built-in kind's leaf dead-keys, since those surfaces supply no context.

### The root document, in a component

`BlockComponentProps.document` delivers the read-only root document to every block component at any nesting depth — a component otherwise sees only its own node. A table-of-contents block reads the headings above it through this prop; the `toc` dogfood is the validating consumer, reading it at a nested depth so the delivery is pinned on both of BlockHost's dispatch branches. It is a **read-only** view — single-document derived state is the editor's boundary, and mutation stays a commit-ceremony concern.

### Decorations

The view-only annotation layer — the capability everything that owns no syntax was waiting on (spellcheck, ghost text, inline comments, badges, occurrence highlights). A decoration never enters the CST: a plugin registers a named, per-instance **source** through `EditorContext.decorations` (a consumer through `getDecorations()`), the engine re-runs every source once per document edit, and the results are bucketed by block path for the render layer. A source is **pure over the document plus its own state** — there is no mapped-forward decoration set, because positions are `(path, offset)` into a tree re-derived per edit (the roadmap's plugin-local-state decision). The handle returned by registration carries `invalidate()` — synchronous by contract: the new result is queryable before it returns — and an idempotent `dispose()`. A throwing source is contained: the error surfaces on the `error` channel attributed to the source, and its prior decorations are retained rather than blanked.

Four decoration types, spanning the overlay and in-flow render paths: an inline **mark** (a positioned overlay span carrying the source's class — the same surface search's own highlights ride, since search is now a decoration source of this engine; one ledgered visual nuance: same-cell multi-match dedupe, `docs/issues.md`), a zero-width **widget** island, a range **replace** island (the displaced bytes stay in the document and never leave `getSource()`), and a whole-**block** treatment (class/attrs on the block host plus an optional badge widget). Islands are atomic inline widgets with defined caret, arrow, and destructive-key semantics (see the closure matrix). Two authoring contracts are load-bearing enough to state here as well as in the guide: **widget identity is untracked by render keys** — two specs at the same position with the same class are treated as equal, so a source varies `class` to force a re-render — and **`invalidate()` is synchronous**. Islands render only in prose leaves today; the table-cell surface is a ledgered parity gap (`docs/issues.md`).

Cost contract: an idle source's per-edit re-run is O(sources), never per-block, and a block with no islands pays a byte-identical render key — both perf-suite-pinned.

### Rects

Viewport-space geometry over the rendered document — the read the decoration tier, selection toolbars, and trigger popups all bottleneck on. Reached through `EditorContext.rects` (plugin) and `getRects()` (consumer): a block's bounding box, the rects covering an inline range (per visual line on wrapped prose, per cell on grid surfaces, inheriting each surface's offset semantics — raw offsets on leaves, cell indices on grids, with the end-sentinel meaning "through the last measurable position"), the live native caret (null in cross-block mode, where the parked native range must not leak out as a caret), and a `reveal` that mounts a windowed-out block before measuring it. Rects are real only in a browser, so the surface is e2e-validated; the selection-toolbar demo is the consumer validator. Its single-block case reads the native Range: the selection snapshot collapses a single-block range to the focus caret (ledgered, `docs/issues.md`), and the fix is an additive payload extension — a decided pre-freeze refinement.

## Surfaces bound now, extensible additively

These ship today and are part of what plugins observe. They are frozen _as the current shape_ — but because they are payloads consumers _receive_, new fields and new union members can be added later without breaking a receiver.

- **`EditEvent`** — `{ op, path, detail, timestamp }`, where `op` is the `OperationKind` vocabulary derived from `OperationDetailMap`. Emitted from the commit ceremony (structural ops) and the keystroke-debounce flush (`op: 'input'`).
- **`EditorError`** — `{ origin, error, context? }` with `origin` in `'subscriber' | 'render' | 'commit' | 'command'` and `error: unknown` (correct for a boundary). Routed through the `error` event channel with a recursion guard.

## Editable-content tiers

Every mechanism for plugin content that is _itself editable_ falls in one of four tiers, each bound to a CST guarantee (prior-art record: `docs/research/plugin-extension-surfaces.md`).

| Tier          | Shape                                                                       | Status               |
| ------------- | --------------------------------------------------------------------------- | -------------------- |
| Container     | children are real CST blocks in a nested BlockList — the contentDOM analog  | shipped              |
| Chrome leaf   | a reserved, single-line, plain-text child the container's raw owns          | shipped              |
| Editable leaf | a recognizer-backed standalone text block with native caret/IME/undo parity | shipped (pre-freeze) |
| Atomic widget | opaque non-text embed, caret-addressable at its edges                       | shipped              |

A _general_ editable leaf shipped pre-1.0 as `createEditableLeaf`, pre-freeze beside the container factory; the chrome leaf stays narrower on purpose. **Rejected permanently:** nested-editor interiors (a second editor state serialized as a blob) — they break byte-lossless round-trip.

## The tier × subsystem closure matrix

The standing lesson is the 0.9.18 whole-block-focus incident: the tier shipped **closed under 2 of ~9 cross-cutting systems and leaked 4 holes, found across three fix waves.** A new extension tier meets every editor subsystem whether or not its author considered them, so "it renders and round-trips" is a fraction of done.

**The rule.** Every extension tier — and every new per-kind capability on an existing tier — must define its behavior under each cross-cutting system _before it ships_: it fills its matrix row, a ✓ or a ledgered gap, never a blank. A blank cell is an unasked question, which is exactly how the 0.9.18 holes shipped.

**The row is a type.** The matrix is no longer a doc checklist a reviewer might skip — it is a required `closure` block on every block-kind registration (a `ClosureCell` per `ClosureColumn`: `implemented` with a named `via`, `inherit-default` for the generic ceremony, or `not-supported` with a named `reason`). `Record<ClosureColumn, …>` makes a missing column a compile error and the required field makes a missing block one, so a blank cell can no longer reach the tree. G1.24 cross-checks the cells against the rest of the descriptor — a container's `roundTrip` must name its `rebuildRaw` rather than inherit the default, a `not-mergeable` kind's `mergeBackspace` cannot inherit a default merge it does not have — and validates each declared `conformanceFixture` parses to its kind. What is declared here is now _executed_: registering a kind enrolls it in a generic per-cell behavioral battery — the headless cells (round-trip, merge eligibility, byte-slice clipboard, undo, search degradation) run at registration, and the browser cells (focus, selection and search paint, reorder, the simulation oracle) run in the browser sweep.

The rows are the five interaction-tiers a caret meets; they refine the editable-content tiers above. The block-level **whole-block-focus opaque** tier — a childless opaque block that is its own focus target, e.g. a diagram — is split out from the **inline widget**, the atomic embed inside prose; the editable-content table folds that block-level case under Container.

_Legend: ✓ closed (defined + covered) · n/a structurally absent · ◐ partial (ledgered edge) · gap (ledgered hole)._

| Tier                     | Round-trip | Focus | Merge / backspace | Selection paint | Search paint | Reorder | Undo | Clipboard | Sim oracle |
| ------------------------ | ---------- | ----- | ----------------- | --------------- | ------------ | ------- | ---- | --------- | ---------- |
| Container                | ✓          | ✓     | ✓                 | ✓               | ✓            | ✓       | ✓    | ◐¹        | ✓          |
| Chrome leaf              | ✓          | ✓     | ✓                 | ✓               | ✓            | n/a²    | ✓    | ◐¹        | ✓          |
| Editable leaf            | ✓          | ✓     | ✓                 | ✓               | ✓            | ✓       | ✓    | ✓         | ✓          |
| Whole-block-focus opaque | ✓          | ✓     | ✓                 | ✓               | ◐³           | ✓       | ✓    | ✓         | ✓          |
| Inline widget            | ✓          | ✓     | ✓⁴                | ✓               | ✓            | n/a⁵    | ✓    | ✓         | ✓          |
| Decoration island        | ✓⁶         | ✓     | ✓⁷                | ✓⁸              | ✓            | n/a⁵    | ✓⁷   | ✓⁹        | ◐¹⁰        |
| Block decoration         | ✓⁶         | ✓¹¹   | ✓¹²               | ✓               | n/a¹³        | ✓¹²     | ✓¹²  | ✓⁹        | ◐¹⁰        |

1. **◐ Clipboard.** A cross-block copy whose end lands mid-chrome round-trips the container; one whose _start_ is mid-chrome and extends into the body drops the container wrapper (ledgered, `docs/issues.md`; folded into the post-1.0 clipboard generalization).
2. **n/a Reorder.** A chrome leaf is the container's reserved child 0 — no independent block identity to move.
3. **◐ Search.** A match inside a childless opaque container is found (the block's raw scans as a leaf), painted through the container shim's `measurePartialRects`, and navigable. Replace skips it — the opaque raw is metadata-derived, and a generic substitution would drift from metadata (ledgered, `docs/issues.md`; folded into the post-1.0 opaque-write work).
4. **✓ Merge / backspace.** A caret-edge Backspace/Delete reveals the widget's source or atomically deletes it; block-level merge stays the host prose block's concern.
5. **n/a Reorder.** An inline widget is not a block; reorder is a block-level gesture. A decoration island is the same shape: view-only inline DOM, no block identity.
6. **✓ Round-trip.** Decorations never enter the CST, so byte round-trip holds by construction — the bytes a replace island displaces stay in the document and never leave `getSource()` (property-pinned over arbitrary island placements).
7. **✓ Merge / backspace / undo (island).** A widget island (zero bytes) is transparent — destructive keys act on the adjacent real byte, and at a true block boundary fall through to block merge. A replace island (hidden bytes) is selected whole by an edge press and deleted whole by the second, one CST commit and one undo entry — silently eating one hidden byte would be invisible corruption.
8. **✓ Selection paint.** Sweeps measure and paint through islands normally. Deliberate zero-length case: a widget island spans no bytes, so it is invisible to selection cover rects — correct (nothing is selected), recorded so nobody "fixes" it.
9. **✓ Clipboard.** Excluded by construction: copy yields the raw byte slice, so a range spanning an island copies the real bytes (hidden bytes included), never the decoration DOM.
10. **◐ Sim oracle.** A standing mark source runs the engine under the loaded-ops corruption oracles on every edit; island-editing and block-decoration interaction gestures are scripted-e2e only (ledgered, `docs/issues.md`).
11. **✓ Focus.** The badge widget mounts non-editable as the host's first child and must not capture focus or caret placement — the decorated block stays a fully functional editing surface.
12. **✓ Merge / backspace / reorder / undo (block).** A block decoration is source-derived, keyed by path: after any structural edit or restore, sources re-run against the new tree and the treatment lands wherever the source now points. Cleanup on change and dispose (class, attrs, badge removed) is e2e-pinned.
13. **n/a Search paint.** A block decoration adds no text — class, attrs, and badge carry nothing the document scan can match.

Two capability gaps ride tiers without mapping to a single column, both the same host-surface parity class: **inline-widget reveal-to-edit works in prose but is unwired in table cells**, and **decoration islands render in prose leaves but not in table cells** (◐ — mark and block decorations serve cells today; both ledgered, `docs/issues.md`, sharing one fix direction: the cell surface adopts the prose seam's wire-up).

## What a plugin may and may not do

The boundary, condensed; the invariant catalog (`docs/design/invariants.md`) is the enforcement record.

A plugin **may**: register kinds/components/openers (once — duplicates throw); declare `rebuildRaw` and have the commit ceremony invoke it; build containers and chrome through the factories; store primitive per-node metadata; commit metadata through the sanctioned update path; mint its own block-commands and contribute per-kind keymaps over the command vocabulary; render as an unknown kind and degrade safely.

A plugin **may not**: treat its DOM as authoritative or mutate the tree from the view layer (boundary events flow up; the CST wins); write bytes through node references captured before a commit (copy-on-write); pass reactive CST state by value across module boundaries (getters only); invent merge-role/unwrap/container-contract values (closed enums); silently override a built-in or another plugin's registration.

Most of the boundary is enforced by **shape** (the factories never expose raw context keys or mutation handles) and the rest by **dev-mode invariants** that tree-shake out of production — so plugin development against a production build gets no signal. **Develop plugins against a dev build.**

### Misuse outcomes

What each misuse does in dev versus production — the reason the dev build is where plugin development belongs:

| Misuse                               | Dev                                                                                                                                | Production                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `rebuildRaw` writes the wrong bytes  | commit-time invariant warn (opaque-container staleness / rebuild determinism), naming the kind                                     | silent until the bytes surface in a round-trip      |
| Component throws while rendering     | contained by the per-block error boundary — failed-block fallback plus an `error` event (`origin: 'render'`), attributable by path | same containment (the boundary ships in production) |
| Opener returns a non-advancing index | parse throws, naming the kind, before the loop can spin                                                                            | parse loop spins — the browser tab hangs on load    |
| Opener's `raw` ≠ the consumed lines  | parse dev-warns (`invariant:opener-raw`), naming the kind                                                                          | silent `serialize(parse(x)) !== x` round-trip break |
| Opener throws                        | propagates uncaught — parse runs at editor init and inside the commit ceremony, outside the per-block boundary                     | same — uncaught                                     |

## Target shapes (designed ahead)

Sketched so later work builds toward a known direction. None is frozen: each is additive.

- **Plugin-op vocabulary extension.** A mechanism for a plugin to contribute an `OperationKind` (and its detail type) so its structural edits emit typed `EditEvent`s and participate in `EditorError.context.op`. Additive over `OperationDetailMap`. It is the pre-1.0 command mint's territory but stays deferred within it until a novel-op consumer exists — metadata edits already emit the typed `metadataUpdate`.
- **Error-origin extension.** The `command` origin — a contained plugin block-command throw, attributed to its kind, command id, and owning plugin — has shipped. A `parse` origin and a structured plugin-error shape remain additive-later.
- **`BlockCommandContext` growth-as-fields.** The `editor` field (the dispatching instance's `EditorContext`) has shipped. The roadmap flagged this as the one genuine breaking risk — a bound handler breaks if document mutation later arrives as a _different_ context object. The refinement over that row's "pin the field names now": the shipped decision pins the **growth axis, not speculative names** — further capability (document mutation) arrives as _further fields on `BlockCommandContext`_, never a second context object. No mutation field names are reserved ahead of their consumer; pinning the shape of growth is the contract, guessing the fields is not.
- **Normalize-on-commit / veto seam.** A sanctioned hook for a plugin to veto a commit or append derived mutations atomically within the commit ceremony (ProseMirror `filterTransaction`/`appendTransaction`, CM6 `transactionFilter`). Post-1.0: additive over the ceremony — plugins never bind its internal shape — built when a real consumer validates the hook shape (veto vs append, sync vs async, the owned view it receives). Invariant enforcement stays editor-owned; this augments a commit, it does not bypass the invariants. The 1.0 freeze litmus verifies no frozen surface precludes it (`docs/roadmap.md` § Pre-freeze plugin direction decisions).
- **Decoration vocabulary growth.** The decoration union grows additively: a new decoration type arrives as a **new union member**, a new capability on an existing type as an **optional field** — never a restructure of a shipped member. This is safe because sources _produce_ decorations rather than switch over them; the editor is the only exhaustive consumer, so a new member is an editor-side render case, not a plugin break. The same axis governs the rect surface: new geometry reads arrive as new methods on the same object. What must not happen is a second registry or a second geometry object — growth stays fields-and-members on the shipped shapes, the `BlockCommandContext` rule applied to the annotation layer.
- **Inline-widget editing-policy re-add.** Two `InlineWidgetEditingPolicy` fields were trimmed because nothing consumed them, keeping the pre-freeze inline surface free of inert configuration. Freezing an inert field and later giving it behavior is the one path that breaks an author's config, so they re-add **additively** with the deferred inline-entity / atomic-inline consumer — entity editing is _defined by_ delete granularity (atomic `&copy;` delete versus image's select-then-delete), which forces the re-add. The shapes, recorded so the re-add restores them verbatim: `deleteGranularity: 'atomic' | 'select-then-delete'` and `onEdge: 'select' | 'step-over'`.
- **Declarative plugin manifest.** A `definePlugin` overload over the imperative unit. Awaits the 1.2 reference plugins to validate.

### Deferred: the `EditEvent` snapshot/real-delta discriminant

Persistent version history (post-v1 app-infra) needs `EditEvent` to distinguish a real structural delta from a ceremony-borrow commit. It is deferred from this freeze on purpose:

1. **It is additive-later** — adding a field to `EditEvent` never breaks a receiver, so it does not need to be frozen before plugins bind.
2. **Its binding consumer is a different milestone** — version history, not the plugin contract.
3. **Its semantic is unpinned and must be designed _with_ that consumer.** The naive derivations are wrong: a normal content keystroke commits with the undo snapshot _skipped_ (it is debounce-batched) and carries an internal `noop` structural-change descriptor, yet it _is_ a real document change. So neither "an undo snapshot was pushed" nor "the structural-change was non-noop" identifies a real delta. The correct signal is a caller-declared "the user-visible document changed" flag at the commit sites — a design owned with the version-history layer.

## Explicitly excluded

- **Inline-parser _stage_ hook.** A hook that inserts a plugin stage into the inline parse _pipeline_ — distinct from `registerInlineSyntax`, which shipped and which hands the scanner a trigger character and a recognizer (see § Inline authoring). The stage hook remains excluded: widget-ness is a render+model decision, not a parse-pipeline one, so no built-in validates it. Its real consumer is the 1.3 inline-syntax work.
- **Per-hook 1.2 seams** — selection coordinate-addressing, and the component registry replacing `BlockHost` dispatch. Both additive over this foundation. (The component-portal widget seam already shipped additively, pre-1.0.)
- **Runtime unregister / replace** — Plugin System II.

## Enforcement

The contract's load-bearing rules are guarded by the invariant catalog (`docs/design/invariants.md`):

- Opener coherence at bootstrap over the live registry, and kind-table completeness at bootstrap.
- Keymap coherence over the live registries — a plugin keymap's command ids validate against the minted `PluginCommandId`s (the earlier built-ins-only gap is closed) — and a container's `reservedChrome` declaration gets bootstrap coherence.
- Closure-block coherence (G1.24): the required `closure` block agrees with the rest of the descriptor at bootstrap, and each declared `conformanceFixture` parses to its kind.
- Opaque-container staleness, rebuild determinism, and the reserved-chrome slot, at every commit.
- A plugin opener's return checked at parse: non-advancing throws, raw-mismatch warns.
- Duplicate registration throws at the call site.

The plugins e2e project fails on any dev-invariant fire.
