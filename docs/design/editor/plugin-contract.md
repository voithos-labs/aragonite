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

The plugin DX system (`plugins` prop, manifest, scaffold, hot-reload, reference fleet) stays
post-1.0 — see the roadmap.

## Why freeze now

The whole 0.7→0.8 sequence rests on one rule: structure is cheapest to fix _before_ external
code binds to it. A freeze pays that down for the plugin surface — once a third-party plugin
imports a type or relies on a behavior, changing it breaks that plugin. Freezing first means
1.1 (shell integration) and 1.2 (plugins) bind to a settled foundation instead of a moving one.

## The freeze criterion

A surface belongs in the freeze if, and only if, **changing it later would force a breaking
change on external code that has bound to it.**

| Verdict                  | Rule                                                                                    | Action                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Breaking-if-deferred** | A later change breaks bound external code                                               | Finalize now, even with no consumer yet                                                |
| **Additive-later**       | A later change only _adds_ (new field on a payload consumers receive, new optional API) | Defer — and deferring is _better_, because a shape with no consumer can't be validated |

The distinction is sharper than "does it have a consumer today." A required field added to an
event payload, for instance, never breaks a _receiver_ — so an event-payload extension is
additive-later even though it sounds like a contract change.

## Decision table

> Historical record of the 0.8.3 freeze scoping. Where a row says "1.2", the
> 1.0-as-plugin-platform pivot since moved the _authoring_ pieces (container contract,
> command mint, inline-widget editing registry) to pre-1.0; the _DX system_ stays 1.2. The
> verdict logic itself is unchanged.

| Surface                                                                  | Verdict              | In the freeze?                          | Reason                                                                                                                                                                                            |
| ------------------------------------------------------------------------ | -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CstNode.kind` widening to `AnyBlockKind`                                | breaking-if-deferred | **Yes — implemented**                   | A closed `switch (node.kind)` in external code goes non-exhaustive the moment a plugin kind appears                                                                                               |
| Registry model: global, register-once, conflict-on-duplicate             | breaking-if-deferred | **Yes — implemented**                   | Flipping silent-override → conflict after plugins bind changes observable behavior they relied on                                                                                                 |
| Plugin-kind naming + collision rules (`declarePluginKind`)               | breaking-if-deferred | **Yes — implemented**                   | The collision contract is what a plugin's kind name binds to                                                                                                                                      |
| Events access seam (`getEvents()` canonical)                             | additive-later       | **Ratified now; alternatives additive** | Keeping `getEvents()` is non-breaking and a future alternative path is additive — the freeze ratifies it as _the_ canonical entry point so consumers bind to one                                  |
| `EditEvent` / `EditorError` payload shapes                               | additive-later       | Bound as-is; extensible                 | New fields/origins never break a _receiver_                                                                                                                                                       |
| Plugin manifest / `plugins` prop                                         | additive-later       | **Sketched, built at 1.2**              | A new optional prop and its element type are additive; the shape needs the 1.2 reference plugins to validate                                                                                      |
| Plugin-op vocabulary extension                                           | additive-later       | Sketched                                | No plugin ops exist; extension mechanism is additive                                                                                                                                              |
| `EditEvent` snapshot/real-delta discriminant                             | additive-later       | **Deferred**                            | Its binding consumer (persistent version history) is post-v1 app-infra, and its semantic must be designed _with_ that consumer (see Deferred)                                                     |
| 0.8.2 inline-parser stage hook                                           | n/a                  | **Excluded**                            | Deferred to its real 1.2/1.3 consumer                                                                                                                                                             |
| Selection coordinate-addressing / inline-widget / component-portal seams | additive-later       | **Excluded (1.2)**                      | Per-hook seams built against this foundation; additive                                                                                                                                            |
| Runtime unregister / replace                                             | n/a                  | **Excluded (Plugin System II)**         | The static-registry model has no runtime unload                                                                                                                                                   |
| 0.8.5 lazy `inlineContent` (contract narrowing)                          | breaking-if-deferred | **Yes — implemented**                   | Dropping the `inlineContent` field from `CstNode` removes a public-type member; a plugin binds inline content through the `getInlineContent` accessor — narrowed now, while cheap, before binding |

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

**Why global, given the 1.2 per-instance `plugins` prop?** The roadmap flagged the apparent
tension. It resolves cleanly: kind _definitions_ are global because, like custom elements, a
kind cannot be defined differently for two editors in one process. The `plugins` prop (1.2) is
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
plugin-op vocabulary extension is the pre-1.0 command mint's territory; the plugin object /
`plugins` prop ships with the 1.2 DX system.

- **Plugin object + `plugins` prop.** A plugin is an identified unit that performs its global
  registrations. Direction: a declarative manifest (the framework owns registration order and
  conflict detection) over an imperative `register()` (the plugin calls `register*` itself) —
  to be confirmed against the reference plugins. The `plugins` prop on `Editor` is the
  registration trigger (idempotent across instances per the global model).
- **Plugin-op vocabulary extension.** A mechanism for a plugin to contribute an
  `OperationKind` (and its detail type) so its structural edits emit typed `EditEvent`s and
  participate in `EditorError.context.op`. Additive over `OperationDetailMap`.
- **Error-origin extension.** Additional `EditorError.origin` values (e.g. a plugin/parse/command
  origin) and possibly a structured plugin-error shape.

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
- **Per-hook 1.2 seams** — selection coordinate-addressing, inline-widget editing registry,
  component-portal widget seam, the component registry replacing `BlockHost` dispatch. All
  additive over this foundation.
- **Runtime unregister / replace** — Plugin System II.

## The pre-freeze authoring surface (1.0)

Everything a plugin author reaches today comes through the `aragonite/plugin` subpath:

- **Registration base (frozen):** kind declaration, descriptor/component/opener registration,
  idempotent-registration probes, typed per-node plugin metadata.
- **Container authoring:** a factory that wires a nested-`BlockList` container (list state,
  ancestor contexts, nested actions, windowing, the `BlockComponent` surface) so a plugin
  container is as thin as the built-in blockquote.
- **Editable chrome:** one call registers a container's title/summary leaf with a default
  keymap (Enter descends to the body; chord-keyed overrides). The container _declares_ its
  chrome slot on its descriptor, and the machinery enforces the **reserved-chrome contract**:
  the slot is always present, single-line (unsplittable; paste flattens inline), cleared —
  never node-deleted — by destructive ranges, and kind-stable through every edit.
- **Supporting descriptor fields:** context-dependent kinds (no standalone recognizer — kept
  through edits), and an opaque container contract (raw is authoritative, not a strip
  decomposition), both invariant-guarded.
- **Planned pre-1.0** (roadmap): plugin-minted command ids; the inline-widget editing
  registry (atomic caret-addressed inline plugins — KaTeX is the driving consumer).

## Editable-content tiers

Every mechanism for plugin content that is _itself editable_ falls in one of three tiers,
each bound to a CST guarantee (prior-art record: the plugin-system research doc):

| Tier          | Shape                                                                      | Status                    |
| ------------- | -------------------------------------------------------------------------- | ------------------------- |
| Container     | children are real CST blocks in a nested BlockList — the contentDOM analog | shipped                   |
| Chrome leaf   | a reserved, single-line, plain-text child the container's raw owns         | shipped                   |
| Atomic widget | opaque non-text embed, caret-addressable at its edges                      | pre-1.0 (inline registry) |

A _general_ editable leaf (recognizer-backed standalone text block) is deliberately post-1.0;
the chrome leaf is narrower on purpose. **Rejected permanently:** nested-editor interiors (a
second editor state serialized as a blob) — they break byte-lossless round-trip.

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

## Enforcement

The contract's load-bearing rules are guarded by the invariant catalog
(`docs/design/editor/invariants.md`): kind-table completeness, opener coherence, and keymap
coherence at bootstrap; opaque-container staleness, rebuild determinism, and the reserved-chrome
slot at every commit; duplicate registration throws at the call site. The plugins e2e project
fails on any dev-invariant fire.
