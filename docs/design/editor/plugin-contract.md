# Editor Plugin Contract (frozen foundation — exposed at 1.2)

## Status

The **foundation** of the plugin-facing contract is frozen as of 0.8.3. "Frozen" means the
shapes below will not change in a breaking way before external plugin code binds to them at
1.2. Nothing here is re-exported from `index.ts` yet — 1.2 flips the exposure switch. The
roadmap's 1.2 plugin surface (component registry replacing `BlockHost` dispatch, selection
coordinate-addressing hooks, inline-widget editing registry, component-portal widget seam,
`plugins` prop) is built _against_ this foundation; those hooks are not frozen here because
adding them later is additive, not breaking (see the criterion).

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

| Surface                                                                  | Verdict              | In the freeze?                          | Reason                                                                                                                                                           |
| ------------------------------------------------------------------------ | -------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CstNode.kind` widening to `AnyBlockKind`                                | breaking-if-deferred | **Yes — implemented**                   | A closed `switch (node.kind)` in external code goes non-exhaustive the moment a plugin kind appears                                                              |
| Registry model: global, register-once, conflict-on-duplicate             | breaking-if-deferred | **Yes — implemented**                   | Flipping silent-override → conflict after plugins bind changes observable behavior they relied on                                                                |
| Plugin-kind naming + collision rules (`declarePluginKind`)               | breaking-if-deferred | **Yes — implemented**                   | The collision contract is what a plugin's kind name binds to                                                                                                     |
| Events access seam (`getEvents()` canonical)                             | additive-later       | **Ratified now; alternatives additive** | Keeping `getEvents()` is non-breaking and a future alternative path is additive — the freeze ratifies it as _the_ canonical entry point so consumers bind to one |
| `EditEvent` / `EditorError` payload shapes                               | additive-later       | Bound as-is; extensible                 | New fields/origins never break a _receiver_                                                                                                                      |
| Plugin manifest / `plugins` prop                                         | additive-later       | **Sketched, built at 1.2**              | A new optional prop and its element type are additive; the shape needs the 1.2 reference plugins to validate                                                     |
| Plugin-op vocabulary extension                                           | additive-later       | Sketched                                | No plugin ops exist; extension mechanism is additive                                                                                                             |
| `EditEvent` snapshot/real-delta discriminant                             | additive-later       | **Deferred**                            | Its binding consumer (persistent version history) is post-v1 app-infra, and its semantic must be designed _with_ that consumer (see Deferred)                    |
| 0.8.2 inline-parser stage hook                                           | n/a                  | **Excluded**                            | Deferred to its real 1.2/1.3 consumer                                                                                                                            |
| Selection coordinate-addressing / inline-widget / component-portal seams | additive-later       | **Excluded (1.2)**                      | Per-hook seams built against this foundation; additive                                                                                                           |
| Runtime unregister / replace                                             | n/a                  | **Excluded (Plugin System II)**         | The static-registry model has no runtime unload                                                                                                                  |
| 0.8.5 lazy `inlineContent`                                               | n/a                  | **Excluded (internal)**                 | A compute-timing change; touches no public type or event payload                                                                                                 |

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

**Unknown-kind rule:** any exhaustive `switch` over kind must have a default arm that degrades
safely (the height oracle estimates an unknown kind as prose; serialization round-trips it via
`raw`). A plugin kind with no registered descriptor is a registration error surfaced at
registration, not a render-time crash.

### Schema registries — global, register-once, conflict-on-duplicate

The block grammar is a set of **process-global** registries (block-kind descriptors, block
components, block openers, global commands), each keyed by `AnyBlockKind` (or command id). This
is the `customElements` model: a kind is a _definition_ every editor instance in the process
shares, exactly as `customElements.define` defines an element for every document.

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
- **Reset is a test/HMR affordance, not a runtime API.** Because registration throws on
  duplicate, any path that re-registers would otherwise throw. Two internal, never-exposed
  affordances cover that: a single `__resetSchemaRegistriesForTests()` clears every _non-built-in_
  registration (built-ins survive, so tests that mint plugin/test kinds isolate without losing
  the grammar), and the registration modules decline dev HMR (`import.meta.hot?.decline()`) so an
  edit to one full-reloads the page — built-ins re-register in a fresh module graph rather than
  double-registering.

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

## Target shapes (designed; built and exposed at 1.2)

Sketched here so 1.2 builds toward a known direction. None is frozen: each is additive, and the
shapes want validation against the 1.2 reference plugins before they settle.

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

- **0.8.2 inline-parser stage hook** — deferred to its real 1.2 inline-widget editing registry /
  1.3 inline-syntax consumer. Widget-ness is a render+model decision, not a parse one, so the
  hook has no built-in to validate it.
- **Per-hook 1.2 seams** — selection coordinate-addressing, inline-widget editing registry,
  component-portal widget seam, the component registry replacing `BlockHost` dispatch. All
  additive over this foundation.
- **Runtime unregister / replace** — Plugin System II.
- **0.8.5 lazy `inlineContent`** — internal compute-timing; no contract impact.

## Enforcement

The contract's load-bearing rules are guarded by the invariant catalog
(`docs/design/editor/invariants.md`): kind-table completeness, opener coherence, and keymap
coherence already exist as bootstrap invariants. The freeze adds guards that a plugin-kind node
survives the render/measure/serialize path without a built-in assumption firing, and that
duplicate registration throws.
