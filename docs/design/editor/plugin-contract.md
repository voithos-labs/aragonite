# Editor Plugin Contract

## Status — two freeze layers

**1.0 is the plugin platform.** The contract has two layers with different freeze timing:

- **Registration base — frozen since 0.8.3.** Node identity (`AnyBlockKind`), the
  register-once/conflict-on-duplicate registry model, plugin-kind naming
  (`declarePluginKind`), accessor-only inline content, and the `getEvents()` seam. These
  shapes will not change in a breaking way.
- **Authoring surface — exposed _pre-freeze_ on `aragonite/plugin`.** The container factory,
  the chrome leaf + reserved-chrome contract, and their supporting descriptor fields (see
  § The pre-freeze authoring surface). Built pre-1.0, refined against real consumers, and
  **frozen only at the public open-source release** — after at least two real container
  consumers, the in-repo dogfood extensions, and an internal limestone integration validate
  it. Until the release cut, these shapes may change without notice; nothing external binds.

The plugin **unit** (`definePlugin`) and its `plugins` prop shipped pre-1.0 (see § The pre-freeze
authoring surface); the rest of the DX system — declarative manifest, scaffold, hot-reload dev loop,
reference fleet — stays 1.2 (see the roadmap).

## Why freeze now

The whole 0.7→0.8 sequence rests on one rule: structure is cheapest to fix _before_ external
code binds to it. A freeze pays that down for the plugin surface — once a third-party plugin
imports a type or relies on a behavior, changing it breaks that plugin. Freezing first means
1.1 (shell integration) and 1.2 (plugins) bind to a settled foundation instead of a moving one.

## The freeze criterion

A surface belongs in the freeze if, and only if, **changing it later would force a breaking
change on external code that has bound to it.**

| Verdict                  | Rule                                                                                    | Action                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Breaking-if-deferred** | A later change breaks bound external code                                               | Finalize now, even with no consumer yet                                                               |
| **Additive-later**       | A later change only _adds_ (new field on a payload consumers receive, new optional API) | No freeze pressure — safe to change later; **whether to build it now is a separate call** (see below) |

The distinction is sharper than "does it have a consumer today." A required field added to an
event payload, for instance, never breaks a _receiver_ — so an event-payload extension is
additive-later even though it sounds like a contract change.

### Freeze-scope is not build-scope

"Additive-later" answers one question — _must this be frozen now?_ → **no.** It does **not**
answer _should this be built now?_ Those are separate axes; collapsing them into a flat "defer"
is a trap (it under-scoped a batch once — a surface read as "don't build" when it was only "need
not freeze").

Deciding whether to build an additive-later surface pre-freeze:

- **Build now** when it rides machinery already being built (marginal cost), **or** a
  dogfood/in-repo consumer can validate the _mechanism_ pre-freeze. "A shape with no consumer
  can't be validated" has an escape hatch — writing a dogfood consumer _is_ the validation,
  which is what the dogfood plugins exist for.
- **Defer** when neither holds and building it would expose a _bound shape you would only be
  guessing at_ — the `EditEvent` snapshot/real-delta discriminant is the canonical case: its
  semantic needs its real post-v1 consumer.

The rule both branches serve: **get the shapes plugins _bind to_ exact before freeze; keep
_additive capability surfaces_ minimal, so later growth stays an _add_, never a _restructure_.**
Adding a field to a payload or context a consumer receives is safe; changing a signature or
shape they bind to is the breaking restructure.

## Decision table

> Historical record of the 0.8.3 freeze scoping. Where a row says "1.2", the
> 1.0-as-plugin-platform pivot since moved the _authoring_ pieces (container contract,
> command mint, inline-widget editing registry) to pre-1.0; the _DX system_ stays 1.2. The
> verdict logic itself is unchanged.

| Surface                                                                  | Verdict              | In the freeze?                                                                                         | Reason                                                                                                                                                                                            |
| ------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CstNode.kind` widening to `AnyBlockKind`                                | breaking-if-deferred | **Yes — implemented**                                                                                  | A closed `switch (node.kind)` in external code goes non-exhaustive the moment a plugin kind appears                                                                                               |
| Registry model: global, register-once, conflict-on-duplicate             | breaking-if-deferred | **Yes — implemented**                                                                                  | Flipping silent-override → conflict after plugins bind changes observable behavior they relied on                                                                                                 |
| Plugin-kind naming + collision rules (`declarePluginKind`)               | breaking-if-deferred | **Yes — implemented**                                                                                  | The collision contract is what a plugin's kind name binds to                                                                                                                                      |
| Events access seam (`getEvents()` canonical)                             | additive-later       | **Ratified now; alternatives additive**                                                                | Keeping `getEvents()` is non-breaking and a future alternative path is additive — the freeze ratifies it as _the_ canonical entry point so consumers bind to one                                  |
| `EditEvent` / `EditorError` payload shapes                               | additive-later       | Bound as-is; extensible                                                                                | New fields/origins never break a _receiver_                                                                                                                                                       |
| Plugin manifest / `plugins` prop                                         | additive-later       | **Sketched, built at 1.2** [pivot: unit + prop shipped pre-1.0; manifest stays 1.2]                    | A new optional prop and its element type are additive; the shape needs the 1.2 reference plugins to validate                                                                                      |
| Plugin-op vocabulary extension                                           | additive-later       | Sketched                                                                                               | No plugin ops exist; extension mechanism is additive                                                                                                                                              |
| `EditEvent` snapshot/real-delta discriminant                             | additive-later       | **Deferred**                                                                                           | Its binding consumer (persistent version history) is post-v1 app-infra, and its semantic must be designed _with_ that consumer (see Deferred)                                                     |
| 0.8.2 inline-parser stage hook                                           | n/a                  | **Excluded**                                                                                           | Deferred to its real 1.2/1.3 consumer                                                                                                                                                             |
| Selection coordinate-addressing / inline-widget / component-portal seams | additive-later       | **Excluded (1.2)** [pivot: component-portal shipped pre-1.0 (0.9.14); coordinate-addressing stays 1.2] | Per-hook seams built against this foundation; additive                                                                                                                                            |
| Runtime unregister / replace                                             | n/a                  | **Excluded (Plugin System II)**                                                                        | The static-registry model has no runtime unload                                                                                                                                                   |
| 0.8.5 lazy `inlineContent` (contract narrowing)                          | breaking-if-deferred | **Yes — implemented**                                                                                  | Dropping the `inlineContent` field from `CstNode` removes a public-type member; a plugin binds inline content through the `getInlineContent` accessor — narrowed now, while cheap, before binding |

## The frozen foundation

### Node identity — `AnyBlockKind`

A block's kind is `AnyBlockKind = BlockKind | PluginBlockKind`. `BlockKind` stays the closed
union of built-ins; `PluginBlockKind` is a branded string minted by `declarePluginKind`.
`CstNode.kind` is `AnyBlockKind`, so a plugin-kind node is a first-class CST citizen that flows
through render, measurement, and serialization.

`BLOCK_KIND_TABLE` remains the built-in completeness enforcer (a `Record<BlockKind, true>` the
compiler checks); `isBuiltinBlockKind` is the runtime discriminant that narrows `AnyBlockKind`
back to `BlockKind`. Code that must exhaustively handle built-ins keeps switching over
`BlockKind` after that narrowing; code that dispatches by registry lookup keys on
`AnyBlockKind` and tolerates unknown kinds.

**Unknown-kind rule:** any exhaustive `switch` over kind needs a default arm that degrades
safely — the height oracle estimates an unknown kind as prose, serialization round-trips it via
`raw`, and a kind with no registered component renders a visible raw fallback. A descriptor is
different: it is required infrastructure (`getBlockKindDescriptor` is read throughout — merge
rules, container rebuild, selection), so a descriptor-less kind throws at first use, a
render-path throw contained by the per-block error boundary as a failed-block fallback. Built-in
descriptor completeness is bootstrap-checked (G1.2 over the closed union); validating that a
plugin registered its descriptor is a 1.2 plugin-lifecycle concern.

### Node shape — inline content is accessor-only

`CstNode` carries no `inlineContent` field. A prose node's inline tree is derived from `raw`, so
it is obtained on demand through the `getInlineContent` accessor (the render path computes it
locally), never read off the node. An inline-bearing plugin kind declares `supportsInline` on its
descriptor and gets lazy inline for free; it must not assume a node-field cache.

This narrows the frozen contract — `inlineContent` was a public member of the node type. It is
done now, by the freeze's own criterion: a derived-cache field leaking into the node shape is the
kind of thing to remove while it is still cheap, before any plugin binds to it. After binding the
removal would be breaking; before binding it is a free correction.

### Schema registries — global, register-once, conflict-on-duplicate

The block grammar is a set of **process-global** registries — block-kind descriptors, block
components, block openers, global commands (in `schema/`), and per-kind paste surfaces (in
`tree-operations/`) — each keyed by `AnyBlockKind` (or command id). This is the `customElements`
model: a kind is a _definition_ every editor instance in the process shares, exactly as
`customElements.define` defines an element for every document.

```
Registration model
┌─────────────────────────────────────────────┐
│  Definitions (kinds, components, openers,    │  ← process-global, register-once
│  commands)  =  CODE                          │
├─────────────────────────────────────────────┤
│  State (selection, undo, render caches,      │  ← per editor instance
│  broken-url cache)  =  STATE                 │
└─────────────────────────────────────────────┘
```

- **Register-once.** Registering a kind that is already registered is a **conflict** — it
  throws — not a silent override. This makes a plugin colliding with a built-in (or another
  plugin) a loud, immediate error instead of last-writer-wins corruption. It also makes the
  code match what `consumer-guide.md` already promises.
- **Augmentation is distinct from registration.** `augmentBlockKind` merges fields into an
  _existing_ registration (the top-of-DAG wire-up uses it to patch in behavior that can't live
  in the schema layer without a downstream import). Augmenting an unregistered kind throws.
  Augmentation is deliberate and idempotent-by-intent; registration is once.
- **No unregister, no replace.** A static registry has no runtime unload. Runtime
  plugin loading/unloading with sandboxing is Plugin System II, explicitly out of this
  contract.
- **A global opener means global syntax recognition.** A plugin that registers a block opener
  teaches the _parser_ to recognize that syntax process-wide — so a second editor in the
  process parses plugin blocks even if its consumer did not pass the plugin. This is the chosen
  consequence of definitions-are-global (per-instance _enablement_, if ever needed, is the
  policy layer above), not a latent surprise.
- **Reset is a test affordance; HMR needs a reload.** Because registration throws on duplicate,
  any path that re-registers would otherwise throw. For tests, `__resetSchemaRegistriesForTests()`
  clears every _non-built-in_ schema registration (built-ins survive, so tests that mint
  plugin/test kinds isolate without losing the grammar); the paste-surface registry, living in
  `tree-operations/`, keeps its own full-clear reset. For dev HMR, a registration module cannot be
  hot-swapped in place under register-once — editing one requires a page reload (a deliberate,
  dev-only consequence; the modules carry no HMR-accept magic). All reset affordances are internal,
  never exposed.

**Why global, given the per-instance `plugins` prop?** The roadmap flagged the apparent
tension. It resolves cleanly: kind _definitions_ are global because, like custom elements, a
kind cannot be defined differently for two editors in one process. The `plugins` prop is
a registration _trigger and declaration of intent_ — passing the same plugin to two editors
registers once. If per-instance _enablement_ (editor A renders callouts, editor B does not) is
ever needed, that is a per-instance policy/allowlist layer over the global definitions, not
per-instance registration. It is not built now (no demand — YAGNI).

### Plugin-kind naming + collision rules

`declarePluginKind(name)` is the single mint point for a `PluginBlockKind`. It enforces the
name pattern and rejects collisions with **built-in kinds**, **previously-declared plugin
kinds**, and **reserved structural sentinels** — currently `document`, the CST-root
discriminant (`Document.kind`). The brand keeps `BlockKind` switches exhaustive over built-ins
while letting the registries key plugin kinds. Plugin-vs-plugin collision detection requires a
record of declared plugin kinds — minted names are tracked so a second `declarePluginKind` with
the same name throws. The `document` reservation matters because node-vs-document narrowing is
structural (`'raw' in node`), so a plugin kind named `document` would not corrupt the tree —
but reserving it keeps the contract unsurprising and the sentinel unambiguous.

### Events access seam — `getEvents()` canonical

The editor's event surface (`edit`, `selectionChange`, `error`) is reached through the
component method `getEvents()` (via `bind:this`); `on(event, handler)` returns a disposer.
This is the single canonical public access path. The internal `setContext` wiring that hands
the same emitter to child components is not part of the contract. (There is no `editor.events`
property — any documentation implying one is stale.)

## Surfaces bound now, extensible additively

These ship with the editor today and are part of what plugins observe. They are frozen _as the
current shape_ — but because they are payloads consumers _receive_, new fields and new union
members can be added later without breaking a receiver. They need no change for the freeze.

- **`EditEvent`** — `{ op, path, detail, timestamp }`, where `op` is the `OperationKind`
  vocabulary derived from `OperationDetailMap`. Emitted from the commit ceremony (structural
  ops) and the keystroke-debounce flush (`op: 'input'`).
- **`EditorError`** — `{ origin, error, context? }` with `origin` in
  `'subscriber' | 'render' | 'commit'` and `error: unknown` (correct for a boundary). Routed
  through the `error` event channel with a recursion guard.

## Target shapes (designed ahead)

Sketched so later work builds toward a known direction. None is frozen: each is additive. The
plugin-op vocabulary extension is the pre-1.0 command mint's territory but stays deferred within it
until a novel-op consumer exists (metadata edits already emit the typed `metadataUpdate`). The plugin
unit and `plugins` prop shipped pre-1.0 (see § The pre-freeze authoring surface); a declarative
manifest over the imperative unit remains additive-later.

- **Plugin-op vocabulary extension.** A mechanism for a plugin to contribute an
  `OperationKind` (and its detail type) so its structural edits emit typed `EditEvent`s and
  participate in `EditorError.context.op`. Additive over `OperationDetailMap`.
- **Error-origin extension.** Additional `EditorError.origin` values (e.g. a plugin/parse/command
  origin) and possibly a structured plugin-error shape.
- **Normalize-on-commit / veto seam.** A sanctioned hook for a plugin to veto a commit or append
  derived mutations atomically within the commit ceremony (ProseMirror
  `filterTransaction`/`appendTransaction`, CM6 `transactionFilter`). Post-1.0: additive over the
  ceremony — plugins never bind its internal shape — built when a real consumer validates the hook
  shape (veto vs append, sync vs async, the owned view it receives). Invariant enforcement stays
  editor-owned; this augments a commit, it does not bypass the invariants. The 1.0 freeze litmus
  verifies no frozen surface precludes it (`docs/roadmap.md` § Pre-freeze plugin direction
  decisions).

### Deferred (additive): the `EditEvent` snapshot/real-delta discriminant

Persistent version history (post-v1 app-infra) needs `EditEvent` to distinguish a real
structural delta from a ceremony-borrow commit. It is deferred from this freeze on purpose:

1. **It is additive-later** — adding a field to `EditEvent` never breaks a receiver, so it does
   not need to be frozen before plugins bind.
2. **Its binding consumer is a different milestone** — version history, not the plugin contract.
3. **Its semantic is unpinned and must be designed _with_ that consumer.** The naive derivations
   are wrong: a normal content keystroke commits with the undo snapshot _skipped_ (it is
   debounce-batched) and carries an internal `noop` structural-change descriptor, yet it _is_ a
   real document change. So neither "an undo snapshot was pushed" nor "the structural-change was
   non-noop" identifies a real delta. The correct signal is a caller-declared "the user-visible
   document changed" flag at the commit sites — a design owned with the version-history layer.

When added, it is an additive field, designed against its real consumer.

## Explicitly excluded

- **0.8.2 inline-parser stage hook** — deferred to the inline-widget editing registry (now
  pre-1.0) / its 1.3 inline-syntax consumer. Widget-ness is a render+model decision, not a
  parse one, so the hook has no built-in to validate it.
- **Per-hook 1.2 seams** — selection coordinate-addressing and the component registry replacing
  `BlockHost` dispatch. All additive over this foundation. (The component-portal widget seam shipped
  additively pre-1.0, at 0.9.14.)
- **Runtime unregister / replace** — Plugin System II.

## The pre-freeze authoring surface (1.0)

Everything a plugin author reaches today comes through the `aragonite/plugin` subpath:

- **Plugin unit + `plugins` prop (shipped pre-1.0, unstable-labeled).** `definePlugin({ name, setup })`
  packages a plugin's global registrations into one installable unit; the editor's set-once `plugins`
  prop installs each once per process, before the instance's first parse (`installPlugins` on the main
  barrel is the editor-less entry for `parse()` pipelines; `isPluginInstalled` probes an install). The
  decided shape is an **imperative `setup`** unit — a declarative manifest stays **additive-later** (a
  `definePlugin` overload, not a restructure). Install is once-per-process keyed by name: same-identity
  re-install no-ops, same-name/different-identity is first-wins with a dev-warn, a setup that throws
  stays failed. Kind declarations made during a setup are attributed to their plugin, so a
  duplicate-registration error names the first declarer. All four dogfood extensions and the consumer
  examples install through it.

  _Freeze litmus._ The unit's frozen shape must leave additive room for (a) a per-instance _enablement_
  policy layer over the global definitions (editor A renders a kind, editor B does not), (b)
  lazy/deferred setup, and (c) a declarative-manifest overload — none needed by a pre-freeze consumer,
  all additive. One boundary is load-bearing: the ambient marker that attributes a setup's kind
  declarations to its plugin is **synchronous-only by design** — a future async or lazy setup path must
  thread the owning plugin explicitly rather than widen the ambient mechanism.

- **Registration base (frozen):** kind declaration (plus `declaredPluginKind`, the checked
  accessor that recovers a declared brand in another module without a cast), descriptor /
  component / opener registration, idempotent-registration probes for kind, component, and
  opener registration, typed per-node plugin metadata.
- **Opener + serialize helpers:** `parse` (body → `Document`), `serializeChildren` (join child
  bytes), and `trimTrailingLineEnding` (CRLF-correct display text) — the recognizer and
  serializer halves an opener and `rebuildRaw` need, promoted off `core/` deep paths so the
  packaged artifact carries them.
- **Container authoring:** a factory that wires a nested-`BlockList` container (list state,
  ancestor contexts, nested actions, windowing, the `BlockComponent` surface) so a plugin
  container is as thin as the built-in blockquote. It returns a `ContainerBlockComponent` —
  the container methods it always supplies typed as required, so a host re-exports them with no
  per-member assertion; `BlockComponentProps` names the props BlockHost passes every component.
- **Editable chrome:** one call registers a container's title/summary leaf with a default
  keymap (Enter descends to the body; chord-keyed overrides). The container _declares_ its
  chrome slot on its descriptor, and the machinery enforces the **reserved-chrome contract**:
  the slot is always present, single-line (unsplittable; paste flattens inline), cleared —
  never node-deleted — by destructive ranges, and kind-stable through every edit.
- **Collapsible containers:** the declaration optionally carries a pure collapse probe
  (`isCollapsed` over the node); from that one declaration, every child-adjacency operation —
  merge from below, focus walks in and out, Enter-descend, reveal — is collapse-aware, the
  container factory derives its window clamp from the same probe (the body genuinely unmounts,
  no separate collapse dep to thread), and the height oracle estimates a collapsed container at
  one chrome row. The factory also returns a metadata-commit handle (`updateOwnMetadata`) for
  behavioral fields like a collapsible's open state — merged, raw-rebuilt, and undoable in one
  commit.
- **Editable-leaf authoring (shipped pre-1.0, unstable-labeled).** `createEditableLeaf` — the
  container factory's sibling for leaves: getter deps (`node`/`index`/`path` + `getEl()`), its
  own context reads, and a returned surface the component re-exports as one-liners. Two modes:
  `plain` (always-editable, per-keystroke commits, prose undo batching, factory-owned view sync)
  and `render-primary` (component-owned render↔source swap; the reveal→edit→blur cycle commits
  as one undo entry). Commits land through the block-edit ladder, so multi-block text
  structurally re-splits at the shared choke point. Block math is the render-primary validator;
  the `%%` memo harness kind is the plain validator.
- **Supporting descriptor fields:** context-dependent kinds (no standalone recognizer — kept
  through edits), and an opaque container contract (raw is authoritative, not a strip
  decomposition), both invariant-guarded.
- **Paste transforms (shipped pre-1.0, unstable-labeled).** `registerPasteTransform` records a
  content-keyed, pre-parse rewrite of pasted plain text: named, register-once (a duplicate throws,
  attributed to the owning plugin), run in install order at every paste site before the parse. It is
  **paste-scoped and content-keyed** — distinct from the internal, target-kind-keyed
  `registerPasteSurface` (which stays unexposed): a transform keys off the clipboard _content_ it
  recognizes, not the block kind the paste lands in — the shape the GitHub-alert → admonition
  conversion needs, and the 1.2 conversion-config direction validated a milestone early.
- **Inline authoring (shipped, unstable-labeled).** The inline mirror of the block surface on
  `aragonite/plugin`: an inline-kind mint with an idempotence probe (`declarePluginInlineKind`,
  `declaredPluginInlineKind`, `isInlineKindDeclared`); an inline-syntax recognition hook
  (`registerInlineSyntax` — the plugin hands the scanner a trigger character and a recognizer); and an
  inline-widget editing registry (`registerInlineWidgetKind`, carrying a per-kind
  `InlineWidgetEditingPolicy` on the `InlineWidgetDescriptor`, plus `InlineWidgetEditingContext` and
  `InlineSyntaxRecognizer`; `InlineNode` is on the barrel) that gives a plugin inline kind atomic,
  caret-addressed editing. KaTeX is the validating consumer — the renderer is injected, not bundled.
  Three freeze-time decisions ride this surface:
  - **Recognition precedence (additive).** The hook fires only for a trigger character no built-in
    scanner already claims — built-in delimiter dispatch runs first. This limit is part of the hook
    contract; a precedence-override variant can layer on additively later, without changing the base
    signature.
  - **Builder injection (resolved — shipped 0.9.14).** The additive resolution the freeze
    anticipated has shipped. Three builder paths now coexist: the recommended `component` (a Svelte
    component mounted through the render layer's injected portal builder and kept live across
    per-keystroke rebuilds by a keyed reuse pool), the stateless registry `buildWidget`, and image's
    stateful builder on the internal `augmentInlineWidgetKind` seam. The descriptor gained an optional
    `component` field (mutually exclusive with `buildWidget`) plus the `InlineWidgetComponentProps`
    shape on the barrel; the internal augment seam stays unexposed. KaTeX inline migrated onto the
    component path as the validator.
  - **Error rendering (additive-later).** No shared error-render seam — each renderer handles its own
    errors (the KaTeX path renders a legible inline message). Add an optional error-render hook only if
    a second renderer starts duplicating it.
- **Directive authoring (pre-freeze / unstable).** One shared opener owns the `:::`/`::`/`:` fence
  family and dispatches by name (`registerDirective`) across three tiers — container, single-line leaf,
  and atomic inline text — so N plugins never collide on opener priority. A registered name renders
  through its own first-class kind; an unregistered name round-trips byte-for-byte through a generic
  fallback, so a document survives its plugin being uninstalled. The `fromDirective` factory is
  required for container, optional for leaf, and rejected for text (kind-only), enforced at
  registration. `parseDirectiveAttributes` is an opt-in, one-way `info → { label, id, classes,
properties }` reader over the remark convention — the verbatim opener info stays the round-trip
  truth. Activation is the explicit idempotent `activateDirectives()` call (not an import side effect);
  the authoring symbols alone do not claim `:::`. See `docs/editor/directives.md`.
- **Planned pre-1.0** (roadmap): plugin-minted command ids.

## Editable-content tiers

Every mechanism for plugin content that is _itself editable_ falls in one of four tiers,
each bound to a CST guarantee (prior-art record: the plugin-system research doc):

| Tier          | Shape                                                                       | Status               |
| ------------- | --------------------------------------------------------------------------- | -------------------- |
| Container     | children are real CST blocks in a nested BlockList — the contentDOM analog  | shipped              |
| Chrome leaf   | a reserved, single-line, plain-text child the container's raw owns          | shipped              |
| Editable leaf | a recognizer-backed standalone text block with native caret/IME/undo parity | shipped (pre-freeze) |
| Atomic widget | opaque non-text embed, caret-addressable at its edges                       | shipped              |

A _general_ editable leaf was deliberately deferred past this foundation [pivot: shipped
pre-1.0 as `createEditableLeaf` (0.9.16), pre-freeze beside the container factory]; the chrome
leaf stays narrower on purpose. **Rejected permanently:** nested-editor interiors (a second
editor state serialized as a blob) — they break byte-lossless round-trip.

## What a plugin may and may not do

The boundary, condensed; the invariant catalog (`docs/design/editor/invariants.md`) is the
enforcement record.

A plugin **may**: register kinds/components/openers (once — duplicates throw); declare
`rebuildRaw` and have the commit ceremony invoke it; build containers and chrome through the
factories; store primitive per-node metadata; commit metadata through the sanctioned update
path; contribute per-kind keymaps over the command vocabulary; render as an unknown kind and
degrade safely.

A plugin **may not**: treat its DOM as authoritative or mutate the tree from the view layer
(boundary events flow up; the CST wins); write bytes through node references captured before
a commit (copy-on-write); pass reactive CST state by value across module boundaries (getters
only); invent merge-role/unwrap/container-contract values (closed enums); silently override a
built-in or another plugin's registration.

Most of the boundary is enforced by **shape** (the factories never expose raw context keys or
mutation handles) and the rest by **dev-mode invariants** that tree-shake out of production —
so plugin development against a production build gets no signal. **Develop plugins against a
dev build.**

### Misuse outcomes

What each misuse does in dev versus production — the reason the dev build is where plugin
development belongs:

| Misuse                               | Dev                                                                                                                                | Production                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `rebuildRaw` writes the wrong bytes  | commit-time invariant warn (opaque-container staleness / rebuild determinism), naming the kind                                     | silent until the bytes surface in a round-trip      |
| Component throws while rendering     | contained by the per-block error boundary — failed-block fallback plus an `error` event (`origin: 'render'`), attributable by path | same containment (the boundary ships in production) |
| Opener returns a non-advancing index | parse throws, naming the kind, before the loop can spin                                                                            | parse loop spins — the browser tab hangs on load    |
| Opener's `raw` ≠ the consumed lines  | parse dev-warns (`invariant:opener-raw`), naming the kind                                                                          | silent `serialize(parse(x)) !== x` round-trip break |
| Opener throws                        | propagates uncaught — parse runs at editor init and inside the commit ceremony, outside the per-block boundary                     | same — uncaught                                     |

## Enforcement

The contract's load-bearing rules are guarded by the invariant catalog
(`docs/design/editor/invariants.md`): opener coherence at bootstrap over the live registry, and
kind-table completeness and keymap coherence at bootstrap but over the built-in kinds only until
the registry-derived hardening lands — a plugin keymap's command ids are type-checked, not yet
bootstrap-validated;
opaque-container staleness, rebuild determinism, and the reserved-chrome slot at every commit; a
plugin opener's return checked at parse (non-advancing throws, raw-mismatch warns); duplicate
registration throws at the call site. The plugins e2e project fails on any dev-invariant fire.
