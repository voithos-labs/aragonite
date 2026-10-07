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

| Layer                 | What's in it                                                                                                                                                                                                                                                                                                                                       | Frozen                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registration base** | Node identity (`AnyBlockKind`), the register-once, conflict-on-duplicate registry model, plugin-kind naming (`declarePluginKind`), the no-node-field inline-content shape (a kind declares `supportsInline`), and the `getEvents()` access path                                                                                                    | **The model, since 0.8.3.** The call shapes that model is reached through (descriptor fields, the opener's return, the component's verbs) still change, under the changelog's breaking entries for plugins, and freeze with the authoring surface below |
| **Authoring surface** | Everything on the `@voithos-labs/aragonite/plugin` subpath: the container and editable-leaf factories, chrome leaves (chrome: the parts of a block that are furniture rather than content, a title row, a fence line), directives, inline authoring, commands, paste transforms (inventoried in [The pre-freeze surface](#the-pre-freeze-surface)) | **At the public 1.0 release**, not before                                                                                                                                                                                                               |

The authoring surface stays labeled unstable until the release cut, and the cut has preconditions: validation by at least two real container consumers, the in-repo dogfood extensions, an internal limestone integration, and at least one genuinely external author. External means a developer who isn't the project owner, building from the tarball and the docs pack unassisted, with their friction log treated as blocking input (everything that has validated the API so far was written by the owner, which says nothing about the API in outside hands). Until then the surface may change without notice.

The rest of the DX system (declarative manifest, scaffold, hot-reload dev loop, packaged reference fleet) sits outside the freeze entirely and ships after it.

## What earns a freeze

A surface belongs in the freeze if, and only if, **changing it later would force a breaking change on external code that has bound to it.**

| Verdict                  | Rule                                                                                      | Action                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Breaking-if-deferred** | A later change breaks bound external code                                                 | Finalize now, even with no consumer yet                                      |
| **Additive-later**       | A later change only adds (a new field on a payload consumers receive, a new optional API) | No freeze pressure. Whether to build it now is a separate call, covered next |

The distinction is sharper than "does it have a consumer today". A required field added to an event payload never breaks a _receiver_, so an event-payload extension is additive-later even though it sounds like a contract change. That one catches people.

**Freeze-scope is not build-scope.** "Additive-later" answers exactly one question (must this be frozen now?) and the answer is no. It doesn't say whether to build it now, so don't read it as "defer". For an additive-later surface:

- **Build now** when it rides machinery already being built (marginal cost), or when a dogfood or in-repo consumer can validate the mechanism pre-freeze. "A shape with no consumer can't be validated" has an escape hatch: writing a dogfood consumer _is_ the validation, which is what the dogfood plugins exist for.
- **Defer** when neither holds and building would mean binding a shape you'd only be guessing at. The `EditEvent` snapshot discriminant is the canonical case; its meaning needs its real post-v1 consumer (see [Deferred and excluded](#deferred-and-excluded)).

Both branches serve one rule: get the shapes plugins **bind to** exact before the freeze, and keep additive capability surfaces minimal, so later growth stays an add and never a restructure.

### The decision table

The verdict column is the durable part. The status column says where each surface landed.

| Surface                                                                     | Verdict              | In the freeze?                                                                             | Reason                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CstNode.kind` widening to `AnyBlockKind`                                   | breaking-if-deferred | **Yes, implemented**                                                                       | A closed `switch (node.kind)` in external code goes non-exhaustive the moment a plugin kind appears                                                                                                                                                                          |
| Registry model: global, register-once, conflict-on-duplicate                | breaking-if-deferred | **Yes, implemented**                                                                       | Flipping silent-override to conflict after plugins bind changes observable behavior they relied on                                                                                                                                                                           |
| Plugin-kind naming + collision rules (`declarePluginKind`)                  | breaking-if-deferred | **Yes, implemented**                                                                       | The collision contract is what a plugin's kind name binds to                                                                                                                                                                                                                 |
| Events access (`getEvents()` + `EditorContext.events`)                      | additive-later       | **Both paths shipped**                                                                     | `getEvents()` is the consumer's path; `EditorContext.events` is the plugin's subscribe-only view (`Pick<…,'on'>`), an additive second path                                                                                                                                   |
| `EditEvent` / `EditorError` payload shapes                                  | additive-later       | Bound as-is; extensible                                                                    | New fields and origins never break a _receiver_                                                                                                                                                                                                                              |
| Plugin manifest / `plugins` prop                                            | additive-later       | **Unit + prop + per-instance options shipped pre-1.0; manifest stays post-1.0**            | The prop's element type is the `EditorPluginEntry` union (`plugin \| { plugin, options }`), an additive widening; the declarative manifest overload awaits the post-1.0 reference plugins to validate it                                                                     |
| Plugin-op vocabulary extension                                              | additive-later       | Sketched                                                                                   | No plugin ops exist; the extension mechanism is additive                                                                                                                                                                                                                     |
| `EditEvent` snapshot/real-delta discriminant                                | additive-later       | **Deferred**                                                                               | Its binding consumer (persistent version history) is post-v1 app-infra, and its meaning must be designed _with_ that consumer (see Deferred and excluded)                                                                                                                    |
| Inline-parser _stage_ hook                                                  | n/a                  | **Excluded**                                                                               | A parse-pipeline stage, a different thing from the shipped `registerInlineSyntax` scanner hook (see Deferred and excluded)                                                                                                                                                   |
| Selection coordinate-addressing / inline-widget / component-portal surfaces | additive-later       | **Inline-widget + component-portal shipped pre-1.0; coordinate-addressing stays post-1.0** | Per-hook surfaces built against this foundation; additive                                                                                                                                                                                                                    |
| Consumer diagnostics (`getDiagnostics()`)                                   | additive-later       | **Shipped**                                                                                | Consumer-only (plugins never bind it); grows as fields on `EditorDiagnostics`, never a second entry point                                                                                                                                                                    |
| Semantic commands (`runCommand` + `TOOLBAR_COMMANDS`)                       | additive-later       | **Shipped, with `canRunCommand` and `isCommandActive` beside it**                          | Consumer-only: the published id set grows by addition, and a plugin's block command stays chord-only (see [Commands](#commands)). A new question about a command is a second method over the same surface, never a changed return on a method a consumer already binds       |
| Presentation-mode contract (`PresentationMode` + per-tier mode reads)       | breaking-if-deferred | **Yes; every mode shipped pre-1.0**                                                        | A plugin authored against a marker-always editor renders wrong the day preview ships. Not an API break, but one that strands the plugins already written. A new mode joins the union as an addition (the mode litmus in [Presentation-mode reads](#presentation-mode-reads)) |
| Runtime unregister / replace                                                | n/a                  | **Excluded (Plugin System II)**                                                            | The static-registry model has no runtime unload                                                                                                                                                                                                                              |
| Lazy `inlineContent` (contract narrowing)                                   | breaking-if-deferred | **Yes, implemented**                                                                       | Dropping the `inlineContent` field from `CstNode` removed a public-type member while that was still cheap; a plugin binds inline content by declaring `supportsInline`, not by reading a node field ([below](#inline-content-is-not-a-node-field))                           |
| Caret geometry (`caretOffsetAtPoint`, `CaretTarget`, `CURSOR_END`)          | additive-later       | **Shipped, with the inline half, `revealOffsetAtPoint`**                                   | Without it `caretTargetAtPoint` is a field no plugin can fill: turning a point into an offset needs the DOM-to-raw walk, which isn't a plugin's to reimplement. Built pre-freeze because the bundled parrot validates it                                                     |
| `SelectionPoint` shape: `offset` coordinate-space discriminant              | breaking-if-deferred | **Yes, implemented**                                                                       | An optional bool discriminating one public numeric field freezes a misreadable shape, so it's a `CharSelectionPoint \| CellSelectionPoint` union. `offset` keeps its name, and the flag narrows                                                                              |
| A widget's own pointer gesture (`POINTER_GESTURE_ATTR`)                     | additive-later       | **Shipped pre-1.0**                                                                        | A declaration the editor reads at press time, not a hook, so it's additive by construction. Built pre-freeze because the alternative (`stopPropagation` in the plugin's own handler) can't work under delegated events; mermaid's pan validates it                           |
| Scroll hold across a view swap (`ContainerBlock.captureScrollPosition`)     | additive-later       | **Shipped pre-1.0**                                                                        | One more return on the container factory; a component that never calls it sees nothing                                                                                                                                                                                       |

## The frozen foundation

### Node identity: `AnyBlockKind`

A block's **kind** (the string on a node that says what block it is) is `AnyBlockKind = BlockKind | PluginBlockKind`. `BlockKind` stays the closed union of built-ins; `PluginBlockKind` is a branded string that only `declarePluginKind` creates (a duplicate throws). `CstNode.kind` is `AnyBlockKind`, so a plugin-kind node is a first-class CST citizen that flows through render, measurement, and serialization like a paragraph does.

```ts
import { declarePluginKind } from '@voithos-labs/aragonite/plugin';

const CALLOUT = declarePluginKind('callout'); // PluginBlockKind: the string 'callout', branded
declarePluginKind('paragraph'); // throws: declarePluginKind: "paragraph" is a built-in BlockKind
declarePluginKind('callout'); // throws: declarePluginKind: "callout" was already declared by another plugin
```

`BLOCK_KIND_TABLE` remains the built-in completeness enforcer (a `Record<BlockKind, true>` the compiler checks), and `isBuiltinBlockKind` is the runtime check that narrows `AnyBlockKind` back to `BlockKind`. Code that must exhaustively handle built-ins keeps switching over `BlockKind` after that narrowing; code that dispatches by registry lookup keys on `AnyBlockKind` and tolerates kinds it has never heard of.

**The unknown-kind rule.** Any exhaustive `switch` over kind needs a default branch that degrades safely. Windowing's height estimator (windowing being the machinery that only mounts the blocks you can see, sized by an estimate until each block is measured) estimates an unknown kind as prose, serialization round-trips it through `raw` (a node's verbatim source bytes, markers included), and `BlockHost`, which has no per-kind branch and mounts whatever the component registry hands it, renders a kind with no entry as a visible raw fallback.

A **descriptor** (the per-kind metadata record: how the kind merges, edits, renders) is different, because merge rules, container rebuild and selection all read it. A descriptor-less kind throws at first use, which the per-block error boundary contains as a failed-block fallback. Built-in descriptors are checked complete at bootstrap. A plugin kind that registers an opener (the part of the parser that recognizes the syntax a block starts with) or declares `reservedChrome` fails bootstrap without a descriptor; one with neither, reachable only by direct construction, isn't checked, and a full plugin-lifecycle check is a 1.2 concern.

### Inline content is not a node field

`CstNode` carries no `inlineContent` field. A prose node's inline tree is derived from `raw`, by the render path and through an internal accessor no plugin calls. What a plugin binds to is a single descriptor flag: an inline-bearing kind declares `supportsInline`, with no node-field cache to assume. Don't add a derived cache back onto the node type; once plugins bind it, removing it is breaking.

### The registries: global, register-once

Everything a plugin can register lives in a **process-global** registry: block-kind descriptors, components, openers and completers, block and global commands, plugin-global chords, insert entries, block context actions, inline syntax and widgets, directive names, paste surfaces and transforms, and code-block languages. They're all built by `schema/plugin-registry.ts`, so the rules below live in one place. Most come from `createPluginRegistry`, and the ones keyed by a kind come from `createBlockKindRegistry` or `createInlineKindRegistry` (more on who owns those entries in [Per-instance enablement](#per-instance-enablement)). This is the `customElements` model: a kind is a _definition_ every editor instance in the process shares, exactly as `customElements.define` defines an element for every document.

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

**Register-once.** Registering a kind that's already registered throws rather than silently overriding, so a plugin colliding with a built-in (or another plugin) is a loud, immediate error instead of last-writer-wins corruption.

**Augmentation is distinct from registration.** `augmentBlockKind` merges fields into an _existing_ plugin-kind registration: a built-in kind, a kind another plugin owns, and an unregistered kind are each refused with a throw. So is an augment naming a field that's fixed at registration (`blockFocus`, `supportsInline`, `contentStart`, the title row, the unwrap strategies), since each one only makes sense next to the fields it was registered with; the types refuse it too, but a plain JavaScript plugin never sees them. The editor's own wire-up patches built-ins through the internal `augmentBuiltin` (`schema/block-kind-descriptor.ts`), kept off the plugin barrel so a plugin can't rewrite a built-in. There's no unregister and no replace: runtime plugin loading and unloading is Plugin System II, outside this contract.

**A global opener means global syntax recognition, resolved through a per-instance view.** A plugin that registers a block opener teaches the _parser_ to recognize that syntax process-wide. Definitions stay global; each instance _resolves_ them through a `RegistryView` (`schema/registry-view.ts`), and which definitions an instance's view admits is the enablement question, answered [below](#per-instance-enablement).

**Reset is a test affordance; a dev server replaces instead of throwing.** Two carve-outs from the throw, neither of which softens the frozen contract (in production and under test the register-once throw is unchanged):

- For tests, `__resetSchemaRegistriesForTests()` clears every _non-built-in_ registration in every registry, plus the state that isn't a registry (the installed-plugin set, pending registration checks, a renderer slot's renderer). Built-ins survive, so a test isolates without losing the grammar. What counts as built-in is who made the entry, not whose kind it's for: an entry registered outside any plugin for a key the registry knows is built-in, or one made through a registry's `registerCore` (the code languages and context-menu rows). So a plugin's completer for `paragraph` is still dropped, and the editor's own bootstrap, `registerEditorBuiltIns`, registers as no plugin even when a plugin's setup reaches it first. Building a registry signs it up for the reset. The public entry is `resetPluginPlatformForTests()` on the `@voithos-labs/aragonite/testing` subpath, which throws outside a detected test environment.
- Under a **dev server** (a dev build, not a test run) a duplicate registration replaces with a note instead of throwing (`schema/register-once.ts`), since Vite re-runs an invalidated module's `registerX` calls while the registry survives, and every route would 500 otherwise. It covers every keyed registry plus the kind and id brands; a chorded plugin-global command re-bound under the same command replaces, while a chord collision between two commands still throws. It does _not_ reach a `definePlugin` unit, which installs once per process keyed by name, so a re-evaluated plugin module is ignored (first wins, with a dev warn) and editing a plugin's own definition still wants a reload.

#### Who wins on a name collision

Three layers stack, and each answers differently.

| Layer                                                                                                                                                                        | Same name, second time                                                                                                                                              | Where it lives                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Plugin unit install** (`plugins` prop, `installPlugins`)                                                                                                                   | Same identity: no-op. A different definition under one name: **first wins**, the later one and its options ignored with a dev warn (the re-evaluated plugin module) | `schema/plugin-install.ts`                               |
| **Registrars** (descriptor, component, opener, completer, command, context action, insert entry, inline syntax and widget, paste surface and transform, directive, language) | **Register-once**: throws in production and under test; on a dev server it replaces with a note, so a re-run registrar survives hot reload                          | `schema/plugin-registry.ts`                              |
| **Directive names** (`registerDirective`)                                                                                                                                    | The registrar throw above. **First-wins is an author convention, opt-in**: guard on `isDirectiveRegistered(tier, name)` and skip your own registration              | `core/directive/registry.ts`; `docs/guide/directives.md` |

Installing a unit is a declaration of intent, so repeating it isn't an error; registering a name is a definition, so two of them are. A directive name is the one collision the platform can't resolve for you, since both claimants are plugins.

#### Per-instance enablement

Kind _definitions_ are global because, like custom elements, a kind can't be defined differently for two editors in one process. What's per instance is **activation**, and the `plugins` prop is the enablement set: an editor activates exactly the plugins it lists. That's everything a plugin brings: its `onEditor` hooks, its kinds and openers (through the `RegistryView` over the global definitions), the chords its kinds' keymaps and its global commands bind, its paste transforms and paste surfaces, its inline syntax and the delimiters it auto-pairs, its inline widget kinds, the directive names it registers, its block completers, its insert-catalogue entries, its block context actions and its code-block languages.

- A plugin another editor installed but this one didn't list attaches nothing here, and its kinds resolve no component and degrade to the raw-editable fallback.
- An editor mounted with no `plugins` prop activates everything installed in the process. That's the documented default, not a leak.
- A plugin whose setup threw resolves in no editor, not even one with no `plugins` prop. Whatever it registered before the throw stays registered, but every registry read goes through `schema/plugin-activation.ts` :: `resolvesIn`, which only lets a plugin's entry through once its setup has finished.
- An entry keyed by a kind, block or inline (its component, opener, completer, paste surface, inline widget), belongs to the plugin that declared the kind, whichever plugin's setup registered it, so all the pieces of one kind resolve or degrade together. The descriptor has the same owner, though it's never filtered; its owner only decides who may augment it.
- A kind no plugin declared (every built-in, say) leaves the entry with whoever registered it, so a plugin's completer for `paragraph` or widget for `emphasis` shows only in the editors that list that plugin. The kind registries are built that way (`createBlockKindRegistry`, `createInlineKindRegistry`), and `createPluginRegistry` won't compile with a kind as its key.
- The language reads on the authoring barrel (`listLanguages`, `getLanguageAliases`, `highlightCode`) have no editor to ask, so they answer for every installed plugin, as the free `computeInlineContent` does (next paragraph).

The view is frozen-safe because it's additive over the global definitions: a built-in is switched off only by the `syntax` prop (indented code and setext headings), and the descriptor is never filtered. `parse(source, { grammar })` threads the instance's view through every parse (first load, each edit's reparse, a paste, every container body), and the inline scan reads the same view, so an unlisted plugin's syntax reads as plain Markdown there. The shared directive kinds (the generic container, leaf and text directive) belong to no plugin, whichever plugin's setup turns directives on, so an editor that left that plugin out still reads `:::name` as the generic directive. A plugin reads inline content through its editor (`EditorContext.computeInlineContent`, the factories' `getEditor()`, a component widget's props), which reads that editor's syntax; the free `computeInlineContent` is for a pipeline with no editor mounted. The harness-only `__registryEnablement` prop stays, so the filtered-view test can vary the predicate without varying the install.

### Plugin-kind naming and collision rules

`declarePluginKind(name)` is the only place a `PluginBlockKind` is created. It enforces the name pattern (a lowercase first letter, then letters, digits and hyphens) and rejects collisions with **built-in kinds**, **previously declared plugin kinds**, and two **reserved names**: `document`, the marker that distinguishes the CST root, and `global`, the keybinding-override scope. A second `declarePluginKind` with the same name throws, naming the first declarer when a plugin's setup did the declaring.

The `document` reservation matters less than it looks: node-vs-document narrowing is structural (`'raw' in node`), so a kind named `document` wouldn't corrupt the tree, and reserving it just keeps the contract unsurprising. `global` is the one carrying weight: override lookup takes a `'global' | AnyBlockKind` scope, so a kind spelled `global` would resolve its per-kind keymap through the global table.

### Events access: `getEvents()` canonical

The editor's event surface (`edit`, `selectionChange`, `presentationModeChange`, `themeChange`, `menuChange`, `sourceSwap`, `error`) has two supported access paths, one per audience. A **consumer** reaches the full surface through the component method `getEvents()` (via `bind:this`), where `on(event, handler)` returns a disposer. A **plugin** reaches it through `EditorContext.events`, the subscribe-only view (`Pick<EditorEvents, 'on'>`, so `on` only, no `emit`) handed to an `onEditor` callback, a global-command handler, or a block command's `ctx.editor`. A plugin-visible `emit` would freeze at 1.0, so the plugin path exposes subscription and nothing more. The internal `setContext` wiring that hands the same emitter to child components isn't part of the contract.

`sourceSwap` exists so neither audience has to infer a whole-document replacement: `edit` stays the channel for edits alone (a host marking dirty on it never hears its own `source` write), and `editEpoch` bumps for both, so a plugin tells them apart by the event, or by `EditorContext.documentGeneration`.

## The pre-freeze surface

Everything a plugin author reaches today comes through the `@voithos-labs/aragonite/plugin` subpath, and this section is the inventory of what freezes at the release cut.

One packaging fact first: the tarball carries every internal module's `.d.ts`, on purpose. Encapsulation is the exports map's job. It lists the barrels and nothing else, so a deep runtime import doesn't resolve, while the shipped declarations stay a greppable types reference. Pruning them was declined: a pruner would risk a broken published build to save a few hundred kilobytes.

### The plugin unit and the `plugins` prop

`definePlugin({ name, setup, defaults?, parseOptions? })` packages a plugin's global registrations into one installable unit, along with the defaults its per-editor options start from; the editor's set-once `plugins` prop installs each once per process, before the instance's first parse. `installPlugins` on the main barrel is the editor-less entry for `parse()` pipelines, `isPluginInstalled` probes an install, and `definePluginBlock` is the single-block shorthand (one kind, one component, one register step) for the common case that needn't touch `definePlugin` and `registerBlockComponent` directly.

```ts
import { definePlugin } from '@voithos-labs/aragonite/plugin';

export const callouts = definePlugin<{ maxDepth: number }>({
	name: 'callouts',
	defaults: { maxDepth: 6 },
	setup(ctx) {
		// global registrations go here: declarePluginKind, registerBlockKind, registerBlockOpener, ...
		ctx.onEditor((editor) => {
			editor.editorId; // 'editor-1', stable for the life of that mount
			editor.document; // the live document, read-only (a DocumentView)
			editor.options; // { maxDepth: 3 } from the entry below ({ maxDepth: 6 } bare), typed by the generic
			const off = editor.events.on('edit', (e) => console.log(e.op, e.path)); // subscribe-only: no emit
			return off; // the disposer, run at unmount
		});
	}
});

// the consumer's side: one array, shared by every <Editor>; an entry is a bare unit or { plugin, options }
const plugins = [{ plugin: callouts, options: { maxDepth: 3 } }];
```

The decided shape is an **imperative `setup(ctx)`** unit; a declarative manifest stays additive-later, as a `definePlugin` overload rather than a restructure. Install is once-per-process keyed by name: a same-identity re-install no-ops, same-name-different-identity is first-wins with a dev warn, and a setup that throws stays failed. Kind declarations made during a setup are attributed to their plugin, so a duplicate-registration error names the first declarer.

**The per-instance context.** `setup` receives a `PluginSetupContext`, and its `ctx.onEditor(cb)` registers a callback fired once per `<Editor>` instance. The callback receives an **`EditorContext`**:

- `editorId`, the instance's identity, stable per mount;
- `document`, a live getter;
- `documentGeneration`, a live count of `source` swaps (not reactive, so a plugin hears a change on `sourceSwap`);
- `events`, the subscribe-only view;
- `options`, typed: the plugin's defaults with this editor's entry merged over them (`definePlugin<Options>` carries the type through);
- `decorations`, `rects`, `inlineMenus`, `insertCatalogue`, `presentationMode` and `theme`, each covered in its own section below;
- `insertMarkdown` and `runCommand`, which delegate to the instance's own entry points with the same answers: false, and nothing written, wherever the instance would decline;
- `computeInlineContent`, an inline parse the way that editor draws it (its syntax, and its document's reference links). The editor hands out a new function whenever the link reference definitions change, so a plugin cache keyed on it refreshes.

The callback may return a disposer, run at unmount. Per-instance state needs no plugin-state field: a plugin keys its own `Map` on `editorId`. Registration is **synchronous-only**: a context leaked past `setup` throws, the same boundary as kind attribution.

**Per-instance options** ride the `plugins` prop's `EditorPluginEntry` element type (`plugin | { plugin, options }`), so two editors sharing one process-global registration can still run different options, the split-pane case. A plugin factory's own argument is right for a process-global dependency (a render engine) and for filling `defaults`, but it can't differ between two instances; anything that does belongs in the prop entry.

The merge happens once per editor and plugin, in `src/lib/schema/plugin-install.ts :: resolvePluginOptions`. The rules:

- The entry's defined fields go over `defaults`, each replacing its default whole. Arrays aren't concatenated, so a host that wants none of a default list passes `[]`.
- A bare install reads the defaults, never `undefined`.
- `parseOptions`, when the unit has one, sees the raw entry first and returns the fields to keep. A field it leaves out keeps its default.
- A throw from `parseOptions` goes to the editor's `error` event the way a throwing `onEditor` callback's does, and that plugin runs on its defaults in that editor.
- A block can read its options while it renders, which is before the editor attaches its error handler. A throw that early waits in a queue until the handler arrives.

Options are read off the owning plugin's `EditorContext`: `options` from `onEditor`, and at the two block tiers the factories' `getOptions`. The container's is shorthand for `getEditor()?.options`, typed `unknown`. The leaf's is `getOptions<O>()`, typed by the caller, and with no editor mounted it answers the plugin's `defaults`. The bundled toc block validates it: per-instance `maxDepth`, with the factory argument filling its `defaults`.

_Freeze litmus._ The unit's frozen shape must leave additive room for (a) the per-instance enablement policy layer over the global definitions, (b) lazy or deferred setup, and (c) a declarative-manifest overload. None is needed by a pre-freeze consumer; all are additive. Two boundaries matter. The ambient marker that attributes a setup's kind declarations to its plugin is **synchronous-only by design**, so a future async or lazy setup path must thread the owning plugin explicitly rather than widen the ambient mechanism. And there's **one context object**: the `EditorContext` an `onEditor` callback receives, a `registerGlobalCommand` handler receives, and a block command reads through `ctx.editor` are one type, and must stay one.

### Registration base (frozen)

The frozen layer's exports, in one breath: kind declaration plus `declaredPluginKind` (the checked accessor that recovers a declared brand in another module without a cast); descriptor, component, and opener registration; `defineBlockComponent`, which types a Svelte component as a `BlockComponent` without an `as unknown as` cast; idempotent-registration probes for the registries that publish one, which a module-scope registrar guards on so a re-import doesn't throw; and typed per-node plugin metadata (`setPluginMetadata` / `getPluginMetadata`), which stores a plugin kind's own shape without casting through the built-in metadata union.

Frozen here means the model: which calls exist, that they register once and conflict on a duplicate, and what a kind is. The shapes those calls take still follow the pre-freeze rule, and freeze with the authoring surface at the release cut.

On `BlockComponent` itself, caret placement is two verbs. `focus` places a caret and also ends any live cross-block range, the safe default an author gets by writing nothing special. `parkCaret` is optional and lands the caret without ending the range, for the editor's selection-extend paths; a block built on either factory gets both, and G2.12 guards which callers may reach the second. Keep them two: one verb carrying both meanings lost whole documents twice before 1.0.

The surface's optional members stay **flat**. Grouping the capability probes into named facets was considered and declined. The caret members' three layers are documentation (`docs/design/editor.md` § The editing surface), and `ContainerBlockComponent`, the container members promoted to required, is the one tier the types themselves carry.

### Parse and serialize helpers

The recognizer and serializer halves an opener and a `rebuildRaw` need, on the barrel so a plugin never deep-imports `core/`:

- `parse`: body in, `Document` out. Takes the additive `parse(source, { grammar })` options slot: the per-instance grammar view, defaulting to the global grammar.
- `serialize` / `serializeChildren`: a whole document's bytes back, or just a child list's.
- `trimTrailingLineEnding`: CRLF-correct display text.
- `normalizeLineEndings`: external text to LF before it enters the tree.
- `splitLines` + `ParsedLine`: the line shape an opener reads off `ctx.lines`, and the splitter that produces it, so a transform holding nothing but a string can still reach the line-scoped helpers.
- `isBlankLine`, `isBlankText`, `isWhitespaceChar`, `trimWhitespace`: GFM §2.1's whitespace (never a non-breaking space) for a line, a block's text, one character, and a string's ends. A plugin grammar asks these instead of JS `\s` or `trim()`, which would split a block on a pasted non-breaking space.
- `parseContainerBody` + `ContainerBodyWrap`: the body parse for a container whose chrome lines bound it (`:::note` … `:::`), where a blank line against a chrome line is a separator rather than a child. A container that parses its body with plain `parse` mis-owns that line.

Beside them travel the read-side node helpers: inline content for a prose leaf, the inline-bearing probe, the content span within a block's raw, and a heading's level. All pure and uncached, so no caller assumes a cache.

### Built-in grammar recognizers

The built-in line grammars a plugin would otherwise fork, exposed so a construct shaped like a built-in reuses CommonMark's rules instead of a second, subtly-wrong copy.

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

`registerBlockCompleter` is the opener's sibling for a grammar whose lines must be adjacent, which Enter alone can never type into existence. An opener recognizes a line while parsing; a completer reads the one line the user just typed at an Enter press and answers the lines that complete it. Block math is the validating consumer (`$$` plus Enter inserts the fence pair with the caret in the body); without the plugin the same line splits like any other paragraph. A completer whose claim can only mean one thing the moment the line is complete registers `onType: true` and is also consulted as the line is typed, so the structure forms at once. Block math does (`$$` forms the block as the second `$` lands); a table's header row doesn't, since it's a prefix of a longer row still being typed.

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

What freezes is `CompletionResult`'s shape. Its `lines` carry **no line endings**: the completion machinery attaches the block's own, which is what keeps a completion from downgrading a CRLF document. Its caret is `{ path, line, column }`, not a byte offset; `path` is child indices inside the new block (empty for the block itself). It's line-relative because the line ending is picked after the claim, so an offset-shaped caret would drift a byte per line in a CRLF document. Growth is fields on the result, never a second registry.

### Renderer and opener utilities

- `createBoundedMemo`: a bounded LRU memo for a renderer's per-source work. Sync (with an optional clone-on-read for live DOM) or async (the value is the render promise, so in-flight work is shared and a rejection caches).
- `createRendererSlot` and `createAsyncRendererSlot`: the one place a plugin's injected renderer is set and cached, built on the bounded memo. The slot joins the theme into every cache key itself, so an author's `key` can't leave it out, and a missing or throwing renderer comes back as the spec's `missing` or `failed` output rather than an exception. It enrolls in the platform's test reset like a registry does. The bundled latex and mermaid plugins are its consumers.
- `renderSourceFallback(source, message)`: the typed source in the code font with the message on hover. It's neutral, since a missing renderer is a legal install and not an error.
- `createScanIndex`: a memoized per-raw position index with an at-or-after lookup, so a recognizer's decline scans its block once; the footnote and math recognizers validate it.
- `OPENER_PRIORITIES`: the published built-in priorities a plugin opener prices its own placement against. An offset from a named built-in, never a bare integer.
- `lineStartsOuterBlock` (with `OuterBlockScan`): the shared end-of-extent test for a container opener scanning its own lines: does this line start a block at the outer level, given whether a paragraph is open above it. Published so a plugin container ends its extent where the built-ins end theirs, rather than re-deriving the paragraph-interrupt exceptions.

### Container authoring

`createContainerBlock` wires a nested-`BlockList` container (list state, ancestor contexts, nested actions, windowing, the `BlockComponent` surface) so a plugin container is as thin as the built-in blockquote. It returns a `ContainerBlock`, whose `containerApi` is the `ContainerBlockComponent` (the container methods it always supplies, typed as required) and whose `blockListProps` are the props for the `BlockList` component itself, on the barrel because the plugin's own markup mounts it. A container publishes that surface as one instance export, `containerApi`, since Svelte 5 instance exports can't be spread and forwarding a dozen members by hand made every member a place to drop one. The component registry's exports type makes a missing export a compile error. `BlockComponentProps` names the props `BlockHost` passes every component.

A container may contribute an ambient prefix (the read-only marker a container lends its first prose child, the way a list lends `- `) through the factory's optional `getAmbientPrefix` dep, a live getter forwarded to the nested list as `ambientPrefixForFirst`; the footnote definition's `[^label]: ` marker is the validating consumer. The prefix's shape, interactive ranges included, is `docs/design/editor.md` § Ambient markers.

**Taking the changed-child hint.** A `rebuildRaw` that re-emits one child's region needs to know where each child's bytes sit in its own raw, and the only supported home for that is `node.childSpans`. The editor keeps that field honest: the pass that re-derives blank-line separators after a splice drops it when it moves a separating line, the commit-time rebuild reseeds it, and G1.36 counts it against the children. Offsets cached anywhere else (plugin metadata, a module map, a `WeakMap`) go stale unseen. Declining the hint and re-deriving the whole raw is always correct, and the container conformance kit compares a hinted rebuild against a full one either way.

**What a rebuild writes.** A `rebuildRaw` writes `raw` and nothing else. When the bytes it writes move an opaque container's opener or closing line (a fence it lengthened past a body line, say), the editor re-reads the container's metadata from those bytes through the parser, so `createDirectiveRebuild`, `serializeDirective` and a hand-written rebuild all leave the counts in metadata alone. A strip container gets the same treatment for its first line, which is where its metadata has to live: the editor reads that line alone on each change that moves it, and parses the container only when the line reads differently from the metadata it holds. A rebuild can ask for that parse itself by returning `{ rereads: true }`, for bytes it kept that may now read as other blocks (the built-in quote and list item do, when a lazy line they kept stops continuing its paragraph).

### Editable chrome

One `registerChromeLeaf` call binds a container's title or summary leaf with a default keymap (Enter descends to the body; chord-keyed overrides). The container _declares_ its chrome slot on its descriptor, and the machinery enforces the **reserved-chrome contract**: the slot is always present, single-line (unsplittable; paste flattens inline), cleared rather than node-deleted by destructive ranges, and kind-stable through every edit. `chromeChild` builds that reserved child-0 node (the title text plus its trailing newline) for an opener constructing the container.

One more promise comes with the slot: none of the container's metadata comes from the title row's bytes. A title keystroke skips re-reading the metadata (which would mean parsing the whole container per keystroke), so breaking it leaves the metadata stale while you type. The container kit's `titleRow` cell catches it, and so does G1.12 in dev.

### Collapsible containers

The declaration optionally carries a pure collapse probe, `isCollapsed` over the node. From that one declaration, every child-adjacency operation is collapse-aware: merge from below, focus walks in and out, a Shift-extended selection (it stops on the title row and never opens the container, and deleting a range that covers any of that row, or runs past it, takes the whole container, hidden body included), Enter-descend, and reveal (mounting an off-screen block before something touches it). The container factory derives its window clamp from the same probe, and windowing estimates a collapsed container at one chrome row. `isCollapsedContainer` reads the probe off the descriptor, so a component's own disclosure UI and the model-layer walks share one definition.

The factory also returns a metadata-commit handle, `updateOwnMetadata`, for behavioral fields like a collapsible's open state: merged, raw-rebuilt, and undoable in one commit. It takes the caret as a value too (`{ caret: { path, offset } }`, relative to the block), which the commit lands through the editor's caret landing, so a plugin never focuses anything after its own write. In reading mode, which writes no bytes, the commit declines it as a no-op, and a dev build warns with the operation and the block's kind.

Beside the probe sits its inverse: `expandPatch` returns the metadata patch that opens a collapsed node. A reveal aimed at a hidden body child (a toc entry, a search match) commits that patch through the same handle the disclosure toggle uses, so the expansion is a real undoable edit, and reading mode, which commits nothing, expands nothing. Every collapsed ancestor on the path opens, outermost first, one undo entry each. A kind that declares no `expandPatch` reveals exactly as it would without one: the target stays unmounted and the reveal reports that it didn't land.

### Editable-leaf authoring

`createEditableLeaf` is the container factory's sibling for leaves. It takes getter deps (`getNode`/`getIndex`/`getPath` plus `getEl()`, so a captured value can't be passed) and returns a `blockApi`, everything the editor calls on the block, which the component publishes as its one export.

- **Two modes.** `plain` is always editable, with per-keystroke commits, prose undo batching and a view the factory keeps in sync. `render-primary` swaps between a rendered view and the source, owned by the component, and the reveal-edit-blur cycle commits as one undo entry. Its deps union requires `isRevealed` and `setRevealed`, and the factory throws without them for a caller the types never reached. Block math is the render-primary validator; the `%%` memo harness kind is the plain one.
- **A move writes an open source first**, through `blockApi.afterSourceCommit`. A scan holds each leaf component to exporting the factory's object rather than a flat copy of it (G4.73), so no member gets dropped on the way out.
- **`singleLine` is orthogonal to the mode.** A kind whose bytes are one line takes Enter as a block split instead of a literal newline, through the same `splitBlock` entry a heading's Enter takes, and the fold and the split share one undo entry.
- **Commits land through the shared block-edit entry** every text edit crosses, so multi-block text structurally re-splits there.
- `StickyColumnDirection` (`'above' | 'below'`) is on the barrel because a leaf's `focusAtColumn` receives it; it says which side the caret arrived from.

### Supporting descriptor fields

A few fields earn prose beyond their table row below. `blockFocus: 'whole-block'` opts an opaque childless block into the focus-then-delete model: arrow traversal stops on it, a caret-adjacent Backspace focuses it before a second press deletes, and when a merge can't happen, the fallback in either direction focuses it rather than doing nothing. Such a kind can't also parse inline syntax, declare a content start or reserve a title row; the registration type refuses all three. `getFocusEl` declares that focus surface rather than receiving DOM focus itself. The factory mounts a hidden editing host in the chrome box and lands focus there, because AltGr and IME input reach an editing host or nowhere; a declared surface that's itself editable keeps its own caret.

`gapEdges` (`'before' | 'after' | 'both' | 'none'`) is the required gap-caret declaration. A kind whose surface traps the caret at one or both of its edges says so, and the boundary it shares with a sibling declaring the facing edge becomes a place a caret can park and a paragraph can be inserted; the gap caret itself (the caret parked between two blocks where neither surface can host one) is `editor.md` § The gap caret. `'none'` is the explicit answer that the surface, or an existing affordance, already covers insertion at both edges. It's required rather than optional so that leaving it out can't silently mean `'none'`.

`estimateHeight(node, env)` is windowing's height guess for a block it hasn't measured yet: an O(1) pixel estimate, with the width and text metrics in `env`. A kind that renders at a stable size declares that size (a Mermaid diagram at its placeholder height), so the scrollbar is already right before it mounts. A real measurement still beats it (`docs/design/virtual-rendering.md`).

### The descriptor field reference

The registration shape freezes at 1.0, so every descriptor field freezes with it, and this table is the inventory. Every row is a cross-cutting fact some subsystem reads instead of branching on kind; the admission bar at the end keeps the table from growing by habit. A lint (G4.53) keeps this table and `BlockKindDescriptor` identical in both directions.

_Tier_ is the kind class that can meaningfully declare the field. `container` marks the fields registered inside the `container` group, where declaring one on a leaf is a compile error. `whole-block` and `grid` name the tier the field creates or presupposes (a container that parses childless is a whole-block unit, and `blockFocus` is how it says so). `leaf` marks the fields a kind with its own text surface declares; `any` marks the rest. Semantics live on the type (`src/lib/schema/block-kind-descriptor.ts`); this table carries what the field is for, and what leaving it out means.

The table lists the flat shape the editor reads back, which isn't quite what you register. Besides the `container` group, two rows register as a pair: `getContentRange` and `contentStartBackspace` go in as `contentStart: { range, backspace? }`, since the Backspace behavior means nothing without the range. And a container with a title row declares only `unwrapRole.middleChildBackspace`; keeping the title row when Backspace lands at its start is implied, and the editor fills that strategy in itself.

| Field                   | Tier        | Omitted means                                                                                                                                 | What it declares                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mergeRole`             | any         | required                                                                                                                                      | The kind's role when Backspace tries to merge it with a neighbour                                                                                                                                                                                                                                                                                                        |
| `editable`              | any         | required                                                                                                                                      | Whether the kind carries text of its own; a non-editable kind is skipped by the document scan                                                                                                                                                                                                                                                                            |
| `closure`               | any         | required                                                                                                                                      | The kind's written answer to every cross-cutting editor system (the section "Editable content and the closure matrix" below)                                                                                                                                                                                                                                             |
| `label`                 | any         | the kind name in words                                                                                                                        | What the block is called: its accessible name, and the noun in its block menu rows; blank throws                                                                                                                                                                                                                                                                         |
| `supportsInline`        | any         | required                                                                                                                                      | Whether the kind's raw carries inline syntax the inline parser processes                                                                                                                                                                                                                                                                                                 |
| `isContainer`           | any         | derived, never declared (the `container` group's presence is the answer)                                                                      | Whether the kind holds children                                                                                                                                                                                                                                                                                                                                          |
| `containerContract`     | container   | required with the group; registered as `container.contract`                                                                                   | The raw-to-children relationship: strip, grid, or opaque                                                                                                                                                                                                                                                                                                                 |
| `rebuildRaw`            | container   | required with the group                                                                                                                       | Recompute the container's raw from its children and metadata. A second argument names the one child whose raw moved, for a rebuilder that can re-emit that child's region alone; ignoring it is always correct, and a kind that takes it keeps its offsets in `node.childSpans` (above). It may return `{ rereads: true }` to have its bytes read whole after it (above) |
| `bodyWrap`              | container   | the body opens on the container's own first line                                                                                              | The wrap the opener parses the body with, when chrome lines bound it                                                                                                                                                                                                                                                                                                     |
| `lastLineChild`         | container   | a strip's last child holds the last line (unless its inner suffix comes after it), a grid's last row does, an opaque container's own bytes do | Which child holds the container's last line, or -1 when the container's own bytes do (a table holding only its header row ends on its delimiter line). A file with no final line break gives that line's ending up down this path                                                                                                                                        |
| `bodyWrite`             | container   | a child's bytes are written verbatim                                                                                                          | Make text legal as a child's bytes inside this container's body, and say where a caret in it lands                                                                                                                                                                                                                                                                       |
| `reservedChrome`        | container   | child 0 is an ordinary body block                                                                                                             | Child 0 is a reserved chrome leaf, optionally with a collapse probe and an expand patch                                                                                                                                                                                                                                                                                  |
| `containerPaste`        | container   | a same-kind clipboard top nests as a sub-container                                                                                            | How a clipboard top merges into a same-kind ancestor instead                                                                                                                                                                                                                                                                                                             |
| `unwrapRole`            | container   | default Backspace dispatch                                                                                                                    | What Backspace at the start of this container's children does; a container with a title row declares only the middle-child strategy                                                                                                                                                                                                                                      |
| `contentStartSpace`     | container   | a space at a child's content start types normally                                                                                             | The first space typed at a child's content start completes the marker while it lacks its space                                                                                                                                                                                                                                                                           |
| `reorderChildren`       | container   | children are not independently reorderable                                                                                                    | Direct children reorder among themselves, optionally renumbering markers                                                                                                                                                                                                                                                                                                 |
| `blockFocus`            | whole-block | the caret walks through the block's own offsets                                                                                               | Opts a childless opaque block into the focus-then-delete model; the kind then declares `supportsInline: false` and no content start or title row                                                                                                                                                                                                                         |
| `foreignDragHitTest`    | grid        | the block has no interior a foreign drag can address                                                                                          | Viewport point to internal offset for a drag, declining off-region                                                                                                                                                                                                                                                                                                       |
| `caretTargetAtPoint`    | grid, leaf  | the block resolves a point through its own DOM                                                                                                | Viewport point to child path plus offset, total within the block's box; a render-primary leaf names an empty path and the source offset its reveal click lands at. The point half is `caretOffsetAtPoint` on the plugin barrel, so the kind writes only the arithmetic between its two strings                                                                           |
| `rawWrite`              | any         | bytes are written verbatim                                                                                                                    | Make text legal as this kind's own bytes, and say where a caret in it lands, at every write built outside the block's own editable text. An optional `text(raw)` names the bytes that are the block's text, its structure left out, for the dev checks that a range indent or a list move kept the text (additive-later: a new optional member)                          |
| `contentStartBackspace` | leaf        | the merge cascade runs; registered as `contentStart.backspace`                                                                                | Backspace at the content start gives up the kind's own structural bytes first                                                                                                                                                                                                                                                                                            |
| `renderImagesAsWidgets` | any         | inline images render as widgets; read only where inline content renders                                                                       | Opt an inline-bearing surface out of image widgets, back to the alt-only fallback                                                                                                                                                                                                                                                                                        |
| `contextDependentKind`  | any         | the kind's raw reparses to itself                                                                                                             | The kind has no standalone recognizer, so an edit keeps it rather than re-deriving                                                                                                                                                                                                                                                                                       |
| `gapEdges`              | any         | required; `'none'` says the surface hosts insertion at both edges                                                                             | Which of the block's edges get a gap caret                                                                                                                                                                                                                                                                                                                               |
| `getContentRange`       | any         | the content is the whole display; registered as `contentStart.range`                                                                          | Where content starts and ends inside raw, past the kind's own markers; in a prose kind, bytes past the content end are structure, drawn as a marker after the text (a join lands above them, and a truncation keeps them)                                                                                                                                                |
| `keymap`                | any         | only the global table answers                                                                                                                 | Per-kind chord-to-command bindings, consulted before the global table                                                                                                                                                                                                                                                                                                    |
| `estimateHeight`        | any         | a container gets the container estimate, a leaf the prose one                                                                                 | An O(1) content-height estimate in px for windowing; `schema/height-estimates.ts` holds the shared shapes                                                                                                                                                                                                                                                                |
| `pageRole`              | any         | `'object'`                                                                                                                                    | Whether the block reads as prose (no drag handle; a prose leaf takes the clipboard rows on a right-click) or as an object picked up whole                                                                                                                                                                                                                                |
| `dragLabel`             | any         | the block's first words                                                                                                                       | What the drag ghost calls the block, for one whose text makes a bad label; a blank one throws                                                                                                                                                                                                                                                                            |
| `conformanceFixture`    | any         | the kind enrols in no fixtured conformance cell                                                                                               | Markdown that parses to a tree holding this kind                                                                                                                                                                                                                                                                                                                         |

**Combinations the types cannot refuse.** Most bad pairings get caught before a user ever meets them, just not all in the same place:

- **They don't compile.** A leaf declaring a container field (G3.6). A content-start Backspace with no range, a whole-block kind that also parses inline syntax or reserves a title row, and a title-row container naming its own first-child Backspace strategy, where a lifting one would carry the title row out as a sibling block (G3.10). A registration that skips the types (a cast, a plain JavaScript plugin) throws on those same pairs instead.
- **They fail at registration.** The closure cells against the rest of the descriptor, an unknown merge role, and `contextDependentKind` beside a registered opener. That last pair is split across two registries, so no one type sees both halves.
- **They fail the container conformance kit.** A declared unwrap strategy nobody implements.

What stays prose-only is the class no declaration can decide: whether a kind's surface genuinely traps the caret at the edge it claims with `gapEdges`, and whether a hook patched in after registration (`estimateHeight`, `caretTargetAtPoint`, `foreignDragHitTest`) belongs to a kind whose box has interior addressing at all. Both are answered by the kind's component, which the registry never sees.

**The admission bar.** A new field on this table must bring four things. It states a **cross-cutting** fact that more than one subsystem reads, or it belongs on the component or in the plugin's own options. It's **not derivable** from fields already here. Its **omission means today's behavior**, so every registration that predates it stays correct unchanged. And it **arrives with its guard**: a registration check, a conformance cell, or a shape that makes the wrong declaration a compile error, as high up the enforcement order in `docs/design/invariants.md` as it goes. A field that brings only the first is a component prop wearing a registry's clothes.

### Presentation-mode reads

`PresentationMode` (`'source' | 'reading' | 'preview-block' | 'preview-inline' | 'live'`) is the vocabulary, read four ways:

1. the live `presentationMode` prop, reflected as `data-presentation` on the editor root (absent in source, so the default DOM is unchanged);
2. an internal getter on the block context that joins the prose render key, so a mode flip re-renders every mounted prose block (the previews then reveal markers with CSS alone, never rebuilding the inline DOM on a focus or caret move);
3. `EditorContext.presentationMode` (a live getter) plus the `presentationModeChange` event;
4. the leaf and widget tiers: `EditableLeaf.getPresentationMode()`, the live `getPresentationMode` getter on an inline-widget component, and `InlineWidgetEditingContext.presentationMode`.

**Mode litmus: handle non-exhaustively.** The union has grown once already, so a plugin that switches exhaustively over it is wrong by construction: the next mode is an addition to the union, not an API break. Read the one property your rendering depends on (most often "does this mode paint markers", or "does it write bytes") and default the rest. The platform's own read sites are written that way, which is why live mode arrived with no plugin-facing change.

The editor's theme travels the same paths (`EditorContext.theme` plus a `themeChange` event, the factories' `getTheme()`, the inline-widget `getTheme` prop). It's for content whose colors a rendering engine paints into its own markup, which must be redrawn rather than restyled. A renderer slot takes it as a required input (`render(input, { theme })`) and keys its cache on it.

Reading mode is enforced where the bytes are written: every commit, typing write, undo and redo declines in reading mode, whatever route reached it. The platform's own edges also stop offering the gestures (the chord dispatchers ignore a chord, the editable leaf never reveals its source, the container factory's whole-block keys run nothing), so a plugin inherits the inertness without writing mode code. The contract is that the mode writes no bytes, not that nothing responds: a view-only affordance may stay live (the bundled details disclosure does).

### Paste transforms

`registerPasteTransform` records a content-keyed, pre-parse rewrite of pasted plain text: named, register-once (a duplicate throws, attributed to the owning plugin), run in install order at every paste site before the parse. It's **content-keyed**, distinct from the internal, target-kind-keyed `registerPasteSurface` (which stays unexposed, see [Explicitly excluded](#explicitly-excluded)): a transform keys off the clipboard _content_ it recognizes, not the block kind the paste lands in, which is the shape the GitHub-alert-to-admonition conversion needs.

### Inline authoring

The inline mirror of the block surface: an inline-kind brand with an idempotence probe (`declarePluginInlineKind`, `declaredPluginInlineKind`, `isInlineKindDeclared`); an inline-syntax recognition hook (`registerInlineSyntax`, where the plugin hands the scanner a trigger character and a recognizer); and an inline-widget editing registry (`registerInlineWidgetKind`, carrying a per-kind `InlineWidgetEditingPolicy` on the `InlineWidgetDescriptor`, plus `InlineWidgetEditingContext` and `InlineSyntaxRecognizer`; `InlineNode` is on the barrel) that gives a plugin inline kind atomic, caret-addressed editing. `mintWidgetShell` builds the atomic-widget shell a `buildWidget` fills, carrying the source-range attributes the caret's offset walk reads, so no plugin hand-stamps them. KaTeX validates the surface, with the renderer injected, not bundled.

The freeze-time decisions riding this surface:

- **Recognition precedence: the priority order (shipped).** The bare hook fires only for a trigger no built-in scanner claims; built-in delimiter dispatch runs first, and a bare registration on a claimed trigger (`` ` `` `&` `<` `*` `_` `~` `[` `]` `!` `\` newline) still throws, because a silent no-op is the one failure a public API must not have. A reserved trigger is reachable through the **prefix-recognizer tier**: a registration carrying a multi-char `prefix` that begins with the trigger and a `priority` below `INLINE_PRIORITIES.builtin`, consulted before the built-in case so it can outrank it on the longer prefix (footnotes' `[^` beating `[`). Handlers on one trigger coexist and dispatch deterministically (priority ascending, then prefix length descending, then prefix lexicographic), so registration order never matters, like the block layer's `OPENER_PRIORITIES`. The tier is **additive**: the base signature and its bare-reserved throw are untouched. An unterminated construct (a `[^` that never closes) falls back to the built-in's reading, with no byte change. Footnotes validates it.
- **Builder injection (resolved).** Three builder paths coexist: the recommended `component` (a Svelte component kept live across per-keystroke rebuilds), the stateless `buildWidget` (the two are mutually exclusive), and image's stateful builder on the internal `augmentInlineWidgetKind` hook, which stays unexposed. A component widget's mount carries `getDocument`, the read-only root document for derived display state (the inline mirror of `BlockComponentProps.document`), as a required getter so a captured value can't be passed; footnote-reference numbering validates it. The mount also carries `computeInlineContent`, so a widget that walks inline nodes reads only the syntax its editor lists.
- **Widget navigation (shipped).** A component widget that points elsewhere in the document carries `navigateTo` (the editor's `EditorRects.navigateTo`), passed down like `getDocument`, so a widget reveals, scrolls and lands the caret without a context of its own. The gesture it rides is the link click's: `isWidgetActivationClick` is the one predicate for it, and `InlineWidgetEditingPolicy.claimsActivationClick` stands the source reveal down for exactly that gesture, since a widget swapped for its source bytes under the click would unmount before it could act. The footnote reference's jump to its definition validates it.
- **Editing policy: two declared fields (shipped).** `InlineWidgetEditingPolicy` carries `deleteGranularity` (`'atomic'`, one press deletes the widget whole; `'select-then-delete'`, the first press selects it and the second deletes, the image's two-press default) and `onEdge` (`'select'`, an edge press takes the construct whole; `'step-over'`, the caret crosses it like a character). One caret-edge dispatch (`components/blocks/text/edge-policy-dispatch.ts`) reads both off the registration, by kind. The built-in decoded-entity widget (`&copy;` becomes ©) validates it, with `{ deleteGranularity: 'atomic', onEdge: 'step-over' }`.
- **Writing back a borrowed kind: the rewrite hook (shipped).** A recognizer may produce a **built-in** kind over bytes of its own, which is how an Obsidian-style embed becomes a real image rather than a decoration painted over bytes the tree never sees. The read paths need nothing more; the write paths do, because the editor's inverse for a built-in kind emits that kind's grammar, so without a way back a resize would re-serialize the embed as GFM and destroy the author's syntax. `InlineSyntaxOptions.rewriteImage` is the way back: the edit hands the recognizer its node's current source and the fields the edit produced, and takes the replacement bytes, or `null`, meaning the edit has no form in that grammar.

  ```ts
  registerInlineSyntax('!', recognizeEmbed, {
  	prefix: '![[',
  	priority: INLINE_PRIORITIES.prefixOverride,
  	// (source, fields) => string | null; fields is { alt, url, title?, width?, height?, label? }
  	rewriteImage: (source, fields) => (fields.title ? null : `![[${fields.url}|${fields.alt}]]`)
  });
  ```

  **The default is a decline, not a fallback**: no hook, or a `null` return, and no commit happens at all. The rule sits at the single write point every image gesture crosses, not at the surfaces that draw the affordances, so it covers the properties popover and a hook that accepts one edit and declines the next. The scan marks the claim on built-in kinds only, since a plugin's own kind has no editor-side grammar to be rewritten into. `ImageSyntaxRewriter` and `ImageFields` are on the barrel. Additive: a recognizer producing only its own kind is untouched, and `image` is the sole built-in kind with a field-to-bytes write path today; a second one extends the same claim.

- **Memoizing over the whole document: the content version (shipped).** A widget whose display depends on the whole document (footnote numbering) can't key a memo on the document itself: the editor's `$state` document is mutated in place, so its identity survives every edit and the memo would serve a stale answer forever. `InlineWidgetComponentProps.getContentVersion` is the key instead, a number that changes whenever the document's bytes change, and reading it inside the widget's derived both subscribes and keys the memo, so the widgets share one walk. It differs from the decoration engine's `editEpoch` in one way: the version is a **reactive** read, the epoch a plain number handed in (one `tick()` behind). An inline widget renders mid-burst and needs the version; a decoration source runs only from `provide`, which the epoch already drives. The getter is required, so a harness mount passes a version of its own. Footnote-reference numbering validates it.
- **A claim begins at its trigger (limitation, additive to lift).** A recognizer is called at the trigger position and must return a node starting there, so a grammar whose significant character sits in the middle of what it claims (GitHub's cross-repo `user/repo#123`, where the trigger is `#` but the construct starts at `user`) can't be one recognizer today. It's a real gap, not a rejected shape. The fix is an optional, bounded lookbehind on `InlineSyntaxOptions`, an addition to the options bag, and it rides the post-1.0 inline-syntax work rather than the freeze.
- **Error rendering (shipped).** A missing or throwing renderer resolves through the renderer slot's `missing` and `failed` outputs ([Renderer and opener utilities](#renderer-and-opener-utilities)).
- **Construct policy rows: editor-internal at 1.0.** Live mode's per-construct editing behavior (edge affinity, unwrap-on-empty, split behavior, revealability, the link card's reach, where a trigger may open the inline menu, the mark vocabulary a format chord writes) is a declared row per inline kind in `schema/inline-construct-policy.ts` (`docs/design/live-mode.md` § 3). The registrar is on neither barrel, so at 1.0 the table holds **built-in rows only** and a plugin construct gets the no-row default: no live edge behavior, and no format chord addresses it. Opening it is additive-later and deliberately not taken pre-freeze, since `nestingRank` is a bare integer into an order with no published names, a shape we'd only be guessing at. It opens with named ranks beside `OPENER_PRIORITIES` and `INLINE_PRIORITIES`, its reset wired into `resetPluginPlatformForTests`, and a policy cell in the inline conformance kit.

### Directive authoring

One shared opener owns the `:::`/`::`/`:` fence family and dispatches by name (`registerDirective`, probed by `isDirectiveRegistered`) across three tiers (container, single-line leaf, inline text), so plugins never collide on opener priority. A registered name renders through its own kind; an unregistered name round-trips through a generic fallback, so a document survives its plugin being uninstalled.

The `fromDirective` factory is required for container, optional for leaf, and rejected for text, enforced at registration. `parseDirectiveAttributes` is an opt-in, one-way `info → { label, id, classes, properties }` reader over the remark convention; the opener's info string, as typed, stays what gets written back. `serializeDirective` writes a fence back without losing a byte, and `createDirectiveRebuild` builds the `rebuildRaw` for a directive container whose child 0 is an editable title. Two smaller symbols carry rules a hand-built fence would otherwise get wrong: `escalatedColonCount`, the fence length a body forces, for an emitter that concatenates `:::name` text by hand; and `DIRECTIVE_BODY_WRAP`, which a directive kind declares as its `container.bodyWrap` so the editor knows the blank line against the fence belongs to the fence.

Activation is the explicit idempotent `activateDirectives()` call, not an import side effect: the authoring symbols alone don't claim `:::`. See [the directives guide](../guide/directives.md).

### Commands

`registerBlockCommand` binds a `(kind, name)` block command and hands back its id, a branded name created the same way kinds are, which the plugin then binds in its kind's keymap (`CommandId` names a built-in command a binding can target; `KeyBinding` is the per-kind chord-to-command shape; `AnyCommandId` spans both). Dispatch reaches the two surfaces that can supply a handler its context, the editable leaf's keymap and the container's key handling. That context carries the mounted component's own view-state handles (`ctx.hooks`, from the factories' `commandHooks` getter) and `ctx.editor`, the dispatching instance's `EditorContext` for the plugin that registered the command. Anything more arrives as another field on this one context, never as a second context object, and `setup(ctx)` grows the same way. That's what freezes: a handler bound today must never meet document mutation as a different object tomorrow.

`registerGlobalCommand(name, handler, { chord? })` is the editor-wide sibling: a process-wide command whose handler receives the dispatching instance's `EditorContext`, the same object `onEditor` hands out, and the argument the dispatch carried (`runCommand(id, arg)`'s, or a chord binding's `arg`), so it fires regardless of which block holds focus. An optional chord binds in the **plugin-global tier**, which resolves last, after every consumer override, built-in kind keymap, and built-in global chord. Built-in chords and the reserved search chords (`Mod+F` / `Mod+H`) can't be taken, and a collision throws before the command id exists.

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
// throws before any id is created: plugin global chord "Mod+F" is reserved by the editor UI (search) ...
```

A handler throw is contained at the dispatch boundary and surfaces as an `error` of origin `command`, attributed to its command, the plugin that registered it, and, for a block command, its kind. A block command bound on a built-in kind's leaf does nothing (with a dev warning), since those surfaces supply no context.

**A plugin's _block_ command is reached by chord, not by the consumer.** The instance's `editor.runCommand(id)` resolves the focused surface without a command context, so a plugin's block command id finds no handler there and dev-warns. That boundary is part of what freezes: a plugin exposes a keystroke-free _block_ affordance by binding a chord or by publishing an API of its own. Lifting it later means widening the id space, which is additive. A plugin's **global** command sits outside the boundary, since `runCommand` resolves the global tier first.

**Over a selection.** A few pre-freeze additions let a plugin's command join what built-in keys do over a selection, each additive-later:

- `registerBlockCommand`'s optional fourth argument, `BlockCommandOptions`, with `{ overRange: 'afterRemoval' }`: a key bound to the command removes a cross-block selection first, the way Backspace would, then runs it at the caret that's left. An options bag on a signature plugins already bind, so another value later is one more addition.
- `BlockCommandOptions.overSelection: 'afterRemoval'`, the same over a selection inside the command's own block, with `ctx.afterRemoval` true so an "empty line" branch can tell the removal's emptiness from the user's.
- `BlockComponent.getCommandContext` (returning a `BlockCommandTarget`) and `BlockComponent.afterSelectionRemoved`: how the editor runs a plugin's command at a block after a removal. Optional members on a published type; the editable leaf supplies both, and a hand-built component that leaves them out gets a dev warning (or, for the second, a command run with the selection still there).
- `CommandRun`, the record of how a command came to run, with one field so far, `afterRemoval`: an optional third parameter to a block's `runCommand`, and extended by `BlockCommandContext`. A new field on it is an addition.
- `registerRangeIndent(kind, command, shift)`, with `shift` a `RangeLineShift`: what the kind's own indent command does to the lines a range covers in each of its blocks. A registry beside the command, so nothing bound changes.

### The root document, in a component

`BlockComponentProps.document` delivers the read-only root document to every block component at any nesting depth; a component otherwise sees only its own node. A table-of-contents block reads the headings above it through this prop (the bundled `toc` validates it, nested). It's a **read-only** view, and mutation stays a commit's job.

### Decorations

The view-only annotation layer, for everything that owns no syntax: spellcheck, ghost text, inline comments, badges, occurrence highlights. A decoration never enters the CST. A plugin registers a named, per-instance **source** through `EditorContext.decorations` (a consumer through `getDecorations()`), and the engine re-runs every source once per document edit. A source is **pure over the document plus its own state**; there's no decoration set to map forward through edits, because positions are `(path, offset)` into a tree re-derived per edit (see plugin-local state in [Explicitly excluded](#explicitly-excluded)). The handle returned by registration carries `invalidate()`, synchronous (the new result is queryable before it returns) everywhere but inside a commit, where it waits for the commit to publish so no source reads a half-applied tree, and an idempotent `dispose()`. A throwing source is contained: the error surfaces on the `error` channel attributed to the source, and its prior decorations are retained rather than blanked.

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

Four decoration types:

- an inline **mark**: a positioned overlay span carrying the source's class (search's own highlights are marks from a source of this engine).
- a zero-width **widget**: an inline widget at one position, covering no bytes.
- a range **replace**: an inline widget drawn over a range of bytes, which stay in the document and never leave `getSource()`.
- a whole-**block** treatment: class and attrs on the block host, plus an optional badge widget. A list item has no host, so its treatment lands on the item's own box, which the item paints itself.

The union grows by addition: a new decoration type is a new member, a new capability on an existing type is an optional field, and a shipped member is never restructured. That's safe because a source _produces_ decorations and never switches over them; the editor is the only exhaustive consumer.

Widget and replace decorations are atomic inline widgets (spans the caret can't enter), with defined caret, arrow, and destructive-key behavior (see the closure matrix). **Widget identity is untracked by render keys**: two specs at the same position with the same class are treated as equal, so a source varies `class` to force a re-render. They render on prose leaves and inside table cells; code blocks and thematic breaks apply none.

Cost contract: an idle source's per-edit re-run is O(sources), never per-block, and a block with no widget or replace decorations keeps its render key unchanged. The perf suite pins both.

### Rects

Viewport-space geometry over the rendered document, reached through `EditorContext.rects` (plugin) and `getRects()` (consumer): a block's bounding box; the rects covering an inline range (per visual line on wrapped prose, per cell on a table, with the end marker meaning "through the last measurable position"); the live native caret (null while a cross-block range is live); a `reveal` that mounts a block windowing skipped; and a `scrollTo(path, { block })` that reveals then scrolls.

`scrollTo` doesn't just scroll once. It sets a **reveal anchor** (held in `cursor/scroll-owner.ts`) that the top-level block list re-asserts after every measure pass, because a target past unloaded images would otherwise slide away: the images reserve height off screen and shrink on mount, and the browser clamps the scroll off the target.

For the curious, the anchor's finer rules:

- It names the full target path, so a target nested in a container is held where the reveal put it, not at its container's top.
- `'nearest'` is held exactly, by default; `'center'` is refined to exact placement once mounted, then released, since a coarse pin held on would drift. `hold: false` hands the viewport back on any placement.
- Each `scrollTo` claims the one anchor, may release only the pin it still holds, and stops refining once a newer reveal supersedes it. A keydown, pointerdown or wheel in the document releases it for the user.
- The returned boolean resolves only after the position settles, so `true` means genuinely in view.

`navigateTo(path, offset?)` adds a caret landing to the same reveal, at the block's start or at the offset you name. It lands through the restore path `setSelection` and undo already share, so every caret rule comes from that one path, which is also why it's a member of `rects` and not a navigation object of its own. Rects are real only in a browser, so e2e tests cover the surface, with the selection-toolbar demo as its consumer.

**`getRects()` versus `.rects` is a convention.** `EditorInstance` is a **method-based handle**: every member is a call, since a consumer holds it through `bind:this` for the component's whole life and a property read would hand back a value captured at an arbitrary moment. `EditorContext` is a **live-read property bag**: every member is a `readonly` property, several getter-backed (`document`, `presentationMode`, `theme`), since a plugin's callbacks re-read on every invocation. Neither surface mixes the two forms (`getEvents()`/`events`, `getDecorations()`/`decorations`, `getRects()`/`rects`), and growth stays inside the rule: a new consumer read is a new method, a new plugin read is a new getter-backed property, never a second geometry surface.

### Inline menus

A list under the caret that opens when the author types a trigger: `#` for a tag, `[[` for a link to another document, `/` for a command. A plugin reaches it as `EditorContext.inlineMenus` and a consumer as `getInlineMenus()`. The editor owns the part a host can't do from outside without racing it: it notices the trigger as the bytes land, holds the keys while a list shows, anchors the list to the typed range, and writes the pick over that range as one undo entry. A source supplies a name, the trigger, and an `items(query)` that returns rows or a promise of them.

The decisions riding this surface:

- **Typing is a difference, not an event.** One `edit` can carry several characters (dictation, a soft keyboard, an IME commit), and the caret can lag the bytes by a read, so the state keeps the caret's leaf as it last saw it and reads a trigger as bytes inserted so as to end at the caret. A caret that merely arrives beside an existing `#` has typed nothing and opens nothing; a burst carrying `#wo` in one change opens with the query already filled. The baseline is taken twice, at the event and at the root's `beforeinput`, and both are needed: drop the first and a trigger typed on the line Enter just made has nothing to differ from; drop the second and a click into a list item followed by a fast burst has no baseline in time.
- **A session is identity only.** Source name, path, trigger start. The query and the range a pick replaces are re-read from the live leaf after every edit and caret move, so nothing here can address bytes that moved. The trigger's bytes disappearing, the caret stepping out in front of the query, or the source declining the query each end it.
- **Five bare keys, no chord.** While rows show, the editor takes ArrowUp, ArrowDown, Enter, Tab and Escape at the root's capture phase, before the focused block sees them. An empty list holds none of them, and an IME composition takes them back. They're not in the reserved-chord manifest (G4.29), which covers modifier chords a host might bind.
- **A pick is one line of inline bytes.** `insert` replaces the trigger and the query through the same range splice the link card and the image popover use. Empty is legal and removes the trigger and the query. A line break in it is refused and reported on the `error` channel, because a blank line inside one leaf's raw is corruption (a reload would read it as two blocks).
  - A block-level insert is `onCommit`'s job, through the `EditorContext` it gets as its third argument (`InlineMenuCommit`); the bundled slash-commands plugin is that shape, and hands the same context to a host row's `run`. `onCommit` may return a promise, and every write made while it's pending joins the pick's undo entry until the author's next input, so a source awaits `insertMarkdown`, whose promise resolves once the insert has landed.
  - That context belongs to the pick. A `source` swap aborts its `signal`, and its `insertMarkdown` and `runCommand` write nothing from then on, while `document` and the other getters still read live. The context a plugin closed over in `onEditor` can't do the same, since nothing tells the editor which call a waiting commit made; `checkInlineMenuCommitAcrossSwap` on the testing subpath fails a source that writes through it.
  - A trigger is one line and never empty, and `addSource` throws otherwise, and on an editor that has already unmounted, rather than hand back a handle that can never open anything.
- **A row is named by its id.** Ids are unique within one list: where two rows share one, the first is kept, the rest are dropped, and the source is told on the `error` channel. The active row is named in the DOM after its id, not its place in the list, which a narrower query changes.
- **The editable reads as a combobox while a list shows.** The block the author is typing in says the list is expanded, names it, names the active row, and says the rows are suggestions; when the list goes it's a plain text box again (a consumer selecting on role sees the swap too). The pattern is written for a single-line field, which a paragraph isn't, and that's the price of telling a screen-reader user the list opened at all.
- **`open(name, { query })` is the author's say-so.** It types the trigger, then the query if given, at the caret as one undo entry and opens the list over it, skipping `opensAt`; that's how a shortcut or a toolbar button reaches the same list. It declines and writes nothing for an unknown name, in reading mode, without a collapsed caret in a prose leaf, and for a query holding a line break. A query the source's `accepts` declines is still written, and opens nothing.
- **Where a session lives.** A collapsed caret in prose. Never a table cell (a pick may insert blocks, and a cell's line can't hold one), never a code block, and inside the leaf never an inline code span, a link's destination or title, an image, an autolink or raw HTML: a `#` there is a fragment or an attribute, not a tag. A destination still being typed counts too, read off the line's bytes before its closing `)` arrives. A link's own text is prose, and a trigger opens there. `open(name)` skips the in-leaf bounds the way it skips `opensAt`.

`menuChange` reports the list the way it reports every other editor menu. The harness's two sources (tags, synchronous; document links, asynchronous) and the bundled slash-commands plugin validate the surface.

### Insert catalogue

The blocks the insert menus offer, as data: an id, a label, a menu glyph name, keywords, and the Markdown the block inserts. The built-ins come first in a fixed order, then each entry a plugin registered with `registerInsertEntry` from its `setup`, listed only in an editor that activated that plugin. The right-click "Insert block" rows, `getInsertCatalogue()` on the instance and `editor.insertCatalogue` on the context read this one list, so a host's own `+` button and the editor's menu can't disagree.

An entry can also take an argument, a word typed after it in the slash list (`/table 3x4`). Its `withArgument` gets the word and returns the Markdown to insert, plus the dim text the row shows for how it read it; the slash list keeps no Markdown of its own for any entry. The code entry cleans the word with the code block's own rule for an info string (`src/lib/schema/fenced-code-raw.ts :: legalFenceInfo`), so ``/code ja`va`` opens a `java` fence.

Registration is register-once: a duplicate id throws, and so does an icon name the menu has no glyph for, since a row drawn with no icon is a silent no-op. The slash-commands plugin validates the surface.

## Payloads bound as-is

These are frozen _as the current shape_, but because they're payloads consumers _receive_, new fields and new union members can be added later without breaking a receiver.

```ts
editor.events.on('edit', (e) => e);
// { op: 'input', path: [2], timestamp: 1788390000412 }
// { op: 'split', path: [2], detail: { at: 14 }, timestamp: 1788390001033 }
// { op: 'delete', path: [1], detail: { crossBlock: true }, timestamp: 1788390004120 }

editor.events.on('error', (err) => err);
// { origin: 'command', error: TypeError(...), context: { kind: 'callout', command: 'callout.toggle', plugin: 'callouts' } }
// { origin: 'decoration', error: RangeError(...), context: { source: 'stale-links' } }
```

- **`EditEvent`**: `{ op, path, detail, timestamp }`, where `op` is the `OperationKind` vocabulary derived from `OperationDetailMap`. Emitted at each write as it lands: from the commit steps (the fixed steps every commit runs, `docs/design/editor.md` § 11) for structural ops, and from a keystroke's in-place write as `op: 'input'`, one per key. A plugin's metadata edit (`updateMetadata` on a command context, `updateOwnMetadata` off the container factory) emits `op: 'metadataUpdate'`; the vocabulary is the editor's, and a plugin can't add an op to it yet ([Target shapes](#target-shapes-designed-ahead)).
- **`EditorError`**: `{ origin, error, context? }` with `origin` in `'subscriber' | 'render' | 'commit' | 'command' | 'decoration' | 'clipboard' | 'link'` and `error: unknown`, which is correct for a boundary.
- **`SourceSwapEvent`**: `{ generation }`, emitted last in a `source` prop swap, once the new document, its selection and its link references are in place; `generation` counts swaps since mount and matches `EditorContext.documentGeneration`.
- **`SelectionPoint`**: the between-blocks gap caret sits _outside_ this union on purpose, and `getSelection()` reads null while a gap is live. Publishing a gap position later arrives as an additive read-side shape, never a new union member every consumer must switch over. While an image is selected whole, `getSelection()` reads a collapsed caret at the image's edge (its end, after a click): the next `insertMarkdown` or keystroke replaces the image, and `setSelection` of that value puts a caret back without selecting the image again.
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

The chrome leaf stays narrower than the general editable leaf on purpose. The one shape rejected outright, a nested editor serialized as a blob, sits in [Explicitly excluded](#explicitly-excluded) with its siblings.

### Every tier answers every system

A new extension tier meets every editor subsystem whether or not its author considered them, so "it renders and round-trips" is a fraction of done (the whole-block-focus tier shipped answering 2 of 9 and leaked 4 holes).

**The rule.** Every extension tier, and every new per-kind capability on an existing tier, must define its behavior under each cross-cutting system _before it ships_: it fills its matrix row, a ✓ or a recorded gap, never a blank.

**Every tier supplies `measurePartialRects`**, the childless opaque container included. A decoration is only as good as its worst-painting tier, so a tier that can't measure a partial range ships the whole annotation layer a hole the ecosystem inherits.

**The row is a type.** `closure` (the kind's written answer to every cross-cutting editor system) is a required block on every block-kind registration, and `Record<ClosureColumn, …>` makes a missing column a compile error. The cell vocabulary is the guide's to teach ([the closure block](../guide/plugin-guide/container-walkthrough.md#the-closure-block)); what the contract pins is that the presets are shorthand for this same field, not holes in it. `simpleLeafClosure` bakes the five structurally fixed columns of a not-mergeable, source-editable leaf and still demands the four the leaf's component determines (omitting one is a compile error); `containerClosure` is the sibling for a strip container; and the novel-tier row is always hand-written. G1.24 cross-checks the cells against the rest of the descriptor (a container's `roundTrip` must name its `rebuildRaw` rather than inherit the default, a `not-mergeable` kind's `mergeBackspace` can't inherit a default merge it doesn't have) and validates each declared `conformanceFixture` parses to its kind.

What's declared here is also _executed_: registering a kind enrolls it in a generic per-cell suite. The headless cells (round-trip, merge eligibility, byte-slice clipboard, undo, search degradation) run at registration; focus, selection paint and search paint run per registered kind in a browser sweep; reorder and the simulation column (`simOracle`: whether a long random editing session ever produces a document gone wrong) run in their own e2e suites.

**The inline tier has its own harness.** An inline recognizer carries no descriptor to hang a row on, so its equivalent is the inline conformance kit on `@voithos-labs/aragonite/testing` ([the testing guide](../guide/plugin-testing.md#the-inline-checkup-runinlinekindconformance) covers its cells). Its four declared cells are required declarations rather than optional ones, like the container kit's `terminatorCollision`, because each failure is invisible to a byte round-trip and an optional cell gets left out by exactly the recognizers that need it. Fixtures are required, an unclaimed one fails rather than skips, and an excuse the kit can falsify, it falsifies.

### The matrix

The rows are the interaction tiers a caret meets; they refine the editable-content tiers above. The block-level **whole-block-focus opaque** tier, a childless opaque block that is its own focus target (a diagram, say), is split out from the **inline widget**, the atomic embed inside prose; the editable-content table folds that block-level case under Container.

_Legend: ✓ closed (defined + covered) · n/a structurally absent · ◐ partial (a recorded edge case) · gap (a recorded hole)._

| Tier                      | Round-trip | Focus | Merge / backspace | Selection paint | Search paint | Reorder | Undo | Clipboard | Simulation |
| ------------------------- | ---------- | ----- | ----------------- | --------------- | ------------ | ------- | ---- | --------- | ---------- |
| Container                 | ✓          | ✓     | ✓                 | ✓               | ✓            | ✓       | ✓    | ◐¹        | ✓          |
| Chrome leaf               | ✓          | ✓     | ✓                 | ✓               | ✓            | n/a²    | ✓    | ◐¹        | ✓          |
| Editable leaf             | ✓          | ✓     | ✓                 | ✓               | ✓            | ✓       | ✓    | ✓         | ✓          |
| Whole-block-focus opaque  | ✓          | ✓     | ✓                 | ✓               | ✓³           | ✓       | ✓    | ✓         | ✓          |
| Inline widget             | ✓          | ✓     | ✓⁴                | ✓               | ✓            | n/a⁵    | ✓    | ✓         | ✓          |
| Widget/replace decoration | ✓⁶         | ✓     | ✓⁷                | ✓⁸              | ✓            | n/a⁵    | ✓⁷   | ✓⁹        | ✓¹⁰        |
| Block decoration          | ✓⁶         | ✓¹¹   | ✓¹²               | ✓               | n/a¹³        | ✓¹²     | ✓¹²  | ✓⁹        | ✓¹⁴        |

1. **◐ Clipboard.** Both chrome directions round-trip the container: an end landing mid-chrome yields a chrome-only container, and a start landing mid-chrome reopens the container around the collected body, closing it where the walk leaves the subtree. What remains partial is the generic case the chrome pair sits inside: an endpoint landing in a container's body is skipped as an endpoint ancestor, so unless one of the four recovery paths applies, that container's wrapper is lost (issue #42; folded into the post-1.0 clipboard generalization).
2. **n/a Reorder.** A chrome leaf is the container's reserved child 0; it has no independent block identity to move.
3. **✓ Search.** A match inside a childless opaque container is found (the block's raw scans as a leaf), painted through the container shim's `measurePartialRects`, and navigable. Replace rewrites it too: the substitution lands in a private clone's raw and reparses, so the kind re-derives its own metadata. The one decline is kind-stability: bytes that break the opener line come back as a different kind, and a diagram must not silently become a plain code block.
4. **✓ Merge / backspace.** A caret-edge Backspace or Delete reveals the widget's source or atomically deletes it; block-level merge stays the host prose block's concern.
5. **n/a Reorder.** An inline widget isn't a block, and reorder is a block-level gesture. A widget or replace decoration is the same shape: view-only inline DOM, no block identity.
6. **✓ Round-trip.** Decorations never enter the CST, so round-trip holds by construction; the bytes a replace decoration covers stay in the document and never leave `getSource()` (property-pinned over arbitrary placements).
7. **✓ Merge / backspace / undo (widget/replace).** A widget decoration (zero bytes) is transparent: destructive keys act on the adjacent real byte, and at a true block boundary fall through to block merge. A replace decoration (hidden bytes) is selected whole by an edge press and deleted whole by the second, one CST commit and one undo entry, because silently eating one hidden byte would be invisible corruption.
8. **✓ Selection paint.** Sweeps measure and paint through these decorations normally. Deliberate zero-length case: a widget decoration spans no bytes, so it's invisible to selection cover rects. That's correct (nothing is selected), recorded so nobody "fixes" it.
9. **✓ Clipboard.** Excluded by construction: copy yields the raw byte slice, so a range spanning one copies the real bytes, hidden bytes included, never the decoration DOM.
10. **✓ Simulation (widget/replace).** A simulation session paints a replace and a widget decoration and drives their caret walk, edge select-then-delete, transparent backspace, and adjacent typing under the corruption checks, the decoded-entity widget included.
11. **✓ Focus.** The badge widget mounts non-editable as the host's first child and must not capture focus or caret placement; the decorated block stays a fully functional editing surface.
12. **✓ Merge / backspace / reorder / undo (block).** A block decoration is source-derived, keyed by path: after any structural edit or restore, sources re-run against the new tree and the treatment lands wherever the source now points, a table row or cell included; a badge addressed to a row or cell is refused with a dev warning, since a row has no box of its own and a cell's children are its editable text, which every keystroke re-renders. Cleanup on change and dispose (class, attrs, badge removed) is e2e-pinned.
13. **n/a Search paint.** A block decoration adds no text; class, attrs, and badge carry nothing the document scan can match.
14. **✓ Simulation (block).** The same session badges a block, reorders it, and asserts the treatment follows the bytes to the new path (and back on undo), with the corruption checks run again after the move.

Table cells match prose: **inline-widget reveal-to-edit** and **widget and replace decoration rendering + edit** run in a cell through the same code paths. The one cell-specific rule: every reveal or caret-edge commit re-escapes pipes and drops the prose trailing newline, so an edit can never split the row on reparse.

## The boundary, and who gets which type

What a plugin may and may not do, the editor-plugin-versus-app-plugin line, and the misuse-outcomes table (what each mistake does in a dev build versus production) are author-facing and live in the guide: [What a plugin may and may not do](../guide/plugin-guide.md#what-a-plugin-may-and-may-not-do) and [Misuse outcomes](../guide/plugin-guide.md#misuse-outcomes). The invariant catalog (`docs/design/invariants.md`) is the enforcement record behind both.

What only this document carries is the type story. The rule: a surface that **reads** hands out a view (`NodeView` / `DocumentView`, bytes-readonly); a surface that **constructs, owns, or writes** keeps the mutable `CstNode` / `Document`. A freshly parsed document is owned, and a mutable node passes wherever a view is expected, so there's no conversion step. The plugin surface has no supported way from a view back to a mutable node: mutation of the live tree goes through commits (`rebuildRaw`, metadata updates, commands).

```ts
const source: DecorationSource = {
	name: 'shout',
	provide: (doc) => {
		doc.children[0].raw = 'HELLO\n'; // compile error: raw is readonly on a DocumentView
		return [];
	}
};
```

| Surface                                                                                                                | Type                 |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Component props (`node`, `document`), `EditorContext.document`, `DecorationSource.provide` doc                         | view                 |
| Descriptor read hooks (`contentStart.range`, `estimateHeight`, `reservedChrome.isCollapsed`)                           | view                 |
| Command / widget-editing contexts (`BlockCommandContext.node`, `InlineWidgetEditingContext.node`), `getPluginMetadata` | view                 |
| `parse` result, opener / directive-factory products, `chromeChild`                                                     | mutable              |
| Write hooks (`rebuildRaw`, `setPluginMetadata`); the commit steps hand them owned nodes                                | mutable              |
| Write rules (`rawWrite`, `bodyWrite`): bytes in, bytes out, and a context naming the block they are written into       | strings, plus a view |

## Target shapes (designed ahead)

What's still ahead, sketched just far enough that building any of it is an addition over a shipped shape rather than a rework of one. Nothing here has a consumer yet, and nothing here is frozen.

- **Plugin-op vocabulary extension.** A way for a plugin to contribute an `OperationKind` (and its detail type) so its structural edits emit typed `EditEvent`s. Additive over `OperationDetailMap`, and waiting on the first plugin op that isn't a metadata update (those already emit `metadataUpdate`).
- **A `parse` error origin, and a structured plugin-error shape.** Both additive on `EditorError`, whose origins today are the seven in [Payloads bound as-is](#payloads-bound-as-is); neither has a consumer.
- **Normalize-on-commit / veto hook.** A hook for a plugin to veto a commit or append derived mutations atomically within it (ProseMirror `filterTransaction`/`appendTransaction`, CM6 `transactionFilter`). Post-1.0: additive over the commit steps, whose internal shape plugins never bind, and built when a real consumer settles its shape (veto versus append, sync versus async). Invariant enforcement stays editor-owned. No frozen surface precludes it, and three constraints are already fixed:

  - **Copy on write extends to it.** The protocol that copies a node before the commit writes it (G1.9) has to cover a plugin-contributed mutation too, not just the editor's own.
  - **One call per commit, never re-entry.** A running commit is the one place a half-applied document exists, so the hook gets exactly one call at one point; a later call would see a tree the commit has already validated.
  - **The view it receives doesn't outlive the call.** An owned copy is valid only until it's written back through the `$state` tree (design rule 5), so a retained handle is a stale write handle. Revoking it on return is part of the hook's shape, the same way `PluginSetupContext` throws on a leaked context.

- **Per-recognizer editing policy for a borrowed built-in kind.** A recognizer that produces a **built-in** kind inherits that kind's editing behavior wholesale, because the caret-edge dispatch resolves policy by kind: an Obsidian-style `![[embed]]` produced as an `image` edits like a GFM image. The additive shape is a **claim-keyed policy lookup layered over the kind-keyed one** (the node's syntax claim first, then the kind). Merging the two key spaces instead would break the built-in widget kinds, which carry policies and have no recognizer at all.
- **A plugin grid's selection in its own coordinates.** The descriptor already takes the two point-to-internals hooks a grid kind declares (`caretTargetAtPoint`, `foreignDragHitTest`), and only the built-in table declares the drag half today; `SelectionPoint`'s cell arm is that table's row-major cell index. A plugin grid addressing its own cells through that arm is post-1.0 and additive over both (the decision table's "selection coordinate-addressing").
- **Unified command registry + palette.** One dispatch point resolves every command id, but the handlers live in two homes: a plugin's block command in the `(kind, name)` registry, a built-in kind command on the component's own `runCommand`, so anything enumerating commands sees only the registry half. Moving the built-ins onto the registry is internal work; the registry shape a plugin binds doesn't change.
- **Declarative plugin manifest.** A `definePlugin` overload over the imperative unit. Awaits the post-1.0 reference plugins to validate.

## Deferred and excluded

### Deferred: the `EditEvent` snapshot/real-delta discriminant

Persistent version history (post-v1 app-infra) needs `EditEvent` to distinguish a real structural delta from a commit that changed nothing a reader would see. It's deferred from this freeze on purpose, for three reasons:

1. **It's additive-later.** Adding a field to `EditEvent` never breaks a receiver, so it doesn't need to be frozen before plugins bind.
2. **Its binding consumer is a different milestone**, namely version history, not the plugin contract.
3. **Its meaning must be designed _with_ that consumer.** The obvious derivations are quietly wrong: a normal keystroke commits with the undo snapshot _skipped_ (it's batched) and an internal `noop` structural-change descriptor, yet it _is_ a real document change. So neither "an undo snapshot was pushed" nor "the structural change was non-noop" identifies a real delta. The right signal is a "the user-visible document changed" flag declared at the commit sites, designed with the version-history layer.

### Explicitly excluded

- **Nested-editor interiors**, a second editor state serialized as a blob. A blob can't round-trip through the CST, and that ends the conversation.
- **Inline-parser _stage_ hook.** A hook that inserts a plugin stage into the inline parse _pipeline_, a different thing from `registerInlineSyntax` ([Inline authoring](#inline-authoring)). Widget-ness is a render-plus-model decision, not a parse-pipeline one, so no built-in validates a stage hook. Its real consumer is the post-1.0 inline-syntax work.
- **Runtime unregister / replace**, and with it registry-level replacement of a built-in kind's component or descriptor. Plugin System II. Registries are process-global, so an override would be global and last-writer-wins, the collision problem every surveyed ecosystem has already hit. The supported replacement path is **grammar-level**: a plugin kind claims the syntax ahead of the built-in in the opener priority order, owns its own closure-matrix row, and proves it by enrolling in the conformance suite.
- **GitHub's repo-context sugar**: issue and PR refs (`#123`), `@`-mentions, cross-repo `user/repo#123`. It resolves against a repo or vault the editor doesn't own, so it belongs to the consumer rather than to the library.
- **Plugin-local state** (ProseMirror `StateField`/`PluginKey`, TipTap `addStorage`). The omission is a decision, not a gap. State belonging to a node goes _on_ the node, where it undoes, redoes, and, if it feeds `rebuildRaw`, round-trips. The rest of the need disappears: a state field elsewhere mostly holds a decoration set and maps it forward through edits, because positions there are integers into a flat sequence. Positions here are `(path, offset)` into a tree re-derived every edit, so a decoration source is a pure `doc → Decoration[]`. A plugin wanting state keeps its own `Map` keyed on the editor id; the platform stores nothing.
- **`registerPasteSurface`.** Built, used internally by the chrome and container machinery, and withheld. The use case that asked for it (GitHub alert to admonition) needs a content-keyed transform, which a target-kind-keyed surface can't express: registering for prose kinds collides with the built-in defaults, and its types would drag the commit internals public. The content-keyed half shipped instead as `registerPasteTransform`.

## Enforcement

The contract's rules are guarded by the invariant catalog (`docs/design/invariants.md`):

- The view types (`core/node-views.ts`): every plugin-visible read surface is bytes-readonly at compile time, and the G4.13 lint keeps view-to-mutable casts confined to `tree-operations/` plus the commit steps.
- Readonly-view prop parity (G4.14): a block component annotating its `node`/`document` props with the mutable types is caught by a source-scan lint; the registration boundary erases prop types, so the drift would otherwise compile.
- Bundled-plugin import boundary (G4.16): a source-scan lint holds every file under `src/lib/plugins/` to the public authoring barrel, its own plugin dir, or, in a `renderer.ts`, its one declared engine, so a bundled plugin reaching a `$lib` deep path proves the barrel is missing a surface (fix the barrel, not the import). The bundled set is whatever ships under `src/lib/plugins/`, one `@voithos-labs/aragonite/plugins/<name>` subpath each; everything under `src/routes/test/plugins/` is a harness fixture and is never packaged.
- Bundled-plugin test boundary (G4.63): the same rule one layer out, over the bundled plugins' own suites. A file under a per-plugin test directory imports only `@voithos-labs/aragonite`, `/plugin` and `/testing`, its own plugin's source, another plugin's published subpath, or the copyable in-repo test support, so those suites are the standing proof that the three published entry points are enough to test a plugin, not only to build one. An exception to the rule sits on an allowlist naming the public entry point it waits for.
- Opener coherence at bootstrap over the live registry, and kind-table completeness at bootstrap.
- Keymap coherence over the live registries: a plugin keymap's command ids validate against the `PluginCommandId`s plugins have registered, and a container's `reservedChrome` declaration gets bootstrap coherence.
- Closure-block coherence (G1.24): the required `closure` block agrees with the rest of the descriptor at bootstrap, and each declared `conformanceFixture` parses to its kind.
- Descriptor fields that can't mean anything together don't compile (G3.10), and the one pair that spans two registries, `contextDependentKind` beside an opener, fails at bootstrap (G1.37).
- Opaque-container staleness, rebuild determinism, and the reserved-chrome slot, at every commit.
- A plugin opener's return checked at parse: an opener that claims no line is declined in every build (the parse loop can no longer be spun by a plugin) and warns; a raw mismatch warns.
- Duplicate registration throws at the call site.

The plugins e2e project fails on any dev-invariant fire.
