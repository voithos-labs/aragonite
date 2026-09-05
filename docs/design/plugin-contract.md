# Editor Plugin Contract

At 1.0, aragonite becomes a plugin platform and its plugin API stops moving. This document is the list of what stops moving, what's still soft, and what got left out on purpose. It isn't a tutorial. [The plugin guide](../guide/plugin-guide.md) teaches you how to write a plugin; this one tells you what you can safely build on, which is the question that bites later.

The idea behind all of it: **structure is cheapest to fix before external code binds to it.** Once a third-party plugin imports a type or relies on a behavior, changing either breaks the plugin. So the shapes plugins bind to get settled first, and everything downstream builds on a foundation that has stopped moving.

The tour:

1. [The freeze, in two layers](#the-freeze-in-two-layers): which half is already settled, and what the other half is waiting for.
2. [What earns a freeze](#what-earns-a-freeze): the one criterion, and the decision table it produced.
3. [The frozen foundation](#the-frozen-foundation): block identity, the registries, naming, events. The settled half, in detail.
4. [The pre-freeze surface](#the-pre-freeze-surface): everything a plugin author reaches today, and the decisions riding each piece.
5. [Payloads bound as-is](#payloads-bound-as-is): the event and error shapes that only ever grow, never change.
6. [Editable content and the closure matrix](#editable-content-and-the-closure-matrix): the four ways plugin content can be editable, and the checklist every new block type fills before it ships.
7. [The boundary, and who gets which type](#the-boundary-and-who-gets-which-type): where the rules of conduct now live, plus the one table only this document carries.
8. [Target shapes](#target-shapes-designed-ahead): future directions sketched just enough that later work is an addition, not a rework.
9. [Deferred and excluded](#deferred-and-excluded): what got pushed past 1.0 or rejected outright, with reasons.
10. [Enforcement](#enforcement): the checks that hold all of the above.

## The freeze, in two layers

The contract freezes in two stages, because the two halves grew up at different times.

| Layer                 | What's in it                                                                                                                                                                                                                                                                                                                                       | Frozen                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Registration base** | Node identity (`AnyBlockKind`), the register-once, conflict-on-duplicate registry model, plugin-kind naming (`declarePluginKind`), the no-node-field inline-content shape (a kind declares `supportsInline`), and the `getEvents()` access path                                                                                                    | **Since 0.8.3.** No breaking change from here |
| **Authoring surface** | Everything on the `@voithos-labs/aragonite/plugin` subpath: the container and editable-leaf factories, chrome leaves (chrome: the parts of a block that are furniture rather than content, a title row, a fence line), directives, inline authoring, commands, paste transforms (inventoried in [The pre-freeze surface](#the-pre-freeze-surface)) | **At the public 1.0 release**, not before     |

The authoring surface stays labeled unstable until the release cut, and the cut has preconditions: validation by at least two real container consumers, the in-repo dogfood extensions, an internal limestone integration, and at least one genuinely external author. External means a developer who isn't the project owner, building from the tarball and the docs pack unassisted, with their friction log treated as blocking input. (The 0.9.28 third-party audit found that every validation artifact so far was owner-authored, which validates discoverability and says nothing about the API in outside hands.) Until then the surface may change without notice, and since nothing external binds to it yet, that costs nobody anything.

The rest of the DX system (declarative manifest, scaffold, hot-reload dev loop, packaged reference fleet) sits outside the freeze entirely and ships after it.

## What earns a freeze

A surface belongs in the freeze if, and only if, **changing it later would force a breaking change on external code that has bound to it.**

| Verdict                  | Rule                                                                                      | Action                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Breaking-if-deferred** | A later change breaks bound external code                                                 | Finalize now, even with no consumer yet                                      |
| **Additive-later**       | A later change only adds (a new field on a payload consumers receive, a new optional API) | No freeze pressure. Whether to build it now is a separate call, covered next |

The distinction is sharper than "does it have a consumer today". A required field added to an event payload never breaks a _receiver_, so an event-payload extension is additive-later even though it sounds like a contract change. That one catches people.

**Freeze-scope is not build-scope.** "Additive-later" answers exactly one question (must this be frozen now?) and the answer is no. It doesn't answer whether to build it now. Collapsing the two into a flat "defer" is a trap, and it bit once: a batch got under-scoped because a verdict was read as "don't build" when all it ever said was "need not freeze". So, for an additive-later surface:

- **Build now** when it rides machinery already being built (marginal cost), or when a dogfood or in-repo consumer can validate the mechanism pre-freeze. "A shape with no consumer can't be validated" has an escape hatch: writing a dogfood consumer _is_ the validation, which is what the dogfood plugins exist for.
- **Defer** when neither holds and building would mean binding a shape you'd only be guessing at. The `EditEvent` snapshot discriminant is the canonical case; its meaning needs its real post-v1 consumer (see [Deferred and excluded](#deferred-and-excluded)).

The rule both branches serve: get the shapes plugins **bind to** exact before the freeze, and keep additive capability surfaces minimal, so later growth stays an add and never a restructure. Adding a field to a payload a consumer receives is safe. Changing a signature or shape they bind to is the breaking restructure, and by then it's somebody else's build going red, not yours.

### The decision table

The durable content is the verdict column: breaking-if-deferred versus additive-later, the logic that scoped the 0.8.3 freeze. The status column just reads current, where each surface actually landed.

| Surface                                                                     | Verdict              | In the freeze?                                                                                                             | Reason                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CstNode.kind` widening to `AnyBlockKind`                                   | breaking-if-deferred | **Yes, implemented**                                                                                                       | A closed `switch (node.kind)` in external code goes non-exhaustive the moment a plugin kind appears                                                                                                                                                                                                                                                                                    |
| Registry model: global, register-once, conflict-on-duplicate                | breaking-if-deferred | **Yes, implemented**                                                                                                       | Flipping silent-override to conflict after plugins bind changes observable behavior they relied on                                                                                                                                                                                                                                                                                     |
| Plugin-kind naming + collision rules (`declarePluginKind`)                  | breaking-if-deferred | **Yes, implemented**                                                                                                       | The collision contract is what a plugin's kind name binds to                                                                                                                                                                                                                                                                                                                           |
| Events access (`getEvents()` + `EditorContext.events`)                      | additive-later       | **Both paths shipped**                                                                                                     | `getEvents()` is the consumer canonical; `EditorContext.events` is the plugin subscribe-only view (`Pick<…,'on'>`), an additive second path, exactly what the verdict allowed                                                                                                                                                                                                          |
| `EditEvent` / `EditorError` payload shapes                                  | additive-later       | Bound as-is; extensible                                                                                                    | New fields and origins never break a _receiver_                                                                                                                                                                                                                                                                                                                                        |
| Plugin manifest / `plugins` prop                                            | additive-later       | **Unit + prop + per-instance options shipped pre-1.0; manifest stays post-1.0**                                            | The prop's element type is now the `EditorPluginEntry` union (`plugin \| { plugin, options }`), an additive widening; the declarative manifest overload still awaits the post-1.0 reference plugins to validate                                                                                                                                                                        |
| Plugin-op vocabulary extension                                              | additive-later       | Sketched                                                                                                                   | No plugin ops exist; the extension mechanism is additive                                                                                                                                                                                                                                                                                                                               |
| `EditEvent` snapshot/real-delta discriminant                                | additive-later       | **Deferred**                                                                                                               | Its binding consumer (persistent version history) is post-v1 app-infra, and its meaning must be designed _with_ that consumer (see Deferred and excluded)                                                                                                                                                                                                                              |
| Inline-parser _stage_ hook                                                  | n/a                  | **Excluded**                                                                                                               | A parse-pipeline stage, a different thing from the shipped `registerInlineSyntax` scanner hook (see Deferred and excluded)                                                                                                                                                                                                                                                             |
| Selection coordinate-addressing / inline-widget / component-portal surfaces | additive-later       | **Inline-widget + component-portal shipped pre-1.0; coordinate-addressing stays post-1.0**                                 | Per-hook surfaces built against this foundation; additive                                                                                                                                                                                                                                                                                                                              |
| Consumer diagnostics (`getDiagnostics()`)                                   | additive-later       | **Shipped 0.9.25**                                                                                                         | Interaction trace + serialized field report; consumer-only (plugins never bind it) and grows as fields on `EditorDiagnostics`, never a second entry point                                                                                                                                                                                                                              |
| Semantic commands (`runCommand` + `TOOLBAR_COMMANDS`)                       | additive-later       | **Shipped 0.9.41; the admissibility read `canRunCommand` and the pressed-state read `isCommandActive` beside it**          | Consumer-only: the published id set grows by addition, and a plugin's per-block command stays chord-only, so no plugin binds this surface for one (see the command section). The verdict is what shaped the reads: asking whether a command would run is a second method over the same surface, never a changed return on the method a consumer already binds                          |
| Presentation-mode contract (`PresentationMode` + per-tier mode reads)       | breaking-if-deferred | **Yes; every stage shipped pre-1.0 (mode contract, reading, block-granular preview, inline-granular preview, fully live)** | A plugin authored against a marker-always editor renders wrong the day preview ships. Not an API break but an ecosystem-stranding one; the union shipped whole and each later rung activated with zero API change                                                                                                                                                                      |
| Runtime unregister / replace                                                | n/a                  | **Excluded (Plugin System II)**                                                                                            | The static-registry model has no runtime unload                                                                                                                                                                                                                                                                                                                                        |
| Lazy `inlineContent` (contract narrowing)                                   | breaking-if-deferred | **Yes, implemented**                                                                                                       | Dropping the `inlineContent` field from `CstNode` removes a public-type member; a plugin binds inline content by declaring `supportsInline`, not by reading a node field. Narrowed while cheap, before binding                                                                                                                                                                         |
| Caret geometry (`caretOffsetAtPoint`, `CaretTarget`, `CURSOR_END`)          | additive-later       | **Shipped 0.10.1**                                                                                                         | `caretTargetAtPoint` shipped as a field the platform reads and no plugin could fill: turning a point into an offset needs the DOM-to-raw walk, which is not a plugin's to reimplement. Built now rather than deferred because the bundled parrot is the consumer that validates it, and a plugin written against the absent surface carries a hand-rolled browser-compat probe forever |
| `SelectionPoint` shape: `offset` coordinate-space discriminant              | breaking-if-deferred | **Yes, implemented**                                                                                                       | An optional bool discriminating one public numeric field freezes a misreadable shape; settled to a `CharSelectionPoint \| CellSelectionPoint` union before consumers bind. `offset` keeps its name, so reads compile unchanged and the flag now narrows                                                                                                                                |

## The frozen foundation

### Node identity: `AnyBlockKind`

A block's **kind** (the string on a node that says what block it is) is `AnyBlockKind = BlockKind | PluginBlockKind`. `BlockKind` stays the closed union of built-ins; `PluginBlockKind` is a branded string minted by `declarePluginKind` (minted as in: created by the one authorized place, and a duplicate throws). `CstNode.kind` is `AnyBlockKind`, so a plugin-kind node is a first-class CST citizen that flows through render, measurement, and serialization like a paragraph does.

```ts
import { declarePluginKind } from '@voithos-labs/aragonite/plugin';

const CALLOUT = declarePluginKind('callout'); // PluginBlockKind: the string 'callout', branded
declarePluginKind('paragraph'); // throws: declarePluginKind: "paragraph" is a built-in BlockKind
declarePluginKind('callout'); // throws: declarePluginKind: "callout" was already declared by another plugin
```

`BLOCK_KIND_TABLE` remains the built-in completeness enforcer (a `Record<BlockKind, true>` the compiler checks), and `isBuiltinBlockKind` is the runtime check that narrows `AnyBlockKind` back to `BlockKind`. Code that must exhaustively handle built-ins keeps switching over `BlockKind` after that narrowing; code that dispatches by registry lookup keys on `AnyBlockKind` and tolerates kinds it has never heard of.

**The unknown-kind rule.** Any exhaustive `switch` over kind needs a default branch that degrades safely. The height oracle (the estimate-then-measure height model of windowing, the machinery that only mounts the blocks you can see) estimates an unknown kind as prose, serialization round-trips it through `raw` (a node's verbatim source bytes, markers included), and `BlockHost`, which has no per-kind branch and mounts whatever the component registry hands it, renders a kind with no entry as a visible raw fallback.

A **descriptor** (the per-kind metadata record: how the kind merges, edits, renders) is different, because it's required infrastructure: `getBlockKindDescriptor` is read throughout, by merge rules, container rebuild, selection. A descriptor-less kind therefore throws at first use, a render-path throw the per-block error boundary contains as a failed-block fallback. Built-in descriptor completeness is checked at bootstrap (G1.2, over the closed union). Plugin descriptors are checked partly: a plugin kind that registers an opener (the part of the parser that recognizes the syntax a block starts with) fails bootstrap if its descriptor is missing (G1.10), and so does one declaring `reservedChrome` (G1.18). A plugin kind with neither, reachable only by direct construction, isn't validated; a full plugin-lifecycle check is a 1.2 concern.

### Inline content is not a node field

`CstNode` carries no `inlineContent` field. A prose node's inline tree is derived from `raw`: the render path computes it locally, and the editor's non-render internals read it through an internal, non-reactive accessor that isn't a surface a plugin calls. What a plugin binds to is a single descriptor flag. An inline-bearing kind declares `supportsInline` and gets lazy inline for free, with no node-field cache to assume.

This narrowed the frozen contract (`inlineContent` used to be a public member of the node type), and it happened by the freeze's own criterion. A derived-cache field leaking into the node shape is exactly the thing you remove while it's still cheap; after binding, the removal is breaking.

### The registries: global, register-once

The block grammar is a set of **process-global** registries: block-kind descriptors, block components, block openers, and the global and per-kind block commands (in `schema/`); inline syntax and inline widgets (in `core/inline/`); the directive registry (in `core/directive/`); and per-kind paste surfaces plus paste transforms (in `tree-operations/`). Each is keyed by `AnyBlockKind`, or by command id, trigger, or directive name. This is the `customElements` model: a kind is a _definition_ every editor instance in the process shares, exactly as `customElements.define` defines an element for every document.

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

**Register-once.** Registering a kind that's already registered is a conflict, so it throws rather than silently overriding. A plugin colliding with a built-in (or another plugin) is a loud, immediate error instead of last-writer-wins corruption, and the code matches what `docs/guide/consumer-guide.md` already promises.

**Augmentation is distinct from registration.** `augmentBlockKind` merges fields into an _existing_ plugin-kind registration: a built-in kind, a kind another plugin owns, and an unregistered kind are each refused with a throw. The top-level wire-up patches behavior into a built-in through the internal `augmentBuiltin` seam (`schema/block-kind-descriptor.ts`), kept off the plugin barrel so a plugin can't rewrite a built-in. Augmentation is deliberate and idempotent-by-intent; registration is once. And there's no unregister and no replace: runtime plugin loading and unloading with sandboxing is Plugin System II, explicitly outside this contract.

**A global opener means global syntax recognition, resolved through a per-instance view.** A plugin that registers a block opener teaches the _parser_ to recognize that syntax process-wide. Definitions stay global; each instance _resolves_ them through a `RegistryView` (`schema/registry-view.ts`), and which definitions an instance's view admits is the enablement question, answered [below](#per-instance-enablement).

**Reset is a test affordance; a dev server replaces instead of throwing.** Because registration throws on duplicate, any path that re-registers would otherwise throw. Three carve-outs, none of which soften the frozen contract (in production and under test the register-once throw is unchanged, and pinned):

- For tests, `__resetSchemaRegistriesForTests()` clears every _non-built-in_ schema registration. Built-ins survive, so a test that mints plugin or test kinds isolates without losing the grammar. The paste-surface registry, living in `tree-operations/`, keeps its own full-clear reset.
- Under a **dev server** (a dev build, not a test run) a duplicate registration REPLACES with a note instead of throwing (`schema/register-once.ts`). A Vite dev server that invalidates a registrar module re-runs its `registerX` calls while the registry survives, and without this valve every route 500s (the SSR registrar-poison class). It's strictly better than a forced reload, since a _changed_ registrar registration takes effect on re-run. The valve reaches whatever re-runs a `registerX` call: module-scope registration side effects, `activateDirectives()`, the built-in bootstraps. It covers every keyed registry plus the kind and id brands, including a chorded plugin-global command: a same-command re-bind replaces, while a cross-command chord collision keeps the throw. It does _not_ reach a `definePlugin` unit, which installs once per process keyed by plugin name in a map one tier above the registries, so a re-evaluated plugin module is first-wins-ignored with a dev warn before any registrar runs; editing a plugin's own definition still wants a reload.
- The per-registry resets stay internal. The one sanctioned public entry is the `@voithos-labs/aragonite/testing` subpath's `resetPluginPlatformForTests()`, which aggregates them so a third-party plugin's own test suite can re-install between cases, and throws outside a detected test environment.

#### Who wins on a name collision

Three layers stack, and each answers differently. This table is the whole answer; the bullets above are the reasoning behind row 2.

| Layer                                                                                                                | Same name, second time                                                                                                                                              | Where it lives                                           |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Plugin unit install** (`plugins` prop, `installPlugins`)                                                           | Same identity: no-op. A different definition under one name: **first wins**, the later one and its options ignored with a dev warn (the re-evaluated plugin module) | `schema/plugin-install.ts`                               |
| **Schema registrars** (descriptor, component, opener, command, inline syntax and widget, paste transform, directive) | **Register-once**: throws in production and under test; on a dev server it replaces with a note, so a re-run registrar survives hot reload                          | `schema/register-once.ts`                                |
| **Directive names** (`registerDirective`)                                                                            | The registrar throw above. **First-wins is an author convention, opt-in**: guard on `isDirectiveRegistered(tier, name)` and skip your own registration              | `core/directive/registry.ts`; `docs/guide/directives.md` |

The asymmetry is deliberate. Installing a unit is a declaration of intent, so repeating it isn't an error; registering a name is a definition, so two of them are. A directive name is the one collision the platform can't resolve for you, since both claimants are plugins, which is why the convention is opt-in rather than built in.

#### Per-instance enablement

Kind _definitions_ are global because, like custom elements, a kind can't be defined differently for two editors in one process. What's per instance is **activation**, and the `plugins` prop is the enablement set: an editor activates exactly the plugins it lists, meaning their `onEditor` hooks, their kinds and openers (through the `RegistryView` over the global definitions), their global commands and the chords those claim, and their paste transforms. A plugin another editor installed but this one didn't list attaches nothing here, and its kinds resolve no component and degrade to the raw-editable fallback. An editor mounted with no `plugins` prop activates everything installed in the process; that's the documented default, not a leak. `schema/plugin-activation.ts` builds the set, and `docs/contributing/codebase-map.md` names the reads that consult it.

The view is frozen-safe because it's additive over the global definitions: built-ins are never disableable, and the descriptor is never filtered. `parse(source, { grammar })` threads the instance's view, so a reparse skips an unlisted kind's opener; the **initial** parse still reads the global grammar, so an unlisted plugin's syntax parses to its kind and then degrades on render. One leak is open on the ledger: inline syntax, inline widget kinds, directives, and block completers still reach every editor (#266). The harness-only `__registryEnablement` prop stays, because the filtered-view proof wants a predicate it can vary without varying the install.

### Plugin-kind naming and collision rules

`declarePluginKind(name)` is the single place a `PluginBlockKind` is minted. It enforces the name pattern (a lowercase first letter, then letters, digits and hyphens) and rejects collisions with **built-in kinds**, **previously declared plugin kinds**, and two **reserved names**: `document`, the marker that distinguishes the CST root, and `global`, the keybinding-override scope. The brand keeps `BlockKind` switches exhaustive over built-ins while letting the registries key plugin kinds, and minted names are tracked, so a second `declarePluginKind` with the same name throws (naming the first declarer, when a plugin's setup did the declaring).

The `document` reservation matters less than it looks: node-vs-document narrowing is structural (`'raw' in node`), so a plugin kind named `document` wouldn't corrupt the tree. Reserving it just keeps the contract unsurprising. `global` is the one carrying weight: override lookup takes a `'global' | AnyBlockKind` scope, so a live kind spelled `global` would resolve the per-kind tier through the global table.

### Events access: `getEvents()` canonical

The editor's event surface (`edit`, `selectionChange`, `presentationModeChange`, `themeChange`, `error`) has two sanctioned access paths, one per audience. A **consumer** reaches the full surface through the component method `getEvents()` (via `bind:this`), where `on(event, handler)` returns a disposer. A **plugin** reaches it through `EditorContext.events`, the subscribe-only view (`Pick<EditorEvents, 'on'>`, so `on` only, no `emit`) handed to an `onEditor` callback, a global-command handler, or a block command's `ctx.editor`. The narrowing is deliberate: a plugin-visible `emit` would freeze at 1.0, so the plugin path exposes subscription and nothing more. The internal `setContext` wiring that hands the same emitter to child components isn't part of the contract.

## The pre-freeze surface

Everything a plugin author reaches today comes through the `@voithos-labs/aragonite/plugin` subpath, and this section is the inventory of what freezes at the release cut.

One packaging fact first: the tarball carries every internal module's `.d.ts`, on purpose. Encapsulation is exports-map-level. The map lists the barrels and nothing else, so a deep runtime import doesn't resolve, while the shipped declarations stay a greppable types reference (the clean-room author read them as exactly that). Pruning them was considered and declined: a graph-derived pruner would put the published types at risk of a broken build to save a few hundred kilobytes of text nobody downloads twice.

### The plugin unit and the `plugins` prop

`definePlugin({ name, setup })` packages a plugin's global registrations into one installable unit; the editor's set-once `plugins` prop installs each once per process, before the instance's first parse. `installPlugins` on the main barrel is the editor-less entry for `parse()` pipelines, `isPluginInstalled` probes an install, and `definePluginBlock` is the single-block shorthand (one kind, one component, one register step) for the common case that needn't touch `definePlugin` and `registerBlockComponent` directly.

```ts
import { definePlugin } from '@voithos-labs/aragonite/plugin';

export const callouts = definePlugin<{ maxDepth: number }>({
	name: 'callouts',
	setup(ctx) {
		// global registrations go here: declarePluginKind, registerBlockKind, registerBlockOpener, ...
		ctx.onEditor((editor) => {
			editor.editorId; // 'editor-1', stable for the life of that mount
			editor.document; // the live document, read-only (a DocumentView)
			editor.options; // { maxDepth: 3 } from the entry below, typed by the generic
			const off = editor.events.on('edit', (e) => console.log(e.op, e.path)); // subscribe-only: no emit
			return off; // the disposer, run at unmount
		});
	}
});

// the consumer's side: one array, shared by every <Editor>; an entry is a bare unit or { plugin, options }
const plugins = [{ plugin: callouts, options: { maxDepth: 3 } }];
```

The decided shape is an **imperative `setup(ctx)`** unit; a declarative manifest stays additive-later, as a `definePlugin` overload rather than a restructure. Install is once-per-process keyed by name: a same-identity re-install no-ops, same-name-different-identity is first-wins with a dev warn, and a setup that throws stays failed. Kind declarations made during a setup are attributed to their plugin, so a duplicate-registration error names the first declarer. The in-repo dogfood extensions and the consumer examples install through it.

**The per-instance context.** `setup` receives a `PluginSetupContext`, and its `ctx.onEditor(cb)` registers a callback fired once per `<Editor>` instance, receiving an **`EditorContext`**: instance identity (`editorId`, stable per mount), a live `document` getter, the subscribe-only `events` view, and typed `options`, plus `decorations`, `rects`, `presentationMode` and `theme`, each covered in its own section below. The callback may return a disposer, run at unmount. This is what makes derived state, edit reaction, and per-instance configuration possible without a plugin-state field: a plugin keys its own `Map` on `editorId`. `definePlugin<Options>` carries the option type through to `editor.options`. Registration is **synchronous-only**: a context leaked past `setup` throws, the same boundary as kind attribution.

**Per-instance options** ride the `plugins` prop's `EditorPluginEntry` element type (`plugin | { plugin, options }`), so two editors sharing one process-global registration can still run different options, the split-pane case. A plugin factory's own argument stays correct only for a process-global dependency (a render engine); anything two instances would vary belongs in the prop entry. Options are read at three places, resolved for the owning plugin and typed `unknown` at the two block tiers: `EditorContext.options` off `onEditor`, and the container and leaf factories' `getOptions()`, which is what a mounted component reads without a side map keyed on `editorId`. The bundled toc block is the validating consumer: per-instance `maxDepth`, with the factory argument as the bare-install default.

_Freeze litmus._ The unit's frozen shape must leave additive room for (a) the per-instance enablement policy layer over the global definitions, (b) lazy or deferred setup, and (c) a declarative-manifest overload. None is needed by a pre-freeze consumer; all are additive. Two boundaries matter. The ambient marker that attributes a setup's kind declarations to its plugin is **synchronous-only by design**, so a future async or lazy setup path must thread the owning plugin explicitly rather than widen the ambient mechanism. And the **one-context-object test is satisfied by construction**: the `EditorContext` an `onEditor` callback receives, a `registerGlobalCommand` handler receives, and a block command reads through `ctx.editor` are one type with one shape. The platform never ships two context objects to reconcile.

### Registration base (frozen)

The frozen layer's exports, in one breath: kind declaration plus `declaredPluginKind` (the checked accessor that recovers a declared brand in another module without a cast); descriptor, component, and opener registration; `defineBlockComponent`, which types a Svelte component as a `BlockComponent` without an `as unknown as` cast; idempotent-registration probes for the registries that publish one, which a module-scope registrar guards on so a re-import doesn't throw; and typed per-node plugin metadata (`setPluginMetadata` / `getPluginMetadata`), which stores a plugin kind's own shape without casting through the built-in metadata union.

On `BlockComponent` itself, caret placement is two verbs. `focus` places a caret AND ends any live cross-block range, which is the safe default and the one an author gets by writing nothing special. `parkCaret` is optional and does the same landing without ending the range, for the editor's selection-extend paths; a block built on either factory gets both from the surface it publishes, and G2.12 guards which callers may reach the second. The asymmetry is deliberate: one verb carrying both meanings cost two whole-document data losses pre-1.0.

The surface's optional members stay **flat**. Grouping the capability probes into named facets was considered and declined. The caret members' three layers are documentation (`docs/design/editor.md` § The editing surface), and `ContainerBlockComponent`, the container members promoted to required, is the one tier the types themselves carry.

### Parse and serialize helpers

The recognizer and serializer halves an opener and a `rebuildRaw` need, promoted off `core/` deep paths so the packaged artifact carries them:

- `parse`: body in, `Document` out. Takes the additive `parse(source, { grammar })` options slot: the per-instance grammar view, defaulting to the global grammar, so an unthreaded call is byte-identical.
- `serialize` / `serializeChildren`: a whole document's bytes back, or just a child list's.
- `trimTrailingLineEnding`: CRLF-correct display text.
- `normalizeLineEndings`: normalize external text to LF before it enters the tree, so Windows clipboards don't leak CRLF into notes.
- `splitLines` + `ParsedLine`: the line shape an opener reads off `ctx.lines` (raw bytes, text, line ending, offsets), and the splitter that produces it, so a `source → source` transform holding nothing but a string can still reach the line-scoped surfaces.
- `isBlankLine`: GFM §2.1's blank line, spaces and tabs only. `String.trim()` would admit the whole Unicode whitespace set and split a block on a pasted non-breaking space.
- `parseContainerBody` + `ContainerBodyWrap`: the body parse for a container whose chrome lines bound it (`:::note` … `:::`), where a blank line against a chrome line is a separator rather than a child. A container that parses its body with plain `parse` mis-owns that line.

Beside them travel the read-side node helpers a renderer or a widget's derived needs without a deep import: inline content for a prose leaf (no link-reference resolver is available to a plugin, so reference forms parse as `unresolvedReference`), the inline-bearing probe that gates the walk, the content span within a block's raw with its syntax markers excluded, and a heading's level. All pure and uncached: the reactive-safe read, never a cache to assume.

### Built-in grammar recognizers

The built-in line grammars a plugin would otherwise fork, exposed so a construct shaped like a built-in reuses CommonMark's rules instead of a second, subtly-wrong copy. This was recorded as an authoring wall before the exports existed: every fence-claiming plugin was rewriting the same rules.

- **Fences.** `matchFenceOpen` / `matchFenceClose` and the `FenceOpen` shape, for a plugin claiming a fence (` ```mermaid `). `matchFenceOpen` returns the opener's verbatim indent and info bytes (the bytes a byte-exact `rebuildRaw` has to replay), and `matchFenceClose` tests a candidate closer against that opener.

  `````ts
  matchFenceOpen('  ```mermaid  ');
  // { marker: '`', length: 3, info: 'mermaid', indent: '  ', infoRaw: 'mermaid  ' }
  matchFenceOpen('not a fence'); // null
  matchFenceClose('````', '`', 3); // true: a closer may be longer than its opener, never shorter
  `````

- **HTML tag lines.** `htmlBlockTagLineMatcher` builds CommonMark's type-6 tag-line recognizer for one tag name. What closes such a container is everything the spec passes through raw (indented, upper-cased, trailing space), looser than any canonical form a rebuild emits, and that looseness is the part a hand-rolled matcher gets wrong.
- **Blockquote extent.** `blockquoteExtent` scans a `>`-prefixed run under §5.1 lazy continuation, for a construct claiming a blockquote shape (`> [!NOTE]`).

### Enter completion

`registerBlockCompleter` is the opener's sibling for a grammar whose lines must be adjacent, which Enter alone can never type into existence. An opener recognizes a line while parsing; a completer reads the one line the user just typed at an Enter press and answers the lines that complete it. Block math is the validating consumer (`$$` plus Enter inserts the fence pair with the caret in the body); without the plugin the same line splits like any other paragraph.

```ts
import { registerBlockCompleter, type CompletionResult } from '@voithos-labs/aragonite/plugin';

registerBlockCompleter(MATH_BLOCK, {
	tryComplete(line): CompletionResult | null {
		if (line.trim() !== '$$') return null;
		return { lines: ['$$', '', '$$'], caret: { path: [], line: 1, column: 0 } };
	}
});
// type `$$`, press Enter: the paragraph becomes those three lines, caret on the empty middle one
```

Register-once per kind, consulted in kind-name order, so which completer claims a line is a pure function of the declarations and never of install order (the openers' rule minus a priority no conflict has asked for). A claim whose result would paint nothing is declined, so a completer can't fabricate an invisible block.

What freezes is `CompletionResult`'s shape. Its `lines` carry **no line endings**: the completion machinery attaches the block's own, which is what keeps a completion from downgrading a CRLF document. Its caret is `{ path, line, column }`, not a byte offset; `path` is child indices inside the new block (empty for the block itself), and `line`/`column` address a position inside that node. Line-relative because the machinery picks the line ending after the claim, so only it can count bytes; an offset-shaped caret would drift a byte per preceding line ending the moment the document is CRLF. Growth is fields on the result, never a second registry.

### Renderer and opener utilities

- `createBoundedMemo`: a bounded LRU memo for a renderer's per-source work. Sync (with an optional clone-on-read for live DOM) or async (the value is the render promise, so in-flight work is shared and a rejection caches).
- `createScanIndex`: a memoized per-raw position index with an at-or-after lookup, for a recognizer's bounded-decline scan. Composes the bounded memo at cap 2, so the focused block and a neighbour interleave without thrash; the footnote and math recognizers are the validating consumers.
- `OPENER_PRIORITIES`: the published built-in priority ladder a plugin opener prices its own placement against. An offset from a named built-in, never a bare integer.
- `lineStartsOuterBlock` (with `OuterBlockScan`): the shared end-of-extent test for a container opener scanning its own lines: does this line start a block at the outer level, given whether a paragraph is open above it. Published so a plugin container ends its extent where the built-ins end theirs, rather than re-deriving the paragraph-interrupt exceptions.

### Container authoring

`createContainerBlock` wires a nested-`BlockList` container (list state, ancestor contexts, nested actions, windowing, the `BlockComponent` surface) so a plugin container is as thin as the built-in blockquote. It returns a `ContainerBlock`, whose `containerApi` is the `ContainerBlockComponent` (the container methods it always supplies, typed as required) and whose `blockListProps` are the props for the `BlockList` component itself, on the barrel because the plugin's own markup mounts it. A container publishes that surface as ONE instance export, `containerApi`. Svelte 5 instance exports are individual top-level declarations with no spread, so hand-forwarding a dozen members was a per-member hole, and BlockHost resolves the two publication shapes (a leaf's own surface, a container's `containerApi`) at the single point it stores a ref. The component registry's exports type is what makes the missing export a compile error. `BlockComponentProps` names the props BlockHost passes every component.

A container may contribute an ambient prefix (the read-only marker a container lends its first prose child, the way a list lends `- `) through the factory's optional `getAmbientPrefix` dep, a live getter forwarded to the nested list as `ambientPrefixForFirst`; the footnote definition's `[^label]: ` marker is the validating consumer. The prefix's shape, interactive ranges included, is `docs/design/editor.md` § Ambient markers.

**Taking the changed-child hint.** A `rebuildRaw` that re-emits one child's region needs to know where each child's bytes sit in its own raw, and the only sanctioned home for that is `node.childSpans`. It's the field the editor's own machinery retires: every settle (the pass that re-derives blank-line separators after a splice) that moves a sibling's separating line or a wrap slot drops it, the commit-time rebuild reseeds it, and G1.36 counts it against the children. Offsets cached anywhere else, in plugin metadata, a module map, a `WeakMap`, are invisible to all three, and the dev-only backstop that re-derives behind a splice (G1.38) lives inside the built-in container shapes, not inside a plugin's own rebuilder. Declining the hint and re-deriving the whole raw is always correct, and the container conformance case compares a hinted rebuild against a full one for every registered kind, which proves the choice either way.

### Editable chrome

One `registerChromeLeaf` call binds a container's title or summary leaf with a default keymap (Enter descends to the body; chord-keyed overrides). The container _declares_ its chrome slot on its descriptor, and the machinery enforces the **reserved-chrome contract**: the slot is always present, single-line (unsplittable; paste flattens inline), cleared rather than node-deleted by destructive ranges, and kind-stable through every edit. `chromeChild` builds that reserved child-0 node (the title text plus its trailing newline) for an opener constructing the container.

### Collapsible containers

The declaration optionally carries a pure collapse probe, `isCollapsed` over the node. From that one declaration, every child-adjacency operation is collapse-aware: merge from below, focus walks in and out, Enter-descend, reveal (mounting an off-screen block so its DOM exists before something touches it). The container factory derives its window clamp from the same probe, and since the body genuinely unmounts there's no separate collapse dep to thread; the height oracle estimates a collapsed container at one chrome row. `isCollapsedContainer` reads the probe off the descriptor, so a component's own disclosure UI and the model-layer walks share one definition.

The factory also returns a metadata-commit handle, `updateOwnMetadata`, for behavioral fields like a collapsible's open state: merged, raw-rebuilt, and undoable in one commit. In reading mode, which writes no bytes, the handle declines as a no-op, and dev builds warn naming the kind.

Beside the probe sits its inverse: `expandPatch` returns the metadata patch that opens a collapsed node. A reveal aimed at a clamped-out body child (a toc entry, a search match) opens the node before descending, and it commits that patch through the same handle the disclosure toggle uses, so the expansion is a real undoable edit rather than a view-only divergence from the CST, and reading mode, which commits nothing, expands nothing. Every collapsed ancestor on the path opens, outermost first, one undo entry each. A kind that declares no `expandPatch` reveals exactly as it would without one: the target stays unmounted and the reveal reports that it didn't land.

### Editable-leaf authoring

`createEditableLeaf` is the container factory's sibling for leaves: thunk deps (`getNode`/`getIndex`/`getPath` plus `getEl()`, each a live read, so value-capture is unrepresentable on the frozen surface), its own context reads, and a returned surface the component re-exports as one-liners. Two modes: `plain` (always-editable, per-keystroke commits, prose undo batching, factory-owned view sync) and `render-primary` (component-owned render-versus-source swap, where the reveal-edit-blur cycle commits as one undo entry). `singleLine` is orthogonal to the mode: a kind whose bytes are one line takes Enter as a block split, folding first and then routing through the same `splitBlock` door a heading's Enter takes, instead of inserting a literal newline. Both halves land inside the one keypress, so the fold's commit is still in its undo batch when the split arrives and the pair shares an entry. Commits land through the block-edit ladder, the one shared entry every text edit crosses, so multi-block text structurally re-splits there. `StickyColumnDirection` (`'above' | 'below'`) is on the barrel because a leaf's `focusAtColumn` receives it; it says which side the caret arrived from. Block math is the render-primary validator; the `%%` memo harness kind is the plain one.

### Supporting descriptor fields

A few fields earn prose beyond their table row below. Context-dependent kinds have no standalone recognizer and are kept through edits. An opaque container contract says raw is authoritative, not a strip decomposition. `blockFocus: 'whole-block'` opts an opaque childless block into the focus-then-delete model: arrow traversal stops on it, a caret-adjacent Backspace focuses it before a second press deletes, and the merge-fallback twins focus rather than dead-ending. `getFocusEl` declares that focus surface rather than receiving DOM focus itself. The factory mounts a hidden editing host in the chrome box and lands focus there, because AltGr and IME input reach an editing host or nowhere; a declared surface that's itself editable keeps its own caret. All invariant-guarded.

`gapEdges` (`'before' | 'after' | 'both' | 'none'`) is the required gap-caret declaration. A kind whose surface traps the caret at one or both of its edges says so, and the boundary it shares with a sibling declaring the facing edge becomes a place a caret can park and a paragraph can be inserted; the gap caret itself (the caret parked between two blocks where neither surface can host one) is `editor.md` § The gap caret. `'none'` is the explicit answer that the surface, or an existing affordance, already covers insertion at both edges. The field is required rather than optional because an omission read as exactly that decision. A kind declaring `'none'` behaves exactly as an undeclared one did before the field existed, which is why the v1 set is deliberately narrow and later declarations cost no restructure.

`estimateHeight(node, { width })` is the optional height-oracle hook for windowing: an O(1) per-kind pixel estimate the oracle consults after the collapse probe and before its built-in default, so a kind that renders at a stable size (a Mermaid diagram at its skeleton height) scrolls right before it mounts. The measured cache still supersedes it, and a collapsed container still estimates at one chrome row (`docs/design/virtual-rendering.md`).

### The descriptor field reference

The registration shape freezes at 1.0, so the descriptor's width is part of what freezes, and this table is the inventory. Every row is a cross-cutting fact some subsystem reads instead of branching on kind, which is what earns each of them a place; the table keeps the width legible, and the admission bar at the end keeps it from growing by habit. A lint (G4.53) keeps this table and `BlockKindDescriptor` identical in both directions, so a field can't land undocumented and a row can't outlive its field.

_Tier_ is the kind class that can meaningfully declare the field. `container` marks the nine registered inside the `container` group, where the leaf/container split is a compile error rather than a convention. `whole-block` and `grid` name the tier the field creates or presupposes, which is a property of the rendered block rather than of its registration: a container that parses childless is a whole-block unit, and `blockFocus` is how it says so. `leaf` marks the fields a kind with its own text surface declares; `any` marks the rest. Semantics live on the type (`src/lib/schema/block-kind-descriptor.ts`); this table carries only what the field is for, and what leaving it out means.

| Field                   | Tier        | Omitted means                                                            | What it declares                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mergeRole`             | any         | required                                                                 | The kind's role when Backspace tries to merge it with a neighbour                                                                                                                                                                                                                              |
| `editable`              | any         | required                                                                 | Whether the kind carries text of its own; a non-editable kind is skipped by the document scan                                                                                                                                                                                                  |
| `closure`               | any         | required                                                                 | The kind's written answer to every cross-cutting editor system (the section "Editable content and the closure matrix" below)                                                                                                                                                                   |
| `supportsInline`        | any         | required                                                                 | Whether the kind's raw carries inline syntax the inline parser processes                                                                                                                                                                                                                       |
| `isContainer`           | any         | derived, never declared (the `container` group's presence is the answer) | Whether the kind holds children                                                                                                                                                                                                                                                                |
| `containerContract`     | container   | required with the group; registered as `container.contract`              | The raw-to-children relationship: strip, grid, or opaque                                                                                                                                                                                                                                       |
| `rebuildRaw`            | container   | required with the group                                                  | Recompute the container's raw from its children and metadata. A second argument names the one child whose raw moved, for a rebuilder that can re-emit that child's region alone; ignoring it is always correct, and a kind that takes it keeps its offsets in `node.childSpans` (above)        |
| `bodyWrap`              | container   | the body opens on the container's own first line                         | The wrap the opener parses the body with, when chrome lines bound it                                                                                                                                                                                                                           |
| `bodyWrite`             | container   | a child's bytes are written verbatim                                     | Make text legal as a child's bytes inside this container's body                                                                                                                                                                                                                                |
| `reservedChrome`        | container   | child 0 is an ordinary body block                                        | Child 0 is a reserved chrome leaf, optionally with a collapse probe and an expand patch                                                                                                                                                                                                        |
| `containerPaste`        | container   | a same-kind clipboard top nests as a sub-container                       | How a clipboard top merges into a same-kind ancestor instead                                                                                                                                                                                                                                   |
| `unwrapRole`            | container   | default Backspace dispatch                                               | What Backspace at the start of this container's children does                                                                                                                                                                                                                                  |
| `contentStartSpace`     | container   | a space at a child's content start types normally                        | A space typed at an empty child's content start completes the marker                                                                                                                                                                                                                           |
| `reorderChildren`       | container   | children are not independently reorderable                               | Direct children reorder among themselves, optionally renumbering markers                                                                                                                                                                                                                       |
| `blockFocus`            | whole-block | the caret walks through the block's own offsets                          | Opts a childless opaque block into the focus-then-delete model                                                                                                                                                                                                                                 |
| `foreignDragHitTest`    | grid        | the block has no interior a foreign drag can address                     | Viewport point to internal offset for a drag, declining off-region                                                                                                                                                                                                                             |
| `caretTargetAtPoint`    | grid, leaf  | the block resolves a point through its own DOM                           | Viewport point to child path plus offset, total within the block's box; a render-primary leaf names an empty path and the source offset its reveal click lands at. The point half is `caretOffsetAtPoint` on the plugin barrel, so the kind writes only the arithmetic between its two strings |
| `normalizeRawWrite`     | leaf        | bytes are written verbatim                                               | Make text legal as this kind's own bytes, at every write sink                                                                                                                                                                                                                                  |
| `contentStartBackspace` | leaf        | Backspace at the content start takes the merge cascade                   | Backspace at the content start gives up the kind's own structural bytes first                                                                                                                                                                                                                  |
| `renderImagesAsWidgets` | any         | inline images render as widgets; read only where inline content renders  | Opt an inline-bearing surface out of image widgets, back to the alt-only fallback                                                                                                                                                                                                              |
| `contextDependentKind`  | any         | the kind's raw reparses to itself                                        | The kind has no standalone recognizer, so an edit keeps it rather than re-deriving                                                                                                                                                                                                             |
| `gapEdges`              | any         | required; `'none'` says the surface hosts insertion at both edges        | Which of the block's edges get a gap caret                                                                                                                                                                                                                                                     |
| `getContentRange`       | any         | the content is the whole display                                         | Where content starts and ends inside raw, past the kind's own markers                                                                                                                                                                                                                          |
| `keymap`                | any         | only the global table answers                                            | Per-kind chord-to-command bindings, consulted before the global table                                                                                                                                                                                                                          |
| `estimateHeight`        | any         | the oracle's own prose estimate                                          | An O(1) content-height estimate in px for windowing                                                                                                                                                                                                                                            |
| `conformanceFixture`    | any         | the kind enrols in no fixtured conformance cell                          | Markdown that parses to a tree holding this kind                                                                                                                                                                                                                                               |

**Combinations the types cannot refuse.** Most illegal pairings are already unrepresentable (a leaf declaring a container field) or fail at registration (the closure cells against the rest of the descriptor, an unknown merge role, `contentStartBackspace` without `getContentRange`, a declared unwrap strategy nobody implements). Five more fail at registration as descriptor-versus-descriptor coherence: `contextDependentKind` beside a registered opener, `blockFocus` beside either `supportsInline` or `reservedChrome`, and `reservedChrome` beside either a lifting `firstChildBackspace` (the lift would carry the chrome row out) or its absence where the strategy declines for chrome the kind never reserved (a dead key). What stays prose-only is the class no declaration can decide: whether a kind's surface genuinely traps the caret at the edge it claims with `gapEdges`, and whether a hook patched in after registration (`estimateHeight`, `caretTargetAtPoint`, `foreignDragHitTest`) belongs to a kind whose box has interior addressing at all. Both are answered by the kind's component, which the registry never sees.

**The admission bar.** A new field on this table must bring four things. It states a **cross-cutting** fact that more than one subsystem reads, or it belongs on the component or in the plugin's own options. It's **not derivable** from fields already here. Its **omission means today's behavior**, so every registration that predates it stays correct unchanged. And it **arrives with its guard**: a registration check, a conformance cell, or a shape that makes the wrong declaration a compile error, per the ladder in `docs/design/invariants.md`. A field that brings only the first is a component prop wearing a registry's clothes.

### Presentation-mode reads

`PresentationMode` (`'source' | 'reading' | 'preview-block' | 'preview-inline' | 'live'`) is the vocabulary. Every read reports the **effective** mode, and with every rung built (a rung: one level in an ordered ladder) the effective mode equals the requested one; the resolve step stays, and every read routes through it. One vocabulary, four read paths:

1. the live `presentationMode` prop, reflected as `data-presentation` on the editor root (absent in source, so the default DOM stays byte-identical);
2. an internal block-facing context getter that joins the prose render key, so a mode flip re-renders every mounted prose block; both preview rungs reveal via the focus-keyed attribute plus, for `preview-inline`, a caret-chain class flip on stamped marker spans (CSS only: neither a per-block focus change nor a caret move ever rebuilds the inline DOM);
3. `EditorContext.presentationMode` (a live getter) plus the `presentationModeChange` event;
4. the leaf and widget tiers: `EditableLeaf.getPresentationMode()`, the live `getPresentationMode` getter mounted beside an inline-widget component's frozen snapshot, and `InlineWidgetEditingContext.presentationMode`.

**Mode litmus: handle non-exhaustively.** The union is five values today and has grown once already, so a plugin that switches exhaustively over it is wrong by construction: the next rung is an addition to the union, not an API break. Read the one property your rendering actually depends on (most often "does this mode paint markers", or "does it write bytes") and default the rest. The platform's own read sites are written that way, which is why the live rung activated with zero plugin-facing change.

The editor's THEME travels the same four paths (`EditorContext.theme` plus a `themeChange` event, the container and leaf factories' `getTheme()`, the inline-widget `getTheme` prop). It exists for the one thing CSS can't reach: content whose colors a rendering engine paints into its own markup, which must be redrawn rather than restyled.

Reading mode's read-only enforcement lives at the platform's own boundaries: both chord dispatchers dead-key (a pressed chord does nothing), the editable leaf never reveals or commits, the container factory's whole-block edit branches gate. A plugin inherits the inertness without writing mode code; it reads the mode only for its own edit affordances and mode-dependent rendering ([the guide's presentation-modes section](../guide/plugin-guide.md#presentation-modes) is the authored contract statement). The contract is that the mode writes no BYTES, not that nothing responds. A view-only affordance may stay live there (the bundled details disclosure does), which the platform supports by taking the effective collapse state as a dep rather than by relaxing any gate.

### Paste transforms

`registerPasteTransform` records a content-keyed, pre-parse rewrite of pasted plain text: named, register-once (a duplicate throws, attributed to the owning plugin), run in install order at every paste site before the parse. It's **paste-scoped and content-keyed**, distinct from the internal, target-kind-keyed `registerPasteSurface` (which stays unexposed): a transform keys off the clipboard _content_ it recognizes, not the block kind the paste lands in. That's the shape the GitHub-alert-to-admonition conversion needs, and it validates the post-1.0 conversion-config direction early.

### Inline authoring

The inline mirror of the block surface: an inline-kind brand with an idempotence probe (`declarePluginInlineKind`, `declaredPluginInlineKind`, `isInlineKindDeclared`); an inline-syntax recognition hook (`registerInlineSyntax`, where the plugin hands the scanner a trigger character and a recognizer); and an inline-widget editing registry (`registerInlineWidgetKind`, carrying a per-kind `InlineWidgetEditingPolicy` on the `InlineWidgetDescriptor`, plus `InlineWidgetEditingContext` and `InlineSyntaxRecognizer`; `InlineNode` is on the barrel) that gives a plugin inline kind atomic, caret-addressed editing. `mintWidgetShell` builds the atomic-widget shell a `buildWidget` fills, so a recognizer inherits the source-range attributes the offset walk reads rather than hand-stamping the handle the caret depends on. KaTeX is the validating consumer, with the renderer injected, not bundled.

The freeze-time decisions riding this surface:

- **Recognition precedence: the priority ladder (shipped).** The bare hook fires only for a trigger no built-in scanner claims; built-in delimiter dispatch runs first, and a bare registration on a claimed trigger (`` ` `` `&` `<` `*` `_` `~` `[` `]` `!` `\` newline) still throws, because a silent no-op is the one failure a public API must not have. A reserved trigger is reachable through the **prefix-recognizer tier**: a registration carrying a multi-char `prefix` that begins with the trigger and a `priority` below `INLINE_PRIORITIES.builtin`, consulted before the built-in case so it can outrank it on the longer prefix (footnotes' `[^` beating `[`). Rungs on one trigger coexist and dispatch deterministically, priority ascending, then prefix length descending, then prefix lexicographic, so registration order never matters, mirroring the block layer's `OPENER_PRIORITIES`. The tier is **additive**: the base signature and its bare-reserved throw are untouched. Unterminated constructs fall back by construction: a `[^` that never closes falls back to the built-in's reading, never a hang, never a byte change (the prefix rung declines, `handleOpenBracket` runs, bytes and nodes identical to a clean scan). The pre-freeze footnotes probe (0.9.30) validated the bare-reserved throw end-to-end and turned the tier from a sketch into this shipped surface; footnotes is its validating consumer.
- **Builder injection (resolved).** Three builder paths coexist: the recommended `component` (a Svelte component mounted through the render layer's injected portal builder and kept live across per-keystroke rebuilds by a keyed reuse pool), the stateless registry `buildWidget`, and image's stateful builder on the internal `augmentInlineWidgetKind` hook, which stays unexposed. The descriptor gained an optional `component` field (mutually exclusive with `buildWidget`) plus the `InlineWidgetComponentProps` shape on the barrel, and KaTeX inline migrated onto the component path as the validator. A component widget's mount also carries the live `getDocument` getter, the read-only root document view for derived display state, the inline mirror of `BlockComponentProps.document` (§ The root document, below). It's required getter-form on the render deps so a value capture is unrepresentable; footnote-reference numbering is the validating consumer.
- **Widget navigation (shipped).** A component widget that points elsewhere in the document carries `navigateTo`, the editor's `EditorRects.navigateTo` threaded down the same explicit-dep road as `getDocument`, so a widget reveals, scrolls and lands the caret without reaching for a context of its own. The gesture it rides is the link click's: `isWidgetActivationClick` is the one predicate for it, and `InlineWidgetEditingPolicy.claimsActivationClick` is what the surface reads at the one place it decides whether to reveal, to stand the source reveal down for exactly that gesture. A widget swapped for its source bytes under the click would unmount before it could act. The footnote reference's jump to its definition is the validating consumer, and the definition's own marker takes the same gesture back, landing at the offset just past the citation. That same place also owns the double-click: the second click of one takes the whole revealed token, since the first click reveals and the browser's word rule would otherwise take a lone delimiter.
- **Editing policy: two declared fields (shipped).** `InlineWidgetEditingPolicy` carries `deleteGranularity` (`'atomic'`, one press deletes the widget whole; `'select-then-delete'`, the first press selects it and the second deletes, the image's two-press default) and `onEdge` (`'select'`, an edge press takes the construct whole; `'step-over'`, the caret crosses it like a character). One caret-edge dispatch (`components/blocks/text/edge-policy-dispatch.ts`) reads both off the registration, by kind, and the inline conformance kit checks a declaration against the type's own vocabularies rather than a copy of them. The built-in decoded-entity widget (`&copy;` becomes ©) is the validating consumer, with `{ deleteGranularity: 'atomic', onEdge: 'step-over' }`; the bundled emoji plugin declares the same pair.
- **Writing back a borrowed kind: the rewrite hook (shipped).** A recognizer may produce a **built-in** kind over bytes of its own, which is how an Obsidian-style embed becomes a real image rather than a decoration painted over bytes the tree never sees. The read paths need nothing more; the write paths do, because the editor's inverse for a built-in kind emits that kind's grammar, so a resize once re-serialized the embed as GFM and destroyed the author's syntax. `InlineSyntaxOptions.rewriteImage` is the way back: the edit hands the recognizer its node's current source and the fields the edit produced, and takes the replacement bytes, or `null`, meaning the edit has no form in that grammar.

  ```ts
  registerInlineSyntax('!', recognizeEmbed, {
  	prefix: '![[',
  	priority: INLINE_PRIORITIES.prefixOverride,
  	// (source, fields) => string | null; fields is { alt, url, title?, width?, height?, label? }
  	rewriteImage: (source, fields) => (fields.title ? null : `![[${fields.url}|${fields.alt}]]`)
  });
  ```

  **The default is a decline, not a fallback**: no hook, or a `null` return, and no commit happens at all. That places the rule at the single write point every image gesture crosses rather than at the render surfaces that draw the affordances, which is the only placement that covers the properties popover and a hook that accepts one edit and declines the next. The scan stamps the claim on built-in kinds only; a plugin's own kind has no editor-side grammar to be rewritten into, so the stamp would have no reader. `ImageSyntaxRewriter` and `ImageFields` are on the barrel. Additive: a recognizer producing only its own kind is untouched, and `image` is the sole built-in kind with a field-to-bytes write path today; a second one extends the same claim.

- **Memoizing over the whole document: the content version (shipped).** A widget whose display depends on the whole document (footnote numbering) derives per widget, so a flush costs O(widgets × leaves), and the document can't be its own memo key: the editor's `$state` document is mutated in place, so its identity survives every edit and an identity-keyed memo would hit forever on a stale answer. `InlineWidgetComponentProps.getContentVersion` is the key the surface was missing: a number that changes whenever the document's serialized bytes change, read INSIDE the widget's derived so the one read is both the reactive subscription and the memo key, turning the flush into a single shared walk. Its shape is what distinguishes it from the decoration engine's `editEpoch`, and says which to use when. Both move once per document change, the epoch one `tick()` behind the version it rides, but the version is a **reactive** read, so a widget's derived subscribes to it by reading it, while the epoch is a plain number handed in. An inline widget renders mid-burst and needs the version; a decoration source runs only from `provide`, which the epoch already drives, and needs the epoch. The editor announces the version at each entry that writes the document's bytes, so it costs O(1) per edit whether or not anything reads it, and the getter is optional so a bare harness mount still renders, walking unshared. Footnote-reference numbering is the validating consumer.
- **A claim begins at its trigger (limitation, additive to lift).** A recognizer is called at the trigger position and must return a node starting there; nothing lets it reach leftward over bytes already scanned. So a grammar whose significant character sits in the middle of what it claims (GitHub's cross-repo `user/repo#123`, where the trigger is `#` but the construct starts at `user`) can't be expressed as one recognizer today. It's a real gap, not a rejected shape. The fix is an optional lookbehind on `InlineSyntaxOptions` (how far left the recognizer may claim, bounded so the scan stays linear), which is an addition to the options bag and breaks no bound recognizer. It rides the post-1.0 inline-syntax work rather than the freeze.
- **Error rendering (additive-later).** No shared error-render hook; each renderer handles its own errors (the KaTeX path renders a legible inline message). One gets added only if a second renderer starts duplicating it.
- **Construct policy rows: editor-internal at 1.0.** Live mode's per-construct editing behavior (edge affinity, unwrap-on-empty, split behavior, revealability, the link card's reach, and the mark vocabulary a format chord writes) is a declared row per inline kind in `schema/inline-construct-policy.ts` (`docs/design/live-mode.md` § 3). The table is data, and its registrar's mark validator already reasons about plugin kinds, but the registrar is on neither barrel, so at 1.0 the table holds **built-in rows only** and a plugin construct inherits the no-row default: no live edge behavior, and no format chord addresses it. Opening this up is additive-later and deliberately not taken pre-freeze. `nestingRank` is a bare integer into a process-global order with no published ladder, and exporting a row type whose ordering contract is unstated is the "binding a shape you would only be guessing at" case. It opens with a named rank ladder beside `OPENER_PRIORITIES` and `INLINE_PRIORITIES`, its reset wired into `resetPluginPlatformForTests`, and a policy cell in the inline conformance kit.

### Directive authoring

One shared opener owns the `:::`/`::`/`:` fence family and dispatches by name (`registerDirective`, probed by `isDirectiveRegistered`) across three tiers, container, single-line leaf, and atomic inline text, so N plugins never collide on opener priority. A registered name renders through its own first-class kind; an unregistered name round-trips byte-for-byte through a generic fallback, so a document survives its plugin being uninstalled.

The `fromDirective` factory is required for container, optional for leaf, and rejected for text (kind-only), enforced at registration. `parseDirectiveAttributes` is an opt-in, one-way `info → { label, id, classes, properties }` reader over the remark convention; the verbatim opener info stays the round-trip truth. `serializeDirective` writes a fence back without losing a byte, and `createDirectiveRebuild` builds the `rebuildRaw` for a directive container whose child 0 is an editable title, owning the title-to-opener mapping, body serialization, and CRLF line-ending threading. Two smaller symbols carry rules a hand-built fence would otherwise get wrong. `escalatedColonCount` is the fence-length rule `serializeDirective` already applies, exported for an emitter that concatenates `:::name` text instead of going through the CST, where a body line reproducing the fence would close the container early. `DIRECTIVE_BODY_WRAP` is the wrap every `:::` body parses with, which a directive kind declares as its `container.bodyWrap` so the editor's separator settle knows the blank line against the fence belongs to the fence.

Activation is the explicit idempotent `activateDirectives()` call, not an import side effect: the authoring symbols alone don't claim `:::`. See [the directives guide](../guide/directives.md).

### Commands

`registerBlockCommand` binds a `(kind, name)` block command and hands back its id, a branded name minted the same way kinds are, which the plugin then binds in its kind's keymap (`CommandId` names a built-in command a binding can target; `KeyBinding` is the per-kind chord-to-command shape; `AnyCommandId` spans both). Dispatch reaches the two surfaces that can supply a handler its context, the editable leaf's keymap and the container bubble, and that context carries the mounted component's own view-state handles (`ctx.hooks`, threaded by the container and leaf factories' `commandHooks` getter), so a view-state command drives the live component with no node-keyed side map. It also carries `ctx.editor`, the dispatching instance's `EditorContext`, for document, events, and options reads. Anything more arrives as another field on this one context, never as a second context object, and `setup(ctx)` grows the same way, as fields on the one `EditorContext` a global command already receives. That's the pin, and the one real break it guards against: a handler bound today meeting document mutation as a different object tomorrow. Which fields is left to the first consumer that needs one.

`registerGlobalCommand(name, handler, { chord? })` is the editor-wide sibling: a process-wide command whose handler receives the dispatching instance's `EditorContext`, the same object `onEditor` hands out, so it fires regardless of which block holds focus. An optional chord binds in the **plugin-global tier**, which resolves last, after every consumer override, built-in kind keymap, and built-in global chord. Built-in chords and the reserved search chords (`Mod+F` / `Mod+H`) are unstealable, and a collision throws before the command id exists, so a failed registration leaves no orphaned name behind.

```ts
import { registerGlobalCommand } from '@voithos-labs/aragonite/plugin';

const INSERT_DATE = registerGlobalCommand(
	'insert-date',
	(editor) => {
		// editor: the dispatching instance's EditorContext, the same object onEditor hands out
		return true; // handled
	},
	{ chord: 'Mod+Shift+D' }
);
// INSERT_DATE: PluginCommandId, the string 'insert-date' branded; a consumer's editor.runCommand(INSERT_DATE) reaches it

registerGlobalCommand('find-things', handler, { chord: 'Mod+F' });
// throws before any id is minted: plugin global chord "Mod+F" is reserved by the editor UI (search) ...
```

A handler throw is contained at the dispatch boundary and surfaces as an `error` of origin `command`, attributed to kind (block) or plugin (global), command, and owning plugin. A block command bound on a built-in kind's leaf dead-keys, since those surfaces supply no context.

**A minted _block_ command is chord-reached, not consumer-reached.** The instance's semantic command entry (`editor.runCommand(id)`, documented with the rest of the instance surface in `docs/guide/consumer-guide.md`) resolves the focused surface without a command context, so a block-minted plugin id finds no handler there and dev-warns. That boundary is part of what freezes: a plugin exposes a keystroke-free _block_ affordance by binding a chord or by publishing an API of its own, never by expecting the consumer entry to enumerate its ids. Lifting it later means widening the id space, which is additive. A **global** minted command sits outside the boundary by design, since `runCommand` resolves the global tier first, so its name is directly runnable and admissibility-readable.

### The root document, in a component

`BlockComponentProps.document` delivers the read-only root document to every block component at any nesting depth; a component otherwise sees only its own node. A table-of-contents block reads the headings above it through this prop, and the `toc` dogfood is the validating consumer, reading it at a nested depth so the delivery is pinned on both of BlockHost's dispatch branches. It's a **read-only** view: single-document derived state is the editor's boundary, and mutation stays a commit-time concern.

### Decorations

The view-only annotation layer, the capability everything that owns no syntax was waiting on: spellcheck, ghost text, inline comments, badges, occurrence highlights. A decoration never enters the CST. A plugin registers a named, per-instance **source** through `EditorContext.decorations` (a consumer through `getDecorations()`), the engine re-runs every source once per document edit, and the results are bucketed by block path for the render layer. A source is **pure over the document plus its own state**; there's no mapped-forward decoration set, because positions are `(path, offset)` into a tree re-derived per edit (see [Deferred and excluded](#deferred-and-excluded), plugin-local state). The handle returned by registration carries `invalidate()`, synchronous by contract (the new result is queryable before it returns), and an idempotent `dispose()`. A throwing source is contained: the error surfaces on the `error` channel attributed to the source, and its prior decorations are retained rather than blanked.

```ts
ctx.onEditor((editor) => {
	const handle = editor.decorations.addSource({
		name: 'stale-links', // per-instance unique; a duplicate addSource throws
		provide: (doc, { editEpoch }) => marksFor(doc) // pure over doc plus your own state
	});
	handle.invalidate(); // synchronous: the new result is queryable before this returns
	return () => handle.dispose(); // idempotent
});
```

Four decoration types, spanning the overlay and in-flow render paths:

- an inline **mark**: a positioned overlay span carrying the source's class. The same surface search's own highlights ride, since search is a decoration source of this engine; same-cell marks from multiple sources collapse to one rect with unioned classes.
- a zero-width **widget** island.
- a range **replace** island: the displaced bytes stay in the document and never leave `getSource()`.
- a whole-**block** treatment: class and attrs on the block host, plus an optional badge widget.

The union grows by addition: a new decoration type is a new member, a new capability on an existing type is an optional field, and a shipped member is never restructured. That's safe because a source _produces_ decorations and never switches over them; the editor is the only exhaustive consumer, so a new member is a render case on the editor's side, not a break on the plugin's.

Islands are atomic inline widgets with defined caret, arrow, and destructive-key behavior (see the closure matrix). Two authoring contracts earn a restatement here as well as in the guide: **widget identity is untracked by render keys**, so two specs at the same position with the same class are treated as equal, and a source varies `class` to force a re-render; and **`invalidate()` is synchronous**. Islands render on prose leaves and inside table cells (the cell surface applies them through the same code path, ambient length 0); only non-prose leaves (code, thematic break) apply none.

Cost contract: an idle source's per-edit re-run is O(sources), never per-block, and a block with no islands pays a byte-identical render key. Both are pinned by the perf suite.

### Rects

Viewport-space geometry over the rendered document, the read the decoration tier, selection toolbars, and trigger popups all bottleneck on. Reached through `EditorContext.rects` (plugin) and `getRects()` (consumer): a block's bounding box; the rects covering an inline range (per visual line on wrapped prose, per cell on grid surfaces, inheriting each surface's offset semantics, raw offsets on leaves, cell indices on grids, with the end marker meaning "through the last measurable position"); the live native caret (null in cross-block mode, where the parked native range must not leak out as a caret); a `reveal` that mounts a windowed-out block before measuring it; and a `scrollTo(path, { block })` that reveals then scrolls.

Reveal-and-scroll splits into two responsibilities: `scrollIntoView` places the target once, but the **reveal anchor** (`cursor/reveal-anchor.ts`) mounts and holds it. Why holding is needed: a windowed-out target past undecoded images strands otherwise, because the images reserve height off-window and collapse to roughly zero on mount, so the document shrinks and the browser clamps the scroll off the target. `scrollTo` sets the anchor at the requested `block`, and the top-level windowing scope (a scope: one block list and its children, the unit windowing works in) re-asserts that placement on every post-mount measure pass, mounting the target at the anchored position and holding it through the shrink.

For the curious, the anchor's finer rules:

- The pin names the full target path, so a target nested in a container is held where the reveal put it rather than at its container's top, against churn outside the container, which is the reach of the root scope's own correction.
- The anchor is model-based: exact for `'nearest'` (a top-pin, where visibility is the contract, held by default; the search reveal band uses it), coarse for `'center'`, which `scrollTo` refines to exact placement with `scrollIntoView` once mounted, then releases, since a persistent coarse pin would drift the centered target. `hold: false` hands the viewport back on any placement, which is what the consumer restore entry passes.
- One slot, but per-call ownership: each `scrollTo` claims it, a claimant may release only the pin it still holds, and a superseded reveal stops refining rather than fighting the newer one for the scroll. The user outranks every claimant: a keydown, pointerdown, or wheel in the document releases the slot.
- The returned boolean resolves only after the position settles, so `true` means genuinely in view.

`navigateTo(path, offset?)` composes the same reveal with a caret landing, at the block's start by default or at the offset you name (a footnote definition's marker jumps back to just past its citation). The landing runs the restore road `setSelection` and undo already share, so the cross-block range rules, whether a caret in a table lands on the cell or on the table, and a focus that undo can see all come from that one road rather than a copy of it. It's a member of `rects` and not a navigation object of its own for the same reason. Rects are real only in a browser, so the surface is e2e-validated; the selection-toolbar demo is the consumer validator. `getSelection()` reports a single-block selection's real anchor and focus offsets, so its geometry reads through `rangeRects` exactly like the cross-block case.

**`getRects()` versus `.rects` is a convention, not a divergence.** The two audiences reach the same object through deliberately different shapes, and each shape is uniform across its whole surface. `EditorInstance` is a **method-based handle**: every member is a call, because a consumer holds it through `bind:this` across the component's whole life, and a property read there would hand back a value captured at an arbitrary moment. `EditorContext` is a **live-read property bag**: every member is a `readonly` property, several getter-backed (`document`, `presentationMode`, `theme`), because a plugin's `setup` runs once and its callbacks re-read on every invocation, and a getter gives them that. Neither surface mixes the two forms, so an author never has to remember which member is which: `getEvents()`/`events`, `getDecorations()`/`decorations`, `getRects()`/`rects` all follow the same rule. Growth stays inside it and on the same object: a new consumer read is a new method, a new plugin read is a new getter-backed property, never a second geometry surface.

## Payloads bound as-is

These ship today and are part of what plugins observe. They're frozen _as the current shape_, but because they're payloads consumers _receive_, new fields and new union members can be added later without breaking a receiver.

```ts
editor.events.on('edit', (e) => e);
// { op: 'input', path: [2], detail: { byteLength: 1 }, timestamp: 1788390000412 }
// { op: 'split', path: [2], detail: { at: 14 }, timestamp: 1788390001033 }
// { op: 'delete', path: [1], detail: { crossBlock: true }, timestamp: 1788390004120 }

editor.events.on('error', (err) => err);
// { origin: 'command', error: TypeError(...), context: { kind: 'callout', command: 'callout.toggle', plugin: 'callouts' } }
// { origin: 'decoration', error: RangeError(...), context: { source: 'stale-links' } }
```

- **`EditEvent`**: `{ op, path, detail, timestamp }`, where `op` is the `OperationKind` vocabulary derived from `OperationDetailMap`. Emitted from the commit ceremony (the fixed steps a commit always runs) for structural ops, and from the keystroke-debounce flush as `op: 'input'`. A plugin's metadata edit (`updateMetadata` on a command context, `updateOwnMetadata` off the container factory) emits `op: 'metadataUpdate'`; the vocabulary is the editor's, and a plugin can't add an op to it yet ([Target shapes](#target-shapes-designed-ahead)).
- **`EditorError`**: `{ origin, error, context? }` with `origin` in `'subscriber' | 'render' | 'commit' | 'command' | 'decoration' | 'clipboard' | 'link'` and `error: unknown`, which is correct for a boundary. Routed through the `error` event channel with a recursion guard.
- **`SelectionPoint`**: the between-blocks gap caret sits _outside_ this union on purpose, and `getSelection()` reads null while a gap is live. Publishing a gap position later arrives as an additive read-side shape, never a new union member every consumer must switch over.
- **The undo stack has no public shape at all.** No frozen type exposes the stack or its entries, and the `edit` event's `undo`/`redo` variants stay representation-agnostic, so a collaboration or version-history representation adopted later stays additive rather than breaking a bound receiver.

## Editable content and the closure matrix

### The four tiers

Every mechanism for plugin content that is _itself editable_ falls in one of four tiers, each bound to a CST guarantee (prior-art record: `docs/research/plugin-extension-surfaces.md`).

| Tier          | Shape                                                                                 | Status               |
| ------------- | ------------------------------------------------------------------------------------- | -------------------- |
| Container     | children are real CST blocks in a nested BlockList; the contentDOM analog             | shipped              |
| Chrome leaf   | a reserved, single-line, plain-text child the container's raw owns                    | shipped              |
| Editable leaf | a recognizer-backed standalone text block with native caret/IME/undo/clipboard parity | shipped (pre-freeze) |
| Atomic widget | opaque non-text embed, caret-addressable at its edges                                 | shipped              |

A _general_ editable leaf shipped pre-1.0 as `createEditableLeaf`, beside the container factory; the chrome leaf stays narrower on purpose. The one shape rejected outright, a nested editor serialized as a blob, sits in [Explicitly excluded](#explicitly-excluded) with its siblings.

### The 0.9.18 lesson, and the rule it left

The standing lesson is the 0.9.18 whole-block-focus incident: the tier shipped **closed under 2 of roughly 9 cross-cutting systems and leaked 4 holes, found across three fix waves.** A new extension tier meets every editor subsystem whether or not its author considered them, so "it renders and round-trips" is a fraction of done, and a much smaller fraction than it feels like at the time.

**The rule.** Every extension tier, and every new per-kind capability on an existing tier, must define its behavior under each cross-cutting system _before it ships_: it fills its matrix row, a ✓ or a ledgered gap, never a blank. A blank cell is an unasked question, and that is how the 0.9.18 holes shipped.

**Every tier supplies `measurePartialRects`**, the childless opaque container included. A decoration is only as good as its worst-painting tier, so a tier that can't measure a partial range ships the whole annotation layer a hole the ecosystem inherits.

**The row is a type.** The matrix is no longer a doc checklist a reviewer might skip. `closure` (the kind's written answer to every cross-cutting editor system) is a required block on every block-kind registration, `Record<ClosureColumn, …>` makes a missing column a compile error, and the required field makes a missing block one, so a blank cell can no longer reach the tree. The cell vocabulary and how to fill a row are the guide's to teach ([the closure block](../guide/plugin-guide.md#the-closure-block)); what the contract pins is that the presets are sugar over this same field, not holes in it. `simpleLeafClosure` bakes the five structurally fixed columns of a not-mergeable, source-editable leaf and still demands the four the leaf's component determines (omitting one is a compile error); `containerClosure` is the sibling for a strip container; and the novel-tier row is always hand-written. G1.24 cross-checks the cells against the rest of the descriptor (a container's `roundTrip` must name its `rebuildRaw` rather than inherit the default, a `not-mergeable` kind's `mergeBackspace` can't inherit a default merge it doesn't have) and validates each declared `conformanceFixture` parses to its kind.

What's declared here is also _executed_: registering a kind enrolls it in a generic per-cell behavioral suite. The headless cells (round-trip, merge eligibility, byte-slice clipboard, undo, search degradation) run at registration, and the mounted-DOM cells run in a real browser: the conformance sweep drives focus, selection paint, and search paint per registered kind, a matrix row run rather than declared, with a new fixtured kind enrolled the moment it registers, while reorder and the simulation oracle (the simulation suite's corruption checks: does a long random editing session ever produce a document gone wrong) run in their own e2e, the drag and keyboard reorder specs and the note-taking simulation suite.

**The inline tier has its own harness.** A block kind's row is a type it must fill; an inline recognizer carries no descriptor to hang one on, so its equivalent is the `@voithos-labs/aragonite/testing` kit an author points at a registered recognizer, the third harness on that subpath beside the per-kind closure suite and the container one. It drives what a recognizer breaks without moving a byte: what it claims, that its claims tile the scan range it was given, that it declines the grammar overlap its prefix shadows, that its widget is one atomic unit the caret walk can measure, that its editing declaration is in the vocabulary the dispatch reads, and that a recognizer producing a built-in kind can re-serialize the bytes it borrowed. Four cells are declared per recognizer rather than derived, following the container kit's `terminatorCollision` precedent: required declarations, because every one is invisible to byte round-trip, and an optional cell is left undeclared by exactly the recognizers that need it. Two rules keep the kit from hollowing: fixtures are required and an unclaimed one fails rather than skips, and an excuse the kit can falsify, it falsifies. A recognizer on a reserved trigger can't excuse the overlap cell at all, since being consulted ahead of a built-in case is what creates the overlap.

### The matrix

The rows are the interaction tiers a caret meets; they refine the editable-content tiers above. The block-level **whole-block-focus opaque** tier, a childless opaque block that is its own focus target (a diagram, say), is split out from the **inline widget**, the atomic embed inside prose; the editable-content table folds that block-level case under Container.

_Legend: ✓ closed (defined + covered) · n/a structurally absent · ◐ partial (ledgered edge) · gap (ledgered hole)._

| Tier                     | Round-trip | Focus | Merge / backspace | Selection paint | Search paint | Reorder | Undo | Clipboard | Sim oracle |
| ------------------------ | ---------- | ----- | ----------------- | --------------- | ------------ | ------- | ---- | --------- | ---------- |
| Container                | ✓          | ✓     | ✓                 | ✓               | ✓            | ✓       | ✓    | ◐¹        | ✓          |
| Chrome leaf              | ✓          | ✓     | ✓                 | ✓               | ✓            | n/a²    | ✓    | ◐¹        | ✓          |
| Editable leaf            | ✓          | ✓     | ✓                 | ✓               | ✓            | ✓       | ✓    | ✓         | ✓          |
| Whole-block-focus opaque | ✓          | ✓     | ✓                 | ✓               | ✓³           | ✓       | ✓    | ✓         | ✓          |
| Inline widget            | ✓          | ✓     | ✓⁴                | ✓               | ✓            | n/a⁵    | ✓    | ✓         | ✓          |
| Decoration island        | ✓⁶         | ✓     | ✓⁷                | ✓⁸              | ✓            | n/a⁵    | ✓⁷   | ✓⁹        | ✓¹⁰        |
| Block decoration         | ✓⁶         | ✓¹¹   | ✓¹²               | ✓               | n/a¹³        | ✓¹²     | ✓¹²  | ✓⁹        | ✓¹⁴        |

1. **◐ Clipboard.** Both chrome directions round-trip the container: an end landing mid-chrome yields a chrome-only container, and a start landing mid-chrome reopens the container around the collected body, closing it where the walk leaves the subtree. What remains partial is the generic case the chrome pair sits inside: an endpoint landing in a container's body is skipped as an endpoint ancestor, so unless one of the four recovery paths applies, that container's wrapper is lost (issue #42; folded into the post-1.0 clipboard generalization).
2. **n/a Reorder.** A chrome leaf is the container's reserved child 0; it has no independent block identity to move.
3. **✓ Search.** A match inside a childless opaque container is found (the block's raw scans as a leaf), painted through the container shim's `measurePartialRects`, and navigable. Replace rewrites it too: the substitution lands in a private clone's raw and reparses, so the kind re-derives its own metadata. The one decline is kind-stability: bytes that break the opener line come back as a different kind, and a diagram must not silently become a plain code block.
4. **✓ Merge / backspace.** A caret-edge Backspace or Delete reveals the widget's source or atomically deletes it; block-level merge stays the host prose block's concern.
5. **n/a Reorder.** An inline widget isn't a block, and reorder is a block-level gesture. A decoration island is the same shape: view-only inline DOM, no block identity.
6. **✓ Round-trip.** Decorations never enter the CST, so round-trip holds by construction; the bytes a replace island displaces stay in the document and never leave `getSource()` (property-pinned over arbitrary island placements).
7. **✓ Merge / backspace / undo (island).** A widget island (zero bytes) is transparent: destructive keys act on the adjacent real byte, and at a true block boundary fall through to block merge. A replace island (hidden bytes) is selected whole by an edge press and deleted whole by the second, one CST commit and one undo entry, because silently eating one hidden byte would be invisible corruption.
8. **✓ Selection paint.** Sweeps measure and paint through islands normally. Deliberate zero-length case: a widget island spans no bytes, so it's invisible to selection cover rects. That's correct (nothing is selected), recorded so nobody "fixes" it.
9. **✓ Clipboard.** Excluded by construction: copy yields the raw byte slice, so a range spanning an island copies the real bytes, hidden bytes included, never the decoration DOM.
10. **✓ Sim oracle (island).** Beyond the standing mark source that runs the engine on every edit, a content-keyed island source paints a replace and a widget island in the loaded-ops document, and the decoration-ops session drives their caret walk, edge select-then-delete, transparent backspace, and adjacent typing under the corruption oracle stack. The decoded-entity atomic widget rides the same session.
11. **✓ Focus.** The badge widget mounts non-editable as the host's first child and must not capture focus or caret placement; the decorated block stays a fully functional editing surface.
12. **✓ Merge / backspace / reorder / undo (block).** A block decoration is source-derived, keyed by path: after any structural edit or restore, sources re-run against the new tree and the treatment lands wherever the source now points. Cleanup on change and dispose (class, attrs, badge removed) is e2e-pinned.
13. **n/a Search paint.** A block decoration adds no text; class, attrs, and badge carry nothing the document scan can match.
14. **✓ Sim oracle (block).** The same content-keyed source badges a block in the loaded-ops document; the decoration-ops session reorders it under load and asserts the treatment follows the bytes to the new path (and back on undo), with the corruption oracle stack re-checked after the move.

Host-surface parity holds across the two inline-widget capabilities that once lagged in table cells: **inline-widget reveal-to-edit** and **decoration-island rendering + edit** both run in a cell through the same code paths prose uses. The cell surface threads `createWidgetInteraction` and the caret-edge dispatch, and applies islands at ambient length 0. Cell-specific: every reveal or caret-edge commit re-escapes pipes and drops the prose trailing newline, so an edit can never split the row on reparse.

## The boundary, and who gets which type

What a plugin may and may not do, the editor-plugin-versus-app-plugin line, and the misuse-outcomes table (what each mistake does in a dev build versus production) are author-facing now and live in the guide: [What a plugin may and may not do](../guide/plugin-guide.md#what-a-plugin-may-and-may-not-do) and [Misuse outcomes](../guide/plugin-guide.md#misuse-outcomes). The invariant catalog (`docs/design/invariants.md`) is the enforcement record behind both.

What only this document carries is the type story. The rule: a surface that **reads** hands out a view (`NodeView` / `DocumentView`, bytes-readonly); a surface that **constructs, owns, or writes** keeps the mutable `CstNode` / `Document`. A freshly parsed document is owned, and mutable feeds view-typed parameters for free (covariance), so there's no conversion step, and no sanctioned view-to-mutable route exists on the plugin surface: mutation of the live tree goes through commits (`rebuildRaw`, metadata updates, commands).

```ts
const source: DecorationSource = {
	name: 'shout',
	provide: (doc) => {
		doc.children[0].raw = 'HELLO\n'; // compile error: raw is readonly on a DocumentView
		return [];
	}
};
```

| Surface                                                                                                                | Type    |
| ---------------------------------------------------------------------------------------------------------------------- | ------- |
| Component props (`node`, `document`), `EditorContext.document`, `DecorationSource.provide` doc                         | view    |
| Descriptor read hooks (`getContentRange`, `estimateHeight`, `reservedChrome.isCollapsed`)                              | view    |
| Command / widget-editing contexts (`BlockCommandContext.node`, `InlineWidgetEditingContext.node`), `getPluginMetadata` | view    |
| `parse` result, opener / directive-factory products, `chromeChild`                                                     | mutable |
| Write hooks (`rebuildRaw`, `setPluginMetadata`); the commit ceremony hands them owned nodes                            | mutable |
| Byte rules (`normalizeRawWrite`, `bodyWrite`): text in, text out; they see no node at all                              | strings |

## Target shapes (designed ahead)

What's still ahead, sketched just far enough that building any of it is an addition over a shipped shape rather than a rework of one. Nothing here has a consumer yet, and nothing here is frozen.

- **Plugin-op vocabulary extension.** A way for a plugin to contribute an `OperationKind` (and its detail type) so its structural edits emit typed `EditEvent`s and name themselves in `EditorError.context.op`. Additive over `OperationDetailMap`. Command-surface territory, waiting on the first plugin op that isn't a metadata update (those already emit `metadataUpdate`).
- **A `parse` error origin, and a structured plugin-error shape.** Both additive on `EditorError`, whose origins today are the seven in [Payloads bound as-is](#payloads-bound-as-is); neither has a consumer.
- **Normalize-on-commit / veto hook.** A sanctioned hook for a plugin to veto a commit or append derived mutations atomically within the commit ceremony (ProseMirror `filterTransaction`/`appendTransaction`, CM6 `transactionFilter`). Post-1.0: additive over the ceremony, whose internal shape plugins never bind, and built when a real consumer validates the hook shape (veto versus append, sync versus async). Invariant enforcement stays editor-owned; this augments a commit, it doesn't bypass the invariants. No frozen surface precludes the hook, and the constraint it must satisfy is aliasing: the owned-view, copy-path-on-write protocol (G1.9) has to extend to a plugin-contributed mutation inside the ceremony, not just the editor's own.

  Two of its constraints are already fixed by the ceremony rather than open. **One window, not many:** the ceremony is the one place a half-applied document exists, and no plugin code runs there today, an assertion the decoration engine already carries (`invariants/commit-scope.ts`), because a source reading mid-commit reads a tree between two consistent states. This hook would be the first plugin code inside that window, so it gets exactly one call per commit at one point, never re-entry; a second, later call would see a tree the ceremony has already validated and paths it has already checked. **The view it receives does not outlive the call:** the ceremony's owned scope views are one of the two sanctioned view-to-mutable crossings (G4.13), and an owned copy is only valid until it's published back through the `$state` tree, after which it must be re-read rather than held (design rule 5). A retained handle is therefore a stale write handle, which makes revocation-on-return part of the hook's shape rather than a caller discipline, the same synchronous-only boundary `PluginSetupContext` already enforces by throwing on a leaked context.

- **Per-recognizer editing policy for a borrowed built-in kind.** A recognizer that produces a **built-in** kind inherits that kind's editing behavior wholesale, because the caret-edge dispatch resolves policy by kind: an Obsidian-style `![[embed]]` produced as an `image` necessarily edits like a GFM image, same edge policy, same delete granularity. The only lever today is the internal `augmentInlineWidgetKind`, which changes behavior for every image in the document, the ones the plugin never claimed included. The additive shape is a **claim-keyed policy lookup layered over the kind-keyed one** (consult the node's syntax claim first, fall back to the kind), which preserves both key spaces rather than merging them; merging would break the built-in widget kinds, which carry policies and have no recognizer at all.
- **A plugin grid's selection in its own coordinates.** The descriptor already takes the two point-to-internals hooks a grid kind declares (`caretTargetAtPoint`, `foreignDragHitTest`), and only the built-in table declares the drag half today; `SelectionPoint`'s cell arm is that table's row-major cell index. A plugin grid addressing its own cells through that arm is post-1.0 and additive over both (the decision table's "selection coordinate-addressing").
- **Trigger-character suggest surface.** A `/` menu, `@`-mentions, `[[`-completion. The published rect surface plus `getSelection()` already make a suggest popup consumer-buildable, which is what keeps this additive: a first-class surface arrives as a new registration entry **over** those reads, never as a widened signature on one of them. Whether it deserves a first-class surface at all is a question a real consumer answers, not this document.
- **Unified command registry + palette.** One seam resolves every command id (the global tier, then a minted block command, then a built-in kind command), but the handlers live in two homes: a minted command in the `(kind, name)` registry, a built-in kind command on the component's own `runCommand`. So anything enumerating commands sees only the registry half. Retiring the component half onto the registry is internal work; the registry shape a plugin binds is unchanged, because a command is already a function of a context rather than a method on a view.
- **Declarative plugin manifest.** A `definePlugin` overload over the imperative unit. Awaits the post-1.0 reference plugins to validate.

## Deferred and excluded

### Deferred: the `EditEvent` snapshot/real-delta discriminant

Persistent version history (post-v1 app-infra) needs `EditEvent` to distinguish a real structural delta from a ceremony-borrow commit. It's deferred from this freeze on purpose, for three reasons:

1. **It's additive-later.** Adding a field to `EditEvent` never breaks a receiver, so it doesn't need to be frozen before plugins bind.
2. **Its binding consumer is a different milestone**, namely version history, not the plugin contract.
3. **Its meaning is unpinned and must be designed _with_ that consumer.** The naive derivations are wrong, and wrong in the quiet way you wouldn't catch until it mattered: a normal content keystroke commits with the undo snapshot _skipped_ (it's debounce-batched) and carries an internal `noop` structural-change descriptor, yet it _is_ a real document change. So neither "an undo snapshot was pushed" nor "the structural change was non-noop" identifies a real delta. The correct signal is a caller-declared "the user-visible document changed" flag at the commit sites, and that design is owned with the version-history layer.

### Explicitly excluded

- **Nested-editor interiors**, a second editor state serialized as a blob. A blob can't round-trip through the CST, and that ends the conversation.
- **Inline-parser _stage_ hook.** A hook that inserts a plugin stage into the inline parse _pipeline_, which is a different thing from `registerInlineSyntax`, the one that shipped and that hands the scanner a trigger character and a recognizer (§ Inline authoring). The stage hook remains excluded: widget-ness is a render-plus-model decision, not a parse-pipeline one, so no built-in validates it. Its real consumer is the post-1.0 inline-syntax work.
- **Runtime unregister / replace**, and with it registry-level replacement of a built-in kind's component or descriptor. Plugin System II. Registries are process-global, so an override would be global and last-writer-wins, which is the collision tax every surveyed ecosystem has already paid once. The supported replacement path is **grammar-level**: a plugin kind claims the syntax ahead of the built-in on the opener priority ladder, owns its own closure-matrix row, and proves it by enrolling in the conformance suite.
- **GitHub's repo-context sugar**: issue and PR refs (`#123`), `@`-mentions, cross-repo `user/repo#123`. It resolves against a repo or vault the editor doesn't own, so it belongs to the consumer rather than to the library.
- **Plugin-local state** (ProseMirror `StateField`/`PluginKey`, TipTap `addStorage`). Every other ecosystem has one; this one doesn't, and the omission is a decision rather than a gap. State belonging to a node goes _on_ the node, where it undoes, redoes, and, if it feeds `rebuildRaw`, round-trips. The other half of the need simply evaporates: a state field elsewhere mostly holds a decoration set and maps it forward through edits, which is forced on it by positions being integers into a flat sequence. Positions here are `(path, offset)` into a tree re-derived every edit, so a decoration source is a pure `doc → Decoration[]` and there's nothing to map. A plugin wanting state keeps its own `WeakMap` keyed on the editor id; the platform stores nothing and owns no lifecycle.
- **`registerPasteSurface`.** Built, used internally by the chrome and container machinery, and withheld. The driving use case (GitHub-alert to admonition) needs a content-keyed pre-parse transform, which a target-kind-keyed surface can't express: registering for prose kinds collides with the built-in defaults, and its type closure drags the commit coordinator public. Exposing it would freeze an export that fails the very case that motivated it. The content-keyed half shipped instead as `registerPasteTransform`.

## Enforcement

The contract's rules are guarded by the invariant catalog (`docs/design/invariants.md`):

- The view types (`core/node-views.ts`): every plugin-visible read surface is bytes-readonly at compile time, and the G4.13 lint keeps view-to-mutable casts confined to `tree-operations/` plus the commit ceremony.
- Readonly-view prop parity (G4.14): a block component annotating its `node`/`document` props with the mutable types is caught by a source-scan lint; the registration boundary erases prop types, so the drift would otherwise compile.
- Bundled-plugin import boundary (G4.16): a source-scan lint holds every file under `src/lib/plugins/` to the public authoring barrel, its own plugin dir, or, in a `renderer.ts`, its one declared engine, so a bundled plugin reaching a `$lib` deep path proves the barrel is missing a surface (fix the barrel, not the import). The bundled set is whatever ships under `src/lib/plugins/`, one `@voithos-labs/aragonite/plugins/<name>` subpath each; everything under `src/routes/test/plugins/` is a harness fixture and is never packaged.
- Opener coherence at bootstrap over the live registry, and kind-table completeness at bootstrap.
- Keymap coherence over the live registries: a plugin keymap's command ids validate against the minted `PluginCommandId`s (the earlier built-ins-only gap is closed), and a container's `reservedChrome` declaration gets bootstrap coherence.
- Closure-block coherence (G1.24): the required `closure` block agrees with the rest of the descriptor at bootstrap, and each declared `conformanceFixture` parses to its kind.
- Opaque-container staleness, rebuild determinism, and the reserved-chrome slot, at every commit.
- A plugin opener's return checked at parse: an opener that claims no line is declined in every build (the parse loop can no longer be spun by a plugin) and warns; a raw mismatch warns.
- Duplicate registration throws at the call site.

The plugins e2e project fails on any dev-invariant fire.
