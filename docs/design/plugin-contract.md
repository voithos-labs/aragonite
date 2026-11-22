# Editor Plugin Contract

At 1.0, aragonite becomes a plugin platform and its plugin API stops moving. This document is the list of what stops moving, what's still soft, and what got left out on purpose. It isn't a tutorial. [The plugin guide](../guide/plugin-guide.md) teaches you how to write a plugin; this one tells you what you can safely build on, which is the question that bites later.

The idea behind all of it: **structure is cheapest to fix before external code binds to it.** Once a third-party plugin imports a type or relies on a behavior, changing either breaks the plugin. So the shapes plugins bind to get settled first, and everything downstream builds on a foundation that has stopped moving.

The tour:

1. [The freeze, in two layers](#the-freeze-in-two-layers): which half is already settled, and what the other half is waiting for.
2. [What earns a freeze](#what-earns-a-freeze): the one criterion, and the decision table it produced.
3. [The frozen foundation](#the-frozen-foundation): block identity, the registries, naming, events. The settled half, in detail.
4. [The pre-freeze surface](#the-pre-freeze-surface): everything a plugin author reaches today, and the decisions riding each piece.
5. [Payloads bound as-is](#payloads-bound-as-is): the event and error shapes that only ever grow, never change.
6. [Editable content and the closure matrix](#editable-content-and-the-closure-matrix): the four ways plugin content can be editable, and the editor systems every new block type is checked against before it ships.
7. [The boundary, and who gets which type](#the-boundary-and-who-gets-which-type): where the rules of conduct now live, plus the one table only this document carries.
8. [Target shapes](#target-shapes-designed-ahead): future directions sketched just enough that later work is an addition, not a rework.
9. [Deferred and excluded](#deferred-and-excluded): what got pushed past 1.0 or rejected outright, with reasons.
10. [Enforcement](#enforcement): the checks that hold all of the above.

## The freeze, in two layers

The contract freezes in two stages, because the two halves grew up at different times.

| Layer | What's in it | In the freeze |
| --- | --- | --- |
| **Registration base** | Node identity (`AnyBlockKind`), the register-once, conflict-on-duplicate registry model, plugin-kind naming (`declarePluginKind`), the no-node-field inline-content shape (a kind declares `supportsInline`), and the `getEvents()` access path | **The model, since 0.8.3.** The call shapes that model is reached through (descriptor fields, the opener's return, the component's verbs) still change, under the changelog's breaking entries for plugins, and freeze with the authoring surface below |
| **Authoring surface** | Everything on the `@voithos-labs/aragonite/plugin` subpath, and on `/svelte` the part typed with Svelte's types: the container and editable-leaf factories, chrome leaves (chrome: the parts of a block that are furniture rather than content, a title row, a fence line), directives, inline authoring, commands, paste transforms (listed in [the plugin API reference](../guide/plugin-api.md), with the decisions behind them in [The pre-freeze surface](#the-pre-freeze-surface)) | **At the public 1.0 release**, not before |

The authoring surface stays labeled unstable until the release cut, and the cut has preconditions: validation by at least two real container consumers, the in-repo dogfood extensions, an internal limestone integration, and at least one genuinely external author. External means a developer who isn't the project owner, building from npm and the guide on GitHub unassisted, with their friction log treated as blocking input (everything that has validated the API so far was written by the owner, which says nothing about the API in outside hands).

Until the cut, the surface still changes, on the schedule in `docs/guide/plugin-guide.md` § What is stable, what is not.

The tooling around the API sits outside the freeze entirely: the plugin template (`packages/create-aragonite-plugin`, the package `npm create` runs), the plugin check (`aragonite-plugin-check` and the reusable workflow `.github/workflows/plugin-check.yml`), and the listing with its gallery page. The first-party plugins don't wait for the freeze: each already ships as a package of its own (`@voithos-labs/aragonite-latex` and so on), and until the freeze every one carries the core's version and peers on exactly that version, so they all release together. `scripts/release/check-lockstep.mjs` fails a release that drifts.

## What earns a freeze

A surface belongs in the freeze if, and only if, **changing it later would force a breaking change on external code that has bound to it.**

| Verdict | Rule | Action |
| --- | --- | --- |
| **Breaking-if-deferred** | A later change breaks bound external code | Finalize now, even with no consumer yet |
| **Additive-later** | A later change only adds (a new field on a payload consumers receive, a new optional API) | No freeze pressure. Whether to build it now is a separate call, covered next |

The distinction is sharper than "does it have a consumer today". A required field added to an event payload never breaks a _receiver_, so an event-payload extension is additive-later even though it sounds like a contract change. That one catches people.

**Freeze-scope is not build-scope.** "Additive-later" answers exactly one question (must this be frozen now?) and the answer is no. It doesn't say whether to build it now, so don't read it as "defer". For an additive-later surface:

- **Build now** when it rides machinery already being built (marginal cost), or when a dogfood or in-repo consumer can validate the mechanism pre-freeze. "A shape with no consumer can't be validated" has an escape hatch: writing a dogfood consumer _is_ the validation, which is what the dogfood plugins exist for.
- **Defer** when neither holds and building would mean binding a shape you'd only be guessing at. The `EditEvent` snapshot discriminant is the canonical case; its meaning needs its real post-v1 consumer (see [Deferred and excluded](#deferred-and-excluded)).

Both branches serve one rule: get the shapes plugins **bind to** exact before the freeze, and keep additive capability surfaces minimal, so later growth stays an add and never a restructure.

### The decision table

Verdict is whether a surface has to freeze now (breaking-if-deferred) or can be added later (additive-later). Decision is what happened to it: in the freeze, built now as an addition, deferred, or excluded.

| Surface | Verdict | Decision | Reason |
| --- | --- | --- | --- |
| `CstNode.kind` widening to `AnyBlockKind` | breaking-if-deferred | In the freeze | A closed `switch (node.kind)` in external code goes non-exhaustive the moment a plugin kind appears |
| Registry model: global, register-once, conflict-on-duplicate | breaking-if-deferred | In the freeze | Flipping silent-override to conflict after plugins bind changes observable behavior they relied on |
| Plugin-kind naming + collision rules (`declarePluginKind`) | breaking-if-deferred | In the freeze | The collision contract is what a plugin's kind name binds to |
| Events access (`on`, and the older `getEvents()` + `EditorContext.events`) | additive-later | All three, built now | `on` hears the `Events` map on a plugin's editor and a host's handle; `getEvents()` and `EditorContext.events` are the older map, kept until it's deleted |
| `EditEvent` / `EditorError` payload shapes | additive-later | Bound as-is; extensible | New fields and origins never break a _receiver_ |
| Plugin manifest / `plugins` prop | additive-later | Unit, prop and per-instance options built now; manifest after 1.0 | The prop's element type is the `EditorPluginEntry` union (`plugin \| { plugin, options }`), an additive widening; the declarative manifest overload awaits the post-1.0 reference plugins to validate it |
| Plugin-op vocabulary extension | additive-later | Sketched | No plugin ops exist; the extension mechanism is additive |
| `EditEvent` snapshot/real-delta discriminant | additive-later | Deferred | Its binding consumer (persistent version history) is post-v1 app-infra, and its meaning must be designed _with_ that consumer (see Deferred and excluded) |
| Inline-parser _stage_ hook | n/a | Excluded | A parse-pipeline stage, a different thing from the `registerInlineSyntax` scanner hook (see Deferred and excluded) |
| Selection coordinate-addressing / inline-widget / component-portal surfaces | additive-later | Inline widget and component portal built now; coordinate addressing after 1.0 | Per-hook surfaces built against this foundation; additive |
| Consumer diagnostics (`getDiagnostics()`) | additive-later | Built now | Consumer-only (plugins never bind it); grows as fields on `EditorDiagnostics`, never a second entry point |
| Semantic commands (`runCommand` + `TOOLBAR_COMMANDS`) | additive-later | Built now, with `canRunCommand` and `isCommandActive` beside it | Consumer-only: the published id set grows by addition, and a plugin's block command stays chord-only (see [Commands](#commands)). A new question about a command is a second method over the same surface, never a changed return on a method a consumer already binds |
| Presentation-mode contract (`PresentationMode` + per-tier mode reads) | breaking-if-deferred | In the freeze | A plugin authored against a marker-always editor renders wrong the day preview ships. Not an API break, but one that strands the plugins already written. A new mode joins the union as an addition (the mode litmus in [Presentation-mode reads](#presentation-mode-reads)) |
| Runtime unregister / replace | n/a | Excluded (Plugin System II) | The static-registry model has no runtime unload |
| Lazy `inlineContent` (contract narrowing) | breaking-if-deferred | In the freeze | Dropping the `inlineContent` field from `CstNode` removed a public-type member while that was still cheap; a plugin binds inline content by declaring `supportsInline`, not by reading a node field ([below](#inline-content-is-not-a-node-field)) |
| Caret geometry (`caretOffsetAtPoint`, `CaretTarget`, `CURSOR_END`) | additive-later | Built now, with the inline half, `revealOffsetAtPoint` | Without it `caretTargetAtPoint` is a field no plugin can fill: turning a point into an offset needs the DOM-to-raw walk, which isn't a plugin's to reimplement. Built pre-freeze because the bundled parrot validates it |
| `SelectionPoint` shape: `offset` coordinate-space discriminant | breaking-if-deferred | In the freeze | An optional bool discriminating one public numeric field freezes a misreadable shape, so it's a `CharSelectionPoint \| CellSelectionPoint` union. `offset` keeps its name, and the flag narrows |
| A widget's own pointer gesture (`POINTER_GESTURE_ATTR`) | additive-later | Built now | A declaration the editor reads at press time, not a hook, so it's additive by construction. Built pre-freeze because the alternative (`stopPropagation` in the plugin's own handler) can't work under delegated events; mermaid's pan validates it |
| Scroll hold across a view swap (`ContainerBlock.captureScrollPosition`) | additive-later | Built now | One more return on the container factory; a component that never calls it sees nothing |

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

**The unknown-kind rule.** Any exhaustive `switch` over kind needs a default branch that degrades safely. Windowing's height estimator (windowing being the machinery that only mounts the blocks you can see, sized by an estimate until each block is measured) estimates an unknown kind as prose, serialization round-trips it through `raw` (a node's verbatim source bytes, markers included), and `BlockHost`, which has no per-kind branch and mounts whatever view the kind's registration carries, renders a kind whose view this editor doesn't resolve as a visible raw fallback.

A **descriptor** (the per-kind metadata record: how the kind merges, edits, renders) is different, because merge rules, container rebuild and selection all read it. A descriptor-less kind throws at first use, which the per-block error boundary contains as a failed-block fallback. Built-in descriptors are checked complete at bootstrap. An opener (the part of the parser that recognizes the syntax a block starts with) is a field of the kind's registration, so it can't exist without a descriptor, and a container whose `reservedChrome` names an unregistered kind fails bootstrap. A kind reachable only by direct construction isn't checked.

### Inline content is not a node field

`CstNode` carries no `inlineContent` field. A prose node's inline tree is derived from `raw`, by the render path and through an internal accessor no plugin calls. What a plugin binds to is a single descriptor flag: an inline-bearing kind declares `supportsInline`, with no node-field cache to assume. Don't add a derived cache back onto the node type; once plugins bind it, removing it is breaking.

### The registries: global, register-once

Everything a plugin can register lives in a **process-global** registry: block kinds (a descriptor, the view that draws it and the opener that recognizes it, registered together), completers, block and global commands, plugin-global chords, insert entries, block context actions, inline syntax and widgets, directive names, and paste surfaces and transforms. They're all built by `schema/plugin-registry.ts :: buildRegistry`, so the rules below live in one place. Most come from `createPluginRegistry`, and the ones keyed by a kind come from `createBlockKindRegistry` or `createInlineKindRegistry` in `schema/plugin-kind.ts` (more on who owns those entries in [Per-instance enablement](#per-instance-enablement)). This is the `customElements` model: a kind is a _definition_ every editor instance in the process shares, exactly as `customElements.define` defines an element for every document.

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

**Registered from a setup, and nowhere else.** A plugin's registrations run inside its `definePlugin` setup, which installs once per process, so no registration needs an is-it-there check first. A register or declare call outside any setup, and outside the editor's own bootstraps (`registerAsCore`, internal), throws in a dev build with the fix in the message (G1.104). A test run is exempt, since suites register throwaway kinds outside a plugin; Vitest is detected, and another runner says so with `configureEditorEnv({ isTest: true })` from `/testing`. Production doesn't check, so a module-scope call still runs there, unsupported. The one probe left, `isDirectiveRegistered`, isn't about your own registration: it's the first-wins check for a `:::name` another plugin may have claimed ([Who wins on a name collision](#who-wins-on-a-name-collision)).

**Augmentation is distinct from registration.** `augmentBlockKind` merges fields into an _existing_ plugin-kind registration: a built-in kind, a kind another plugin owns, and an unregistered kind are each refused with a throw. So is an augment naming a field that's fixed at registration (the view, `blockFocus`, `supportsInline`, `contentStart`, the title row, the unwrap strategies), since a kind's view is part of what the kind is and each of the others only makes sense next to the fields it was registered with; the types refuse it too, but a plain JavaScript plugin never sees them. The editor's own wire-up patches built-ins through the internal `augmentBuiltin` (`schema/block-kind-descriptor.ts`), kept off the plugin barrel so a plugin can't rewrite a built-in. There's no unregister and no replace: a registration lasts as long as the process, and an editor's `use` only turns a plugin off in that editor.

**A global opener means global syntax recognition, resolved through a per-instance view.** A plugin that registers a block opener teaches the _parser_ to recognize that syntax process-wide. Definitions stay global; each instance _resolves_ them through its own grammar (`schema/editor-grammar.ts`), and which definitions an instance's view admits is the enablement question, answered [below](#per-instance-enablement).

**Reset is a test affordance; a dev server replaces only the editor's own entries.** Two carve-outs from the throw, neither of which softens the frozen contract (in production and under test the register-once throw is unchanged):

- For tests, `__resetSchemaRegistriesForTests()` clears every _non-built-in_ registration in every registry, plus the state that isn't a registry (the installed-plugin set, pending registration checks, a renderer slot's renderer). Built-ins survive, so a test isolates without losing the grammar. What counts as built-in is who made the entry, not whose kind it's for: an entry registered outside any plugin for a key the registry knows is built-in, or one made through a registry's `registerCore` (the context-menu rows). So a plugin's completer for `paragraph` is still dropped, and the editor's own bootstrap, `registerEditorBuiltIns`, registers as no plugin even when a plugin's setup reaches it first. Building a registry signs it up for the reset. The public entry is `resetPluginPlatformForTests()` on the `@voithos-labs/aragonite/testing` subpath, which throws outside a detected test environment.
- Under a **dev server** (a dev build, not a test run) the editor re-registering its own entry (a call under `registerAsCore`) replaces with a note instead of throwing (`schema/register-once.ts`), since Vite re-runs an invalidated editor module's registrations while the registry survives, and every route would 500 otherwise. A plugin registering a built-in's key gets the throw, in a setup or out of one. A plugin's entry never meets a duplicate: a `definePlugin` unit installs once per process keyed by name, so a re-evaluated plugin module is ignored (first wins, with a dev warn) and editing a plugin's own definition still wants a reload. A duplicate inside a setup throws, dev server or not.

#### Who wins on a name collision

Three layers stack, and each answers differently.

| Layer | Same name, second time | Where it lives |
| --- | --- | --- |
| **Plugin unit install** (`plugins` prop, `installPlugins`) | Same identity: no-op. A different definition under one name: **first wins**, the later one and its options ignored with a dev warn (the re-evaluated plugin module) | `schema/plugin-install.ts` |
| **Registrars** (kind with its view and opener, completer, command, context action, insert entry, inline syntax and widget, paste surface and transform, directive) | **Register-once**: throws in production and under test; on a dev server it replaces with a note, so a re-run registrar survives hot reload | `schema/plugin-registry.ts` |
| **Directive names** (`registerDirective`) | The registrar throw above. **First-wins is an author convention, opt-in**: guard on `isDirectiveRegistered(tier, name)` and skip your own registration | `core/directive/registry.ts`; `docs/guide/directives.md` |

Installing a unit is a declaration of intent, so repeating it isn't an error; registering a name is a definition, so two of them are. A directive name is the one collision the platform can't resolve for you, since both claimants are plugins.

#### Per-instance enablement

Kind _definitions_ are global because, like custom elements, a kind can't be defined differently for two editors in one process. What's per instance is **activation**, and the `plugins` prop is the enablement set: an editor activates exactly the plugins it lists. That's everything a plugin brings: its `onEditor` hooks, its kinds and openers (through the `RegistryView` over the global definitions), the chords its kinds' keymaps and its global commands bind, its paste transforms and paste surfaces, its inline syntax and the delimiters it auto-pairs, its inline widget kinds, the directive names it registers, its block completers, its insert-catalogue entries, its block context actions, and what its value contributes (code highlighting among it).

- A plugin another editor installed but this one didn't list attaches nothing here, and its kinds resolve no view and degrade to the raw-editable fallback.
- An editor mounted with no `plugins` prop activates everything installed in the process. That's the documented default, not a leak.
- A plugin whose setup threw resolves in no editor, not even one with no `plugins` prop. Whatever it registered before the throw stays registered, but every registry read goes through `schema/plugin-activation.ts` :: `resolvesIn`, which only lets a plugin's entry through once its setup has finished.
- A block kind's view and opener are part of its registration, so they resolve wherever the kind does, and no other plugin can supply either. Any other entry keyed by a kind, block or inline (its completer, paste surface, inline widget), belongs to the plugin that declared the kind, whichever plugin's setup registered it, so all the pieces of one kind resolve or degrade together. The descriptor has the same owner, though it's never filtered; its owner only decides who may augment it.
- A kind no plugin declared (every built-in, say) leaves the entry with whoever registered it, so a plugin's completer for `paragraph` or widget for `emphasis` shows only in the editors that list that plugin. The kind registries are built that way (`createBlockKindRegistry`, `createInlineKindRegistry`), and `createPluginRegistry` won't compile with a kind as its key.

The view is frozen-safe because it's additive over the global definitions: a built-in is switched off only by the `syntax` prop (indented code and setext headings), and the descriptor is never filtered. `parse(source, { grammar })` threads the instance's view through every parse (first load, each edit's reparse, a paste, every container body), and the inline scan reads the same view, so an unlisted plugin's syntax reads as plain Markdown there. The shared directive kinds (the generic container, leaf and text directive) belong to no plugin, whichever plugin's setup turns directives on, so an editor that left that plugin out still reads `:::name` as the generic directive. A plugin reads inline content through its editor (`EditorContext.computeInlineContent`, the factories' `getEditor()`, a widget view's props), which reads that editor's syntax; the free `computeInlineContent` is for a pipeline with no editor mounted.

### Plugin-kind naming and collision rules

`declarePluginKind(name)` is the only place a `PluginBlockKind` is created. It enforces the name pattern (a lowercase first letter, then letters, digits and hyphens) and rejects collisions with **built-in kinds**, **previously declared plugin kinds**, and two **reserved names**: `document`, the marker that distinguishes the CST root, and `global`, the keybinding-override scope. A second `declarePluginKind` with the same name throws, naming the first declarer when a plugin's setup did the declaring.

The `document` reservation matters less than it looks: node-vs-document narrowing is structural (`'raw' in node`), so a kind named `document` wouldn't corrupt the tree, and reserving it just keeps the contract unsurprising. `global` is the one carrying weight: override lookup takes a `'global' | AnyBlockKind` scope, so a kind spelled `global` would resolve its per-kind keymap through the global table.

### Events access: `on` canonical

The canonical path is `editor.on(event, listen)`, on the `Editor` a plugin value's `setup` gets and on a host's handle alike. It hears the `Events` map (`edit`, `selection`, `mode`, `theme`, `menu`, `load`, `search`, `error`) and returns a disposer. An `edit` carries the document after the write and the bytes it replaced (`changes`, worked out only when read); a whole document replaced is `load`, never `edit`. `src/lib/editor-events.ts :: onPluginEvent` reads each one off the older channel below, which stays until the old surface is deleted.

The older surface (`edit`, `selectionChange`, `presentationModeChange`, `themeChange`, `menuChange`, `sourceSwap`, `searchChange`, `error`) has two access paths, one per audience. A **consumer** reaches the full surface through the component method `getEvents()` (via `bind:this`), where `on(event, handler)` returns a disposer. A **plugin** reaches it through `EditorContext.events`, the subscribe-only view (`Pick<EditorEvents, 'on'>`, so `on` only, no `emit`) handed to an `onEditor` callback, a global-command handler, or a block command's `ctx.editor`. A plugin-visible `emit` would freeze at 1.0, so the plugin path exposes subscription and nothing more. The internal `setContext` wiring that hands the same emitter to child components isn't part of the contract.

`sourceSwap` exists so neither audience has to infer a whole-document replacement: `edit` stays the channel for edits alone (a host marking dirty on it never hears its own `source` write), and `editEpoch` bumps for both, so a plugin tells them apart by the event, or by `EditorContext.documentGeneration`.

## The pre-freeze surface

Everything a plugin author reaches today comes through the `@voithos-labs/aragonite/plugin` subpath, or through `/svelte` for whatever names a Svelte type (the factories, `BlockList`, `svelteBlockView` and the other view helpers), and a React or Vue author reaches two more helpers through the wrapper packages ([Block views](#block-views)). Every one of those exports freezes at the release cut, and [the plugin API reference](../guide/plugin-api.md) is the list, tagging the groups still unstable. This section is the decisions behind each piece.

One packaging fact first: the tarball carries every internal module's `.d.ts`, on purpose. Encapsulation is the exports map's job. It lists the barrels and nothing else, so a deep runtime import doesn't resolve, while the shipped declarations stay a greppable types reference.

### The plugin unit and the `plugins` prop

`definePlugin({ name, setup, defaults?, parseOptions? })` packages a plugin's global registrations into one installable unit, along with the defaults its per-editor options start from; the editor's set-once `plugins` prop installs each once per process, before the instance's first parse. `installPlugins` on the main barrel is the editor-less entry for `parse()` pipelines, and `isPluginInstalled` probes an install.

```ts
import { definePlugin } from '@voithos-labs/aragonite/plugin';

export const callouts = definePlugin<{ maxDepth: number }>({
	name: 'callouts',
	defaults: { maxDepth: 6 },
	setup(ctx) {
		// global registrations go here: declarePluginKind, registerBlockKind, registerBlockCompleter, ...
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

_Freeze litmus._ The unit's frozen shape must leave additive room for (a) the per-instance enablement policy layer over the global definitions, (b) lazy or deferred setup, and (c) a declarative-manifest overload. None is needed by a pre-freeze consumer; all are additive. Two boundaries matter. The ambient marker that attributes a setup's kind declarations to its plugin is **synchronous-only by design**, so a future async or lazy setup path must thread the owning plugin explicitly rather than widen the ambient mechanism. And there's **one context object**: the `EditorContext` an `onEditor` callback receives and a block command reads through `ctx.editor` are one type, and must stay one.

### Registration base (frozen)

The frozen layer is kind declaration (with `declaredPluginKind`, which gets a declared kind's brand, its typed name, back in another module without a cast), kind registration (the descriptor, its view and its opener in one call, the view made by `defineBlockView`, `svelteBlockView` or `textBlockView`), and typed per-node plugin metadata. The calls are listed in `docs/guide/plugin-api.md` § Kind declaration, § Block views and § Node access and metadata.

Frozen here means the model: which calls exist, that they register once and conflict on a duplicate, and what a kind is. The shapes those calls take still follow the pre-freeze rule, and freeze with the authoring surface at the release cut.

On `BlockComponent` itself, caret placement is two verbs. `focus` places a caret and also ends any live cross-block range, the safe default an author gets by writing nothing special. `parkCaret` is optional and lands the caret without ending the range, for the editor's selection-extend paths; a block built on either factory gets both, and G2.12 guards which callers may reach the second. Keep them two.

`BlockComponent`'s optional members stay **flat**, not grouped into named facets. The caret members' three layers are documentation (`docs/design/editor.md` § The editing surface), and `ContainerBlockComponent`, the container members promoted to required, is the one tier the types themselves carry.

### Helpers

The parse and serialize halves, the built-in grammar scanners (fences, HTML tag lines, blockquote extent), the renderer slots and the performance helpers sit on the barrel so a plugin never deep-imports `core/` or forks a CommonMark rule; the plugin API reference lists them. Two decisions come with them. The node read helpers are pure and uncached, so no caller comes to lean on a cache. And a plugin opener prices its place against `OPENER_PRIORITIES` as an offset from a named built-in, never a bare integer.

### Enter completion

`registerBlockCompleter` is the opener's sibling for a grammar whose lines must be adjacent, which Enter alone can never type into existence. An opener recognizes a line while parsing; a completer reads the one line the user just typed at an Enter press and answers the lines that complete it. Block math is the validating consumer (`$$` plus Enter inserts the fence pair with the caret in the body); without the plugin the same line splits like any other paragraph. A completer whose claim can only mean one thing the moment the line is complete registers `onType: true` and is also consulted as the line is typed, so the structure forms at once. Block math does (`$$` forms the block as the second `$` lands); a table's header row doesn't, since it's a prefix of a longer row still being typed. An on-type completer is asked before the typed line is written, so a lone `$$` never lands as a line the math block below could read as its opener. A line no completer takes, text pasted into the line for one, gets the closer its opener's `readingNotFinal.closer` names when a line below would close it otherwise, as long as the kind is a leaf, whose opener line is text the caret types in.

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

### Block types

A plugin value lists its block types in `contributes(options).blocks`, and a maker builds each one: `lineBlock`, `fencedBlock` and `container`, in `src/lib/components/block-makers/`. A maker works out everything about the type when it's called (the descriptor, through one derivation in `src/lib/schema/block-shapes.ts`, plus the opener, the completer and the view) and hangs it on the type, so importing one registers nothing. The editor names a type `plugin/name` when it first installs it. Every descriptor read in the editor is by kind, so while any editor runs the plugin the type's facts sit in a page table under that name (G1.192), and each editor's grammar reads its own types' openers first, so a type parses only where its plugin runs.

The facts come from what the spec's keys do, never from a list you declare, and gap edges are the one that surprises people. They follow what Enter does in the block, by the rule in `docs/contributing/adding-a-block.md` (an edge a gesture of yours already covers stays closed):

- a box (`edit: 'box'`) opens only the edge above it, since Enter on it, focused whole, opens a paragraph below;
- a text spanning lines opens both, since Enter there types a newline;
- one line opens neither, since Enter splits it at either end.

So two boxes back to back have no gap caret between them, and a box with an editing surface of its own gets to the paragraph below through whole focus, which an Escape its field doesn't `preventDefault` hands back (as does `ctx.focusWhole()`). `leaf-facts-parity.svelte.test.ts` and `container-facts-parity.svelte.test.ts` hold the derived facts equal to a hand registration of the same shape.

A container block type's lines go through the same four homes as the built-in quote's: the reader `src/lib/core/parsers/strip-container.ts :: stripOpener` (G4.320), the container writer (G4.305), which writes a head line (an alert's `> [!NOTE]`) through the writer `headedLines` carries, the byte map (`src/lib/tree-operations/container-offsets.ts`), which finds each line's marker with the shape's `reads` or `open` (G1.207), and the range-edit core, which reads a line's markers through the marked shapes a grammar lists in `GrammarView.markedLines()`, a required member (G1.210). All four read one line syntax, which is why a marked shape's `reads` has to take its own markers whole (G1.191).

A drawing reads its block as a `Block` (`src/lib/schema/doc-view.ts`), one per node. Its `from` and `to` are worked out when read, because a keystroke in a block above moves them without telling the drawing: the block keeps where it was last seen, moves that through the runs each write reports, and answers only where its own node stands (`src/lib/editor-actions/commit/document-read.ts :: createDocumentRead`, G4.371). Anywhere else both are -1, never a neighbour's place, and a draft refuses that range. A block read from another editor or a parsed document isn't placed in this one: `view` and `select` answer for it as for a block that's gone (`document-read.ts :: pathOf`), and a dev build warns once. A key typed in the block replaces its node, so the block `update` hands the drawing is the one to read. `block-range.svelte.test.ts` and `held-block.svelte.test.ts` hold it. The pair spans the bytes the node itself holds, one rule for every kind: `to` is past the block's line ending, or at its text's end where its container closes the line behind it (a summary's `</summary>`, a cell's pipe), so a write over the pair never takes a container's tag. `src/lib/tree-operations/container-offsets.ts :: DocumentByteMap` answers it as `ownEnd`; a range gesture's `endOf` runs past the tag. `block-at.svelte.test.ts` holds it.

### Block views

A kind's `view` is what draws it, and the editor never talks to whatever drew it. `BlockHost` turns every view into one `BlockComponent` ref (the object focus dispatch, the overlays, the clipboard and the command router all call), so a view is just one way to fill that ref. There are four ways in. A block type's `draw`, from a maker, runs in the editor's draw host (`src/lib/components/drawn-block/`). `defineBlockView` takes a plain DOM spec, `svelteBlockView` takes a Svelte component that `BlockHost` renders inline the way it renders a built-in block, and `textBlockView` is the editor's own text block.

**The draw host.** The editor makes the block's own elements before it calls `draw`: `ctx.source` for a block with text, `ctx.children` (with the child list already mounted) for a container, the focus and keys for a box. A drawing only places them, and the editor puts its caret, IME, undo and windowing there, as ProseMirror does with `contentDOM`, so no handler list is part of the public contract and a drawing can't forget `compositionend`. The text leaf behind `ctx.source` is the same editable-leaf factory a Svelte component calls; `edit: 'text'` and `'source'` are its two modes. `update` runs when the block's bytes, path, presentation mode, theme, focus or typed text change; without one, what `draw` drew stays, and a dev build warns once for a block type that declares `depends`. A dev check after `draw` fails a drawing that leaves `ctx.source` out of its DOM or puts an element inside it (G1.136).

**The DOM shape.** `mount(target, ctx)` fills an element the editor made and hands back optional `update(state)` and `destroy()`. The editor measures `target` as the block (rects, the drag handle), so the view fills it rather than wrapping a second box inside (G1.136). `update` runs when the block's bytes, path, presentation mode or theme change. Returning `false` from it throws the view away and mounts a fresh one, the same way ProseMirror's `update(node)` declines.

**A DOM view draws a container.** `DomBlockView.svelte` runs the container factory inside the editor's own runtime, publishes its ref, and only then calls `mount`. The view hands the editor the box its children go in (`ctx.container.mountChildren`) and wires no handler of its own. A block of text or a box is a block type's `draw`, whose host builds the leaf; a kind with no container group refuses a DOM view at registration.

**What the rest of the document says.** A block type, an inline widget or a paint built from other blocks (a table of contents, footnote numbers) declares `depends(block)` beside `draw` (`paintDepends` beside `paint`): a string per top-level block, read from that block alone. `src/lib/editor-actions/commit/block-keys.ts :: watchKeys` asks every top-level block once, then only the blocks each write's runs replaced, after the write, and hands the answers to `draw`, `update` and `paint` as `ctx.depends` (a widget's as `props.depends`), an array never changed after. The watch is the editor's, one per `depends` function (`document-read.ts :: keys`): a block type's drawings share it, so a toc scrolled out and back asks nothing, and one nobody reads lets go of the writes after a while and asks every block again when read. `update` runs, or the blocks on screen paint again, when an answer that says something comes, goes, changes or moves to another index, so the answers stay aligned with `editor.doc.blocks`; a key in a block that answers '' costs one ask. The limit: a key inside one very large top-level block re-asks that block, so typing in a list of 25,000 items costs a walk of it, about today's toc's 45 to 50 ms. G1.230 compares the kept answers with asking every block again.

**Framework helpers live outside the core.** `reactBlock` and `vueBlock` ship in the wrapper packages (`packages/react`, `packages/vue`), import only types from `/plugin`, and never get imported by the core, so the core's types and its prebuilt copy name no framework. Each one renders its component synchronously (React's `flushSync`, Vue's `render`, since a Vue state change re-renders a microtask late), because the editor's elements have to sit in their slots by the time `draw` returns. A block renders in a root of its own, so a host app's providers reach it only through the helper's `wrap` (React) or `app` (Vue) option. A component's `focus`, `keep` and `caret` reach the editor through `useDrawn`: the helper's `Drawn` reads them through getters each time the editor asks, so a ref filled after the render still counts.

### Container authoring

`createContainerBlock` wires a nested-`BlockList` container (list state, ancestor contexts, nested actions, windowing, the `BlockComponent` surface) so a plugin container is as thin as the built-in blockquote. It returns a `ContainerBlock`, whose `containerApi` is the `ContainerBlockComponent` (the container methods it always supplies, typed as required) and whose `blockListProps` are the props for the `BlockList` component itself, on `/svelte` because the plugin's own markup mounts it. A container publishes that surface as one instance export, `containerApi`, since Svelte 5 instance exports can't be spread and forwarding a dozen members by hand made every member a place to drop one. `svelteBlockView`'s exports type makes a missing export a compile error. `BlockComponentProps` names the props `BlockHost` passes every component.

A container may contribute an ambient prefix (a read-only marker drawn in front of its first prose child's text) through the factory's optional `getAmbientPrefix` dep (a DOM view's `ambientPrefix(state, editor)`), a live getter forwarded to the nested list as `ambientPrefixForFirst`; the footnote definition's `[^label]: ` marker is the validating consumer. The prefix's shape, interactive ranges included, is `docs/design/structural-edits.md` § Ambient markers.

**Taking the changed-child hint.** A `rebuildRaw` that re-emits one child's region needs to know where each child's bytes sit in its own raw, and the only supported home for that is `node.childSpans`. The editor keeps that field honest: the pass that re-derives blank-line separators after a splice drops it when it moves a separating line, the commit-time rebuild reseeds it, and G1.36 counts it against the children. Offsets cached anywhere else (plugin metadata, a module map, a `WeakMap`) go stale unseen. Declining the hint and re-deriving the whole raw is always correct, and the container conformance kit compares a hinted rebuild against a full one either way.

**What a rebuild writes.** A `rebuildRaw` writes `raw` and nothing else. When the bytes it writes move an opaque container's opener or closing line (a fence it lengthened past a body line, say), the editor re-reads the container's metadata from those bytes through the parser, so the `:::` writer, `serializeDirective` and a hand-written rebuild all leave the counts in metadata alone. A strip container gets the same treatment for its first line, which is where its metadata has to live: the editor reads that line alone on each change that moves it, and parses the container only when the line reads differently from the metadata it holds. A rebuild can ask for that parse itself by returning `{ rereads: true }`, for bytes it kept that may now read as other blocks (the editor's line writer does, when a lazy line it kept stops continuing its paragraph). And when every child's bytes are gone (the user deleted the last text at the very end of the file), the rebuild still writes the container's opening line, `[^1]: ` for a footnote. A rebuild that writes nothing there saves a file that reopens without the container, and G1.55 flags it in dev.

### Editable chrome

A container's title row is its child 0, a one-line leaf that holds its title (a `<details>` summary, a callout's heading). The machinery enforces the **reserved-chrome contract** on it: the row is always present, single-line (unsplittable; paste flattens inline), cleared rather than node-deleted by destructive ranges, and kind-stable through every edit. There are two ways to get one.

- **A `:::` container gets its opener line.** The directive grammar puts `:::note Heads up` in front of whatever the `fromDirective` factory returns, verbatim, as a leaf of kind `directiveOpenerLine` (`core/directive/container-opener.ts`). Nothing is declared: `reservedChromeKindOf` answers for every kind the directive registry holds as a container, so a `:::` container without the row can't be built. The row's `:::note ` (name plus the spaces after it) is a dimmed marker like a heading's `# `, the title is the rest, and `rowContentRange` says where that is.
- **Any other container declares one.** `reservedChrome` on the descriptor names the row's kind, one `registerChromeLeaf` call binds that kind with a default keymap (Enter descends to the body; chord-keyed overrides), and the opener builds the node with `chromeChild` (the title text plus its trailing newline).

Because an opener line carries the name, the contract has three more rules there, all in `schema/reserved-chrome.ts`. A range that runs onto the row from outside clears the title part it covers and keeps the marker; a start cut inside the marker keeps the whole marker, its space included, so the next letter lands in the title. Nothing merges into the row. And a paste with the caret on the row lands at the title's start, never inside the name (a paste over a selection inside the row is an edit to the name, and goes through). A summary row has no marker, so all three leave it as it was.

One more promise comes with the row: none of the container's metadata comes from the title. A title keystroke skips re-reading the metadata (which would mean parsing the whole container per keystroke), so breaking it leaves the metadata stale while you type. The container kit's `titleRow` cell catches it, and so does G1.12 in dev. The one exception is the `:::name` part of an opener line: a change there re-reads the container, which is how renaming `:::note` to `:::tip` (by hand or through `withDirectiveName`) turns it into the other kind, metadata included.

### Collapsible containers

The declaration optionally carries a pure collapse probe, `isCollapsed` over the node. From that one declaration, every child-adjacency operation is collapse-aware: merge from below, focus walks in and out, a Shift-extended selection (it stops on the title row and never opens the container, and deleting a range that covers any of that row, or runs past it, takes the whole container, hidden body included), Enter-descend, and reveal (mounting an off-screen block before something touches it). The container factory derives its window clamp from the same probe, and windowing estimates a collapsed container at one chrome row. `isCollapsedContainer` reads the probe off the descriptor, so a component's own disclosure UI and the model-layer walks share one definition. A `:::` container that wants the probe declares `reservedChrome` naming `directiveOpenerLine`, the row it already has, and G1.18 refuses any other kind there.

The factory also returns a metadata-commit handle, `updateOwnMetadata`, for behavioral fields like a collapsible's open state: merged, raw-rebuilt, and undoable in one commit. It takes the caret as a value too (`{ caret: { path, offset } }`, relative to the block), which the commit lands through the editor's caret landing, so a plugin never focuses anything after its own write. In reading mode, which writes no bytes, the commit declines it as a no-op, and a dev build warns with the operation and the block's kind.

Beside the probe sits its inverse: `expandPatch` returns the metadata patch that opens a collapsed node. A reveal aimed at a hidden body child (a toc entry, a search match) commits that patch through the same handle the disclosure toggle uses, so the expansion is a real undoable edit, and reading mode, which commits nothing, expands nothing. Every collapsed ancestor on the path opens, outermost first, one undo entry each. A kind that declares no `expandPatch` reveals exactly as it would without one: the target stays unmounted and the reveal reports that it didn't land.

### Editable-leaf authoring

`createEditableLeaf` is the container factory's sibling for leaves. It takes getter deps (`getNode`/`getIndex`/`getPath` plus `getEl()`, so a captured value can't be passed) and returns a `blockApi`, everything the editor calls on the block, which the component publishes as its one export.

- **Two modes.** `plain` is always editable, with per-keystroke commits, prose undo batching and a view the factory keeps in sync. `render-primary` swaps between a rendered view and the source, owned by the component, and the reveal-edit-blur cycle commits as one undo entry. Its deps union requires `isRevealed` and `setRevealed`, and the factory throws without them for a caller the types never reached. Block math is the render-primary validator; the `%%` memo harness kind is the plain one. A block type's text gets the same two modes as `edit: 'text'` and `'source'`, built by the same factory, with the draw host owning the swap flag and handing it to the drawing as `ctx.focused`.
- **A move or a plugin command writes an open source first**, through `blockApi.afterSourceCommit`, so a command's handler reads the bytes the user typed. A container's command waits on the block inside it that the key came from. A scan holds each leaf component to exporting the factory's object rather than a flat copy of it (G4.73), so no member gets dropped on the way out.
- **`singleLine` is orthogonal to the mode.** A kind whose bytes are one line takes Enter as a block split instead of a literal newline, through the same `splitBlock` entry a heading's Enter takes, and the fold and the split share one undo entry.
- **Commits land through the shared block-edit entry** every text edit crosses, so multi-block text structurally re-splits there.
- `StickyColumnDirection` (`'above' | 'below'`) is on the barrel because a leaf's `focusAtColumn` receives it; it says which side the caret arrived from.

### Supporting descriptor fields

A few fields earn prose beyond their table row below. `blockFocus: 'whole-block'` opts an opaque childless block into the focus-then-delete model: arrow traversal stops on it, a caret-adjacent Backspace focuses it before a second press deletes, and when a merge can't happen, the fallback in either direction focuses it rather than doing nothing. Such a kind can't also parse inline syntax, declare a content start or reserve a title row; the registration type refuses all three. `getFocusEl` (a DOM view's `ctx.container.attachFocus`) declares that focus surface rather than receiving DOM focus itself; a DOM view gets whole-block focus from the kind's declaration alone, and `attachFocus` on any other kind throws. The factory mounts a hidden editing host in the chrome box and lands focus there, because AltGr and IME input reach an editing host or nowhere; a declared surface that's itself editable keeps its own caret.

`gapEdges` (`'before' | 'after' | 'both' | 'none'`) is the required gap-caret declaration. A kind whose surface traps the caret at one or both of its edges says so, and the boundary it shares with a sibling declaring the facing edge becomes a place a caret can park and a paragraph can be inserted; the gap caret itself (the caret parked between two blocks where neither surface can host one) is `docs/design/selection.md` § The gap caret. `'none'` is the explicit answer that the surface, or an existing affordance, already covers insertion at both edges. It's required rather than optional so that leaving it out can't silently mean `'none'`.

`estimateHeight(node, env)` is windowing's height guess for a block it hasn't measured yet: an O(1) pixel estimate, with the width and text metrics in `env`. A kind that renders at a stable size declares that size (a Mermaid diagram at its placeholder height), so the scrollbar is already right before it mounts. A real measurement still beats it (`docs/design/virtual-rendering.md`).

### The descriptor field reference

The registration shape freezes at 1.0, so every descriptor field freezes with it, and this table is the inventory. Every row is a cross-cutting fact some subsystem reads instead of branching on kind; the admission bar at the end keeps the table from growing by habit. A lint (G4.53) keeps this table and `BlockKindDescriptor` identical in both directions.

_Tier_ is the kind class that can meaningfully declare the field. `container` marks the fields registered inside the `container` group, where declaring one on a leaf is a compile error. `whole-block` and `grid` name the tier the field creates or presupposes (a container that parses childless is a whole-block unit, and `blockFocus` is how it says so). `leaf` marks the fields a kind with its own text surface declares; `any` marks the rest. Semantics live on the type (`src/lib/schema/block-kind-descriptor.ts`); this table carries what the field is for, and what leaving it out means.

The table lists the flat shape the editor reads back, which isn't quite what you register. Besides the `container` group, two rows register as a pair: `getContentRange` and `contentStartBackspace` go in as `contentStart: { range, backspace? }`, since the Backspace behavior means nothing without the range. And a container with a title row declares only `unwrapRole.middleChildBackspace`; keeping the title row when Backspace lands at its start is implied, and the editor fills that strategy in itself.

| Field | Tier | Omitted means | What it declares |
| --- | --- | --- | --- |
| `mergeRole` | any | required | The kind's role when Backspace tries to merge it with a neighbour |
| `editable` | any | required | Whether the kind carries text of its own; a non-editable kind is skipped by the document scan |
| `label` | any | the kind name in words | What the block is called: its accessible name, and the noun in its block menu rows; blank throws |
| `supportsInline` | any | required | Whether the kind's raw carries inline syntax the inline parser processes |
| `isContainer` | any | derived, never declared (the `container` group's presence is the answer) | Whether the kind holds children |
| `containerContract` | container | registered as `container.contract`, or given by `lines` | The raw-to-children relationship: strip, grid, or opaque |
| `rebuildRaw` | container | required with `contract`; a group with `lines` has none, since the editor writes its bytes | Recompute the container's raw from its children and metadata. A second argument names the one child whose raw moved, for a rebuilder that can re-emit that child's region alone; ignoring it is always correct, and a kind that takes it keeps its offsets in `node.childSpans` (above). It may return `{ rereads: true }` to have its bytes read whole after it (above). It rewrites only the lines of the child that changed, keeping every other line as the author spelled it; the container conformance kit checks that against the profile's `deepNesting` source |
| `bodyWrap` | container | the body opens on the container's own first line (given by `lines` when declared) | The wrap the opener parses the body with, when chrome lines bound it |
| `lastLineChild` | container | a strip's last child holds the last line (unless its inner suffix comes after it), a grid's last row does, an opaque container's own bytes do | Which child holds the container's last line, or -1 when the container's own bytes do (a table holding only its header row ends on its delimiter line). A file with no final line break gives that line's ending up down this path |
| `bodyWrite` | container | a child's bytes are written verbatim | Make text legal as a child's bytes inside this container's body, and say where a caret in it lands |
| `reservedChrome` | container | child 0 is an ordinary body block (a `:::` container's child 0 is its opener line regardless) | Child 0 is a reserved chrome leaf, optionally with a collapse probe and an expand patch |
| `lines` | container | the kind writes its own bytes through `rebuildRaw`, and copy and paste write no marker on its lines | How the container's lines are written, as data: a marker on every line (`> `), or on the first with an indent after (`- `, `[^1]: `), with `lazy` for a line that continues a paragraph without one. The editor writes the container's bytes from it and the children, keeping every line an edit didn't touch, and cut, copy and paste read its markers from it |
| `merges` | container | a pasted container of this kind nests in one it lands in | When two containers of this kind are one container: when the metadata field `key` matches (`{ key: 'label' }`), or always (`{}`). A pasted one then joins the one it lands in. A kind with a closing line of its own (a `fenced` or `colon` line shape, or `bodyWrap.beforeCloserLine`) can't declare it, and registering one throws: plain text can't say which container a pasted closing line ends, so a pasted one always nests |
| `unwrapRole` | container | default Backspace dispatch | What Backspace at the start of this container's children does; a container with a title row declares only the middle-child strategy |
| `contentStartSpace` | container | a space at a child's content start types normally | The first space typed at a child's content start completes the marker while it lacks its space. When text already follows the marker, the editor writes that space into the line itself; on an empty child it writes nothing, so declare it only if the container's writer keeps the line the editor wrote as it is, and writes the space itself once an empty child gains text |
| `reorderChildren` | container | children are not independently reorderable | Direct children reorder among themselves, optionally renumbering markers |
| `blockFocus` | whole-block | the caret walks through the block's own offsets | Opts a childless opaque block into the focus-then-delete model; the kind then declares `supportsInline: false` and no content start or title row |
| `foreignDragHitTest` | grid | the block has no interior a foreign drag can address | Viewport point to internal offset for a drag, declining off-region |
| `caretTargetAtPoint` | grid, leaf | the block resolves a point through its own DOM | Viewport point to child path plus offset, total within the block's box; a render-primary leaf names an empty path and the source offset its reveal click lands at. The point half is `caretOffsetAtPoint` on the plugin barrel, so the kind writes only the arithmetic between its two strings |
| `rawWrite` | any | bytes are written verbatim | Make text legal as this kind's own bytes, and say where a caret in it lands, at every write built outside the block's own editable text. An optional `text(raw)` names the bytes that are the block's text, its structure left out, for the dev checks that a range indent or a list move kept the text (additive-later: a new optional member) |
| `contentStartBackspace` | leaf | the merge cascade runs; registered as `contentStart.backspace` | Backspace at the content start gives up the kind's own structural bytes first |
| `renderImagesAsWidgets` | any | inline images render as widgets; read only where inline content renders | Opt an inline-bearing surface out of image widgets, back to the alt-only fallback |
| `contextDependentKind` | any | the kind's raw reparses to itself | The kind has no standalone recognizer, so an edit keeps it rather than re-deriving |
| `gapEdges` | any | required; `'none'` says the surface hosts insertion at both edges | Which of the block's edges get a gap caret |
| `getContentRange` | any | the content is the whole display; registered as `contentStart.range` | Where content starts and ends inside raw, past the kind's own markers; in a prose kind, bytes past the content end are structure, drawn as a marker after the text (a join lands above them, and a truncation keeps them) |
| `textPosition` | leaf | the block's text takes the caret whenever it's on screen | `'while-source-shows'`: the block draws a picture of its source until a click opens the text, so a caret or a range edge reaches the text only while it's open, and Backspace or Delete beside it lands in its body (its fence's, or the `bodyRange` it declares), or where it has none in the gap; a cut before it holds the gap at its edge, which gives way to a paragraph right there. A block type drawn with `edit: 'source'` sets it, so only a kind its own component draws declares it; a whole-block kind or a container can't |
| `bodyRange` | leaf | the hint judges the whole source, so a kind with fence lines never shows one | The body a user types between the kind's own fence lines, or null before it has a body line; the `placeholder` hint reads it to decide whether the block is empty |
| `keymap` | any | only the global table answers | Per-kind chord-to-command bindings, consulted before the global table |
| `estimateHeight` | any | a container gets the container estimate, a leaf the prose one | An O(1) content-height estimate in px for windowing; `schema/height-estimates.ts` holds the shared shapes |
| `pageRole` | any | `'object'` | Whether the block reads as prose (no drag handle; a prose leaf takes the clipboard rows on a right-click) or as an object picked up whole |
| `dragLabel` | any | the block's first words | What the drag ghost calls the block, for one whose text makes a bad label; a blank one throws |
| `samples` | any | the kind enrols in no sampled conformance cell | Markdown snippets that each open with this kind |

**Combinations the types cannot refuse.** Most bad pairings get caught before a user ever meets them, just not all in the same place:

- **They don't compile.** A leaf declaring a container field (G3.6). A content-start Backspace with no range, a whole-block kind that also parses inline syntax or reserves a title row, a title-row container naming its own first-child Backspace strategy, where a lifting one would carry the title row out as a sibling block, and `contextDependentKind` beside an opener (G3.10). A registration that skips the types (a cast, a plain JavaScript plugin) throws on those same pairs instead.
- **They warn when an editor mounts.** In a dev build, the merge role is checked against the known roles at the first editor mount or parse after the kind registers. Production doesn't check.
- **They fail the container conformance kit.** A declared unwrap strategy nobody implements.

What stays prose-only is the class no declaration can decide: whether a kind's surface genuinely traps the caret at the edge it claims with `gapEdges`, and whether a hook patched in after registration (`estimateHeight`, `caretTargetAtPoint`, `foreignDragHitTest`) belongs to a kind whose box has interior addressing at all. Both are answered by the kind's component, which the registry never sees.

**The admission bar.** A new field on this table must bring four things. It states a **cross-cutting** fact that more than one subsystem reads, or it belongs on the component or in the plugin's own options. It's **not derivable** from fields already here. Its **omission means today's behavior**, so every registration that predates it stays correct unchanged. And it **arrives with its guard**: a registration check, a conformance cell, or a shape that makes the wrong declaration a compile error, as high up the enforcement order in `docs/design/invariants.md` as it goes. A field that brings only the first is a component prop wearing a registry's clothes.

### Presentation-mode reads

`PresentationMode` (`'source' | 'reading' | 'preview-block' | 'preview-inline' | 'live'`) is the vocabulary, read four ways:

1. the live `presentationMode` prop, reflected as `data-presentation` on the editor root (absent in source, so the default DOM is unchanged);
2. an internal getter on the block context that joins the prose render key, so a mode flip re-renders every mounted prose block (the previews then reveal markers with CSS alone, never rebuilding the inline DOM on a focus or caret move);
3. `EditorContext.presentationMode` (a live getter) plus the `presentationModeChange` event;
4. the leaf and widget tiers: `EditableLeaf.getPresentationMode()`, an `inline()` widget's `mode` prop (updated on a flip), and on a registrar widget the live `getPresentationMode` getter in its view's props and `InlineWidgetEditingContext.presentationMode`.

**Mode litmus: handle non-exhaustively.** The union has grown once already, so a plugin that switches exhaustively over it is wrong by construction: the next mode is an addition to the union, not an API break. Read the one property your rendering depends on (most often "does this mode paint markers", or "does it write bytes") and default the rest. The platform's own read sites are written that way, which is why live mode arrived with no plugin-facing change.

The editor's theme travels the same paths (`EditorContext.theme` plus a `themeChange` event, the factories' `getTheme()`, the inline-widget `getTheme` prop). It's for content whose colors a rendering engine paints into its own markup, which must be redrawn rather than restyled. A renderer slot takes it as a required input (`render(input, { theme })`) and keys its cache on it.

Reading mode is enforced where the bytes are written: every commit, typing write, undo and redo declines in reading mode, whatever route reached it. The platform's own edges also stop offering the gestures (the chord dispatchers ignore a chord, the editable leaf never reveals its source, the container factory's whole-block keys run nothing), so a plugin inherits the inertness without writing mode code. The contract is that the mode writes no bytes, not that nothing responds: a view-only affordance may stay live (the bundled details disclosure does).

### Paste transforms

A plugin value's `rewrites` are keyed by the **pasted block's type**: each answers Markdown for the outermost block of its `from` type, the first listed answer taking it, its answer never offered again. They run in one function, `tree-operations/paste/paste-rewrites.ts :: rewrittenPaste`, which every route that lands a paste as blocks calls: the range-edit core's host, a table cell, and the block menu's Replace with clipboard. It declines plain text and the editor's own copy itself, and a drop never reaches it.

`registerPasteTransform` records a content-keyed, pre-parse rewrite of pasted plain text: named, register-once (a duplicate throws, attributed to the owning plugin), run in install order by `rewrittenPaste` after the value rewrites, before the parse. It's **content-keyed**, distinct from the internal, target-kind-keyed `registerPasteSurface` (which stays unexposed, see [Explicitly excluded](#explicitly-excluded)): a transform keys off the clipboard _content_ it recognizes, not the block kind the paste lands in, which is the shape the GitHub-alert-to-admonition conversion needs.

### Inline authoring

A plugin value lists its inline constructs in `contributes(...).inlines`, made by three makers: `inline()` (a claim at a prefix, drawn as a widget, as a built-in image or link in the plugin's own syntax, or as its bytes with a class), `mark()` (a rich-text mark edited like `**`) and `markerPair()` (two sides around ordinary text, drawn as nothing). Each is per editor: an editor names it `plugin/local` and reads it from its own inline table (`core/inline/scan/inline-table.ts`), so another editor on the page reads the same bytes without it. The `setup` registrars (`registerInlineSyntax`, `registerInlineWidgetKind`, `declarePluginInlineKind`) stay on the barrel until they're removed before the freeze, and nothing new calls them.

The freeze-time decisions riding this surface:

- **Recognition precedence: tried in a fixed order.** An editor's own constructs on a character are asked before its own reading of that character, then longer prefix first, then by name, then behind whatever their `after` names, so list order never matters and no rank is published. A one-character prefix the parse reads itself (`[`, `*`) is refused at make time; `[[` and `![[` reach those characters through a longer prefix. A claim that never closes leaves its bytes to the built-in reading. On `[` and `![` the editor also declines a claim the built-in reading of its bracket closes as a link or image inside, so `[^1](x)` is a link, as on GitHub, and no plugin decides that overlap itself. The trigger list and the dispatch order are `docs/design/inline-parsing.md` § The plugin tier.
- **One view shape (resolved).** A widget draws through `draw`, a `PluginView`: a function given the element the editor made for the widget and its props, which hands back optional `update` and `destroy`. Decoration widgets and badges and inline menu rows take the same shape, every slot mounts it through `plugin-view.ts :: mountPluginView` (G1.96, G4.186), and `svelteView`, `reactView` and `vueView` make one from a component. The props are `WidgetProps`: the claim's `data` and `source`, its document bytes `from` and `to` (getters, so an edit above them can't stale them), the `mode`, the `theme`, the `editor` and the `depends` answers. The editor's own widgets (raw HTML, decoded entities, directive text) draw from an internal table, and the image's stateful builder rides an internal hook; neither is exposed.
- **The follow click is the editor's.** A widget with `click: 'follow'` gets its `follow(data, editor)` run on the click the host picked for links (the `linkClick` prop), answered by one rule in `src/lib/activation-click.ts` for every route: a built-in link, a widget, a `class` construct's text, a block's own clickable span. The editor stands the source reveal down for exactly those clicks, since a widget swapped for its bytes under the click would unmount before it could act.
- **Editing policy: three declared fields.** `Widget` carries `delete` (`'whole'`, one press deletes it; `'select-first'`, the first press selects it), `arrows` (`'over'` steps it like a character, `'select'` takes it whole, `'into'` shows its bytes) and `click`. One caret-edge dispatch (`components/blocks/text/edge-policy-dispatch.ts`) reads them, mapped once at make time (`schema/inline-maker.ts`).
- **Writing back a borrowed kind: `write`.** An `as: 'image'` or `as: 'link'` claim reads as a real image or link, which is how an Obsidian-style embed gets resize handles rather than a decoration painted over bytes the tree never sees. The read paths need nothing more; the write paths do, because the editor's inverse for a built-in kind emits that kind's grammar. `write` is the way back: the edit hands it the image or link it produced and the claim's data, and takes the replacement bytes or `null`. **The default is a decline, not a fallback**: no `write`, or a `null` return, and no commit happens at all. An image edit setting a crop or a reference label is refused without asking, since the image piece holds neither. A link's text is a run of the claim's bytes, found at `LinkPiece.at` or as its one run after the prefix; a claim that spells it twice with no `at` is left as plain text. The rule sits at the single write point every image and link gesture crosses (`image-source-bytes.ts`, `link-source-bytes.ts`).
- **A claim begins at its prefix (limitation, additive to lift).** A matcher is asked where the text starts with the prefix, so a grammar whose significant character sits in the middle of what it claims (GitHub's cross-repo `user/repo#123`) can't be one construct today. It's a real gap, not a rejected shape; the fix is an optional, bounded lookbehind, an addition to the spec.
- **Marker pairs: the editor pairs them only for a removal.** Each side of a `markerPair()` is its own construct, claimed by its own matcher in any block, and the plugin matches the sides up by what they read. A live removal that takes one side and keeps its partner puts the side back, pairing by the pair's `key` where it gives one, else by nesting order (`live-mode.md` § 4.5). A side draws nothing where markers hide, and a letter typed at it joins the side its pair declares as its text (`live-mode.md` § 4.2).
- **Error rendering.** A throwing `draw` costs only its widget: the claim shows its bytes and the `error` event gets one report. A missing or throwing renderer resolves through the renderer slot's `missing` and `failed` outputs ([Helpers](#helpers)).
- **Construct policy rows: built-in, a plugin mark's, a marker side's.** Live mode's per-construct editing behavior (edge affinity, unwrap-on-empty, split behavior, revealability, the link card's reach, where a trigger may open the inline menu, the mark vocabulary a format chord writes) is a declared row per inline kind in `schema/inline-construct-policy.ts` (`docs/design/live-mode.md` § 3). The registrar stays on neither barrel. A plugin gets a row two ways, each lent to the page while an editor runs it (G1.229): `mark()`, whose row edits as `**` does and names its place by `after` (a built-in mark or another plugin mark), never by a bare rank; and each side of a `markerPair()`, whose row says which side of it a typed letter joins. Any other plugin construct gets the no-row default; an `inline()` construct's `split` travels on its own entry instead.

### Directive authoring

One shared opener owns the `:::`/`::`/`:` fence family and dispatches by name (`registerDirective`, probed by `isDirectiveRegistered`) across three tiers (container, single-line leaf, inline text), so plugins never collide on opener priority. A registered name renders through its own kind; an unregistered name round-trips through a generic fallback, so a document survives its plugin being uninstalled.

The `fromDirective` factory is required for container, optional for leaf, and rejected for text, enforced at registration. `parseDirectiveAttributes` is an opt-in, one-way `info → { label, id, classes, properties }` reader over the remark convention; the opener's info string, as typed, stays what gets written back. `serializeDirective` writes a fence back without losing a byte, and `COLON_LINES` is a directive container's `lines`: the editor writes child 0, the opener line the grammar built ([Editable chrome](#editable-chrome)), back as it stands, then the body and the closing line. `withDirectiveName` rewrites the name on an opener line, for a command that renames the container through `replaceRaw`. Two smaller symbols carry rules a hand-built fence would otherwise get wrong: `escalatedColonCount`, the fence length a body forces, for an emitter that concatenates `:::name` text by hand; and `DIRECTIVE_BODY_WRAP`, the wrap that says the blank line against the fence belongs to the fence, which `COLON_LINES` gives a kind and a parser of its own reads.

Activation is the explicit idempotent `activateDirectives()` call, not an import side effect: the authoring symbols alone don't claim `:::`. See [the directives guide](../guide/directives.md).

### Commands

A plugin value's block type places commands on its own blocks: in `chords`, keys that act in the block and the blocks it holds, and in `actions`, rows of its right-click menu. Such a command takes its block as its argument and runs on a block whose type places it, the one handed to it or else the nearest around the caret, whichever route reaches it (a key at a leaf or a container, a host's rebinding, `run` and `can`, the menu). The editor qualifies its id as the plugin's other commands are, and a key a block inside binds itself runs there first. A container type that takes a key the text inside edits with (types, deletes, pastes or moves the caret with, on every platform) leaves its plugin out. A type's key that another plugin's command holds as its chord leaves the later-listed of the two plugins out, as two chords do; two plugins' types may take one key. Over a selection across blocks, a key or `run` with no block runs it once on each covered block whose type places it (the outermost, where one holds another), as one undo step, and the selection stays. A block is covered as Tab over a range covers it, so one the selection reaches only the first character of is left out (`src/lib/selection/range-coverage.ts :: forEachCoveredLeaf`).

`registerBlockCommand`, a `setup` plugin's way, binds a `(kind, name)` block command and hands back its id, a branded name created the same way kinds are, which the plugin then binds in its kind's keymap (`CommandId` names a built-in command a binding can target; `KeyBinding` is the per-kind chord-to-command shape; `AnyCommandId` spans both). Dispatch reaches the two surfaces that can supply a handler its context, the editable leaf's keymap and the container's key handling. That context carries the mounted component's own view-state handles (`ctx.hooks`, from the factories' `commandHooks` getter) and `ctx.editor`, the dispatching instance's `EditorContext` for the plugin that registered the command. It writes the block two ways: `updateMetadata(patch)`, a container's patch that its `rebuildRaw` carries into the bytes, and `replaceRaw(raw)`, a rewrite of the bytes the parse reads metadata back out of, which is the only write a leaf takes (on a leaf, `updateMetadata` writes nothing and reports an error, G1.110). Anything more arrives as another field on this one context, never as a second context object, and `setup(ctx)` grows the same way. That's what freezes: a handler bound today must never meet document mutation as a different object tomorrow.

A plugin value's `command({ id, title, chord?, when?, run })` is the editor-wide sibling, listed in `contributes.commands`: the editor qualifies its id as `plugin/id`, keeps it in the one table per editor (`src/lib/schema/editor-contributions.ts`) that every command lookup reads through the activation, and runs it against the plugin's scoped `Editor` with the argument the dispatch carried (`run(command, arg)`'s, `undefined` from a chord), so it fires regardless of which block holds focus. An optional chord binds in the **plugin-global tier**, which resolves last, after every consumer override, built-in kind keymap, and built-in global chord. A chord the editor takes everywhere (undo, redo, the search bar's `Mod+F` / `Mod+H`), one an earlier plugin in the list holds, or one that doesn't read as a chord leaves the plugin out at install with one report; only a command that can run without its argument binds one (`CommandSpec`'s type says so). A chord on a platform caret key warns in a dev build and never fires.

```ts
const insertDate = command({ id: 'insert-date', title: 'Insert the date', chord: 'Mod+Shift+D', run });
// in plugin 'dates': runs as 'dates/insert-date', by value, by that id, or by the chord
command({ id: 'find-things', title: 'Find', chord: 'Mod+F', run });
// the editor leaves the plugin out: plugin 'dates' claims the chord "Mod+F", which the editor takes
```

A plugin command's throw, or its rejected promise, is reported under the plugin's name (`run plugin/id`) and counts as run. A block command's throw is contained at the dispatch boundary and surfaces as an `error` of origin `command`, attributed to its command, the plugin that registered it, and its kind. A block command bound on a built-in kind's leaf does nothing (with a dev warning), since those surfaces supply no context.

**A `setup` plugin's _block_ command is reached by chord, not by the consumer.** The instance's `editor.runCommand(id)` resolves the focused surface without a command context, so such a command's id finds no handler there and dev-warns. That boundary is part of what freezes: a plugin exposes a keystroke-free _block_ affordance by binding a chord or by publishing an API of its own. Lifting it later means widening the id space, which is additive. A plugin value's command sits outside the boundary, since `runCommand` resolves the global tier first, and so does a block type's placed command, which runs on the nearest block at the caret whose type places it.

**Over a selection.** A few pre-freeze additions let a plugin's command join what built-in keys do over a selection, each additive-later:

- `registerBlockCommand`'s optional fourth argument, `BlockCommandOptions`, with `{ overRange: 'afterRemoval' }`: a key bound to the command removes a cross-block selection first, the way Backspace would, then runs it at the caret that's left; a chord some keymap binds to a line break runs where text typed over the selection would land. An options bag on a signature plugins already bind, so another value later is one more addition.
- `BlockCommandOptions.overSelection: 'afterRemoval'`, the same over a selection inside the command's own block, with `ctx.afterRemoval` true so an "empty line" branch can tell the removal's emptiness from the user's.
- `BlockComponent.getCommandContext` (returning a `BlockCommandTarget`) and `BlockComponent.afterSelectionRemoved`: how the editor runs a plugin's command at a block after a removal. Optional members on a published type; the editable leaf supplies both, and a hand-built component that leaves them out gets a dev warning (or, for the second, a command run with the selection still there).
- `BlockComponent.holdInsertion`, the block's own insertion step: text typed or pasted over a selection goes in through the step of the block it lands in, so it crosses a hidden edge as a typed letter would (optional on the published type, required of every editable leaf by `src/lib/block-component.ts` :: `EDITABLE_SURFACE_MEMBERS`).
- `CommandRun`, the record of how a command came to run, with one field so far, `afterRemoval`: an optional third parameter to a block's `runCommand`, and extended by `BlockCommandContext`. A new field on it is an addition.

### The root document, in a component

`BlockComponentProps.document` delivers the read-only root document to every block component at any nesting depth; a component otherwise sees only its own node. A table-of-contents block reads the headings above it through this prop (the bundled `toc` validates it, nested). It's a **read-only** view, and mutation stays a commit's job. A block type's drawing reads the rest of the document through `depends` instead (Block views, above).

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

A plugin value paints a block at a time instead, through `Contribution.paint(block)` for a block of text and `paintContainer(block)`, which hands back block classes only, for a block holding blocks. The editor asks it only for a block it renders and keeps the answer while that block's bytes hold, so an edit asks the edited block again, the blocks around it only through `paintContainer`, and nothing else (G2.19). Its positions are document bytes, stored in the block's own offsets, so an edit above a block moves its paint without asking. When something other than the bytes changes the answer, the plugin calls `editor.repaint(blocks?)`, or declares `paintDepends` when that something is the rest of the document (Block views, above). Every overlay, widget slot and block class reads either kind through one per-block read, `src/lib/decorations/decoration-state.svelte.ts` :: `paintOf`, whole-document sources first.

A mark's hover has one lifecycle the editor owns, `src/lib/decorations/mark-hover.ts` :: `createMarkHover`, and what it promises a plugin is the guide's to say ([Interactive marks](../guide/plugin-guide/decorations.md#interactive-marks-click-hover-and-the-keyboard)). Where marks overlap, one precedence rule, `src/lib/decorations/mark-interactions.ts` :: `comparePrecedence`, picks the mark for the pointer and the keyboard alike.

### Rects

Viewport-space geometry over the rendered document, reached through `EditorContext.rects` (plugin) and `getRects()` (consumer): a block's bounding box; the rects covering an inline range (per visual line on wrapped prose, per cell on a table, with the end marker meaning "through the last measurable position"); the live native caret (null while a cross-block range is live); a `reveal` that mounts a block windowing skipped; and a `scrollTo(path, { block })` that reveals then scrolls.

`scrollTo` doesn't just scroll once. It sets a **reveal anchor** (held in `windowing/scroll-owner.ts`) that the top-level block list re-asserts after every measure pass, because a target past unloaded images would otherwise slide away: the images reserve height off screen and shrink on mount, and the browser clamps the scroll off the target.

`navigateTo(path, offset?)` adds a caret landing to the same reveal, at the block's start or at the offset you name. It lands through the caret landing's `navigate` (`selection/caret-landing.ts`), which every caret an edit puts down also goes through, so every caret rule comes from that one place, which is also why it's a member of `rects` and not a navigation object of its own. In reading mode the landing moves focus instead and leaves no caret: to a widget with a tab stop ending at the offset, else to the block. Rects are real only in a browser, so e2e tests cover the surface, with the selection-toolbar demo as its consumer.

**One editor object, read through getters.** The host's handle extends the `Editor` a plugin gets, so `doc`, `view`, `selection`, `mode` and `theme` are getter-backed reads on both (the handle adds `element`), each answered as it stands when read. `view` (`src/lib/schema/view.ts :: View`) is the geometry a plugin reads now, in document bytes, over the same rect reads; `getRects()` and `EditorContext.rects` stay until the old surface is deleted, and new geometry goes on `View`, never a second surface. An overlay sits in a layer the editor reads as the host's (`isHostChrome`), so keys and right-clicks inside it stay its own.

### Inline menus

A list under the caret that opens when the author types a trigger: `#` for a tag, `[[` for a link to another document, `/` for a command. A plugin value lists one as a caret menu (`menu()` in `contributes.menus`, `src/lib/schema/caret-menu.ts`); a menu whose rows read the document is still an inline-menu source (`EditorContext.inlineMenus`, `getInlineMenus()`) until a plugin value can read the document. The editor owns the part a host can't do from outside without racing it: it notices the trigger as the bytes land, holds the keys while a list shows, anchors the list to the typed range, and writes the pick over that range. Both shapes run on one session machine; a caret menu's rows come from `rows(query, { editor })`, a source's from `items(query)`.

The decisions riding this surface:

- **Typing is a difference, not an event.** One `edit` can carry several characters (dictation, a soft keyboard, an IME commit), and the caret can lag the bytes by a read, so the state keeps the caret's leaf as it last saw it and reads a trigger as bytes inserted so as to end at the caret. A caret that merely arrives beside an existing `#` has typed nothing and opens nothing; a burst carrying `#wo` in one change opens with the query already filled. The baseline is taken twice, at the event and at the root's `beforeinput`, and both are needed: drop the first and a trigger typed on the line Enter just made has nothing to differ from; drop the second and a click into a list item followed by a fast burst has no baseline in time.
- **A session is identity only.** Source name, path, trigger start. The query and the range a pick replaces are re-read from the live leaf after every edit and caret move, so nothing here can address bytes that moved. The trigger's bytes disappearing, the caret stepping out in front of the query, or the source declining the query each end it.
- **Five bare keys, no chord.** While rows show, the editor takes ArrowUp, ArrowDown, Enter, Tab and Escape at the root's capture phase, before the focused block sees them. An empty list holds none of them, and an IME composition takes them back. They're not in the reserved-chord manifest (G4.29), which covers modifier chords a host might bind.
- **A caret menu's pick writes nothing until it commits.** The `MenuPick` is a draft watching the trigger and the query: `write(inline)` splices one line of bytes over them, `insertBlock(markdown)` and `run(command)` take them out through the leaf write the old source pick used (so an emptied line stays one empty paragraph) and then paste or run, in one undo step. Picking ends the typing burst, so a pick that waits lands after the author's typing as its own step, where the query was, or is refused: `moved` once the trigger or the query changed, `unloaded` after a `source` swap. A plugin that writes through an editor it kept from `setup` instead can't be caught by the editor; `check`'s `waitingWrite` row on the testing subpath fails it.
- **A source's pick is one line of inline bytes.** `insert` replaces the trigger and the query through the same range splice the link card and the image popover use, as one undo entry. Empty is legal and removes the trigger and the query. A line break in it is refused and reported on the `error` channel, because a blank line inside one leaf's raw is corruption (a reload would read it as two blocks). A trigger is one line and never empty, and `addSource` throws otherwise, and on an editor that has already unmounted, rather than hand back a handle that can never open anything.
- **A row is named by its id.** Ids are unique within one list: where two rows share one, the first is kept, the rest are dropped, and the source is told on the `error` channel. The active row is named in the DOM after its id, not its place in the list, which a narrower query changes.
- **The editable reads as a combobox while a list shows.** The block the author is typing in says the list is expanded, names it, names the active row, and says the rows are suggestions; when the list goes it's a plain text box again (a consumer selecting on role sees the swap too). The pattern is written for a single-line field, which a paragraph isn't, and that's the price of telling a screen-reader user the list opened at all.
- **`openMenu(menu, query)` and `open(name, { query })` are the author's say-so.** Each types the trigger, then the query if given, at the caret as one undo entry and opens the list over it, skipping `where` (`opensAt` for a source); that's how a shortcut or a toolbar button reaches the same list. It declines and writes nothing for an unknown name, in reading mode, without a collapsed caret in a prose leaf, and for a query holding a line break. A query the source's `accepts` declines is still written, and opens nothing.
- **Where a session lives.** A collapsed caret in prose. Never a table cell (a pick may insert blocks, and a cell's line can't hold one), never a code block, and inside the leaf never an inline code span, a link's destination or title, an image, an autolink or raw HTML: a `#` there is a fragment or an attribute, not a tag. A destination still being typed counts too, read off the line's bytes before its closing `)` arrives. A link's own text is prose, and a trigger opens there. `open(name)` skips the in-leaf bounds the way it skips `opensAt`.

`menuChange` reports the list the way it reports every other editor menu. The harness's tag source (synchronous), its document-link and card menus (asynchronous; a pick that waits) and the bundled slash-commands plugin validate the surface.

### Code highlighters

Fenced code is plain until a plugin value highlights it: `contributes(...).code` is a `CodeHighlighter` (`src/lib/schema/code-highlighter.ts`), with `languages()` for the names and aliases it answers and `highlight(body, language)` for a body's tokens. The core draws the tokens and knows no grammar; the first-party one is the `highlight` package, over highlight.js, answering 24 common languages unless the host opts into all of them.

- **Several plugins may contribute one, asked in list order.** A spelling belongs to the first plugin listing it, and only that plugin is asked for it. The picker lists the union in that order, each plugin's languages in the order its `languages()` gives them, and a dev build warns where a later plugin lists a spelling already taken (`src/lib/components/blocks/code/code-languages.ts` :: `languageOwner`). The core sorts nothing, so a highlighter puts its common languages first.
- **A promise carries its answer.** The block paints plain at once and paints the tokens when they land, if it still shows the body and language it asked about; otherwise they're dropped, since the newer paint asked for itself. A throw or a rejection paints plain and reports one `error`, one rejection reason once (`src/lib/components/blocks/code/code-painter.ts` :: `createCodePainter`).
- **A language nobody lists paints plain** and asks nothing. So does every fence in an editor that lists no highlighter.
- **A source view paints its code the same way.** `renderSource(text, paint)` gets a `CodePainter`, and `paint.code(body, language)` goes through this one path, the late repaint included. Block math paints its LaTeX through it.

### Insert catalogue

The blocks the insert menus offer, as data: an id, a label, a menu glyph name, keywords, and the Markdown the block inserts. The built-ins come first in a fixed order, then each entry a `setup` plugin registered with `registerInsertEntry`, then each row a plugin value lists in `inserts` (as `plugin/id`), listed only in an editor that runs that plugin. The right-click "Insert block" rows, `inserts` on the editor and the handle, and `editor.insertCatalogue` on a `setup` plugin's context read this one list (`src/lib/schema/insert-catalogue.ts` :: `insertRows`), so a host's own `+` button and the editor's menu can't disagree.

A row can also take an argument, a word typed after it in the slash list (`/table 3x4`): its `insert` is then a function that gets the word (empty when none was typed) and returns the Markdown to insert, plus the dimmed text the row shows to say how it read the word. Which row a typed query hands its word to is `packages/slash-commands/src/filter.ts` :: `readQuery`.

Every block kind a bundled plugin installs can be inserted from the insert menus, or has a written reason it can't (G4.157). A footnote definition, say, is made by typing `[^x]:` under its reference, and the GitHub alert already has the note entry's admonition spelling.

Registration is register-once: a duplicate id throws, and so does an icon name the menu has no glyph for, since a row drawn with no icon is a silent no-op. The slash-commands plugin validates the surface.

## Payloads bound as-is

These are frozen _as the current shape_, but because they're payloads consumers _receive_, new fields and new union members can be added later without breaking a receiver.

- **`EditInfo`**: `{ op, detail, doc, changes, timestamp }`, what `editor.on('edit')` hands a listener: the document after the write and the changes it made in the bytes before it, in place of the older payload's path.
- **`EditEvent`**: `{ op, path, detail, timestamp }`, the older channel's payload, where `op` is the `OperationKind` vocabulary derived from `OperationDetailMap`. Emitted at each write as it lands: from the commit steps (the fixed steps every commit runs, `docs/design/commit-and-undo.md` § The commit primitive) for structural ops, and from a keystroke's in-place write as `op: 'input'`, one per key. A plugin's metadata edit (`updateMetadata` on a command context, `updateOwnMetadata` off the container factory) emits `op: 'metadataUpdate'`, and a command's `replaceRaw` emits `op: 'updateContent'`; the vocabulary is the editor's, and a plugin can't add an op to it yet ([Target shapes](#target-shapes-designed-ahead)).
- **`EditorError`**: `{ origin, error, context? }` with `origin` in `'subscriber' | 'render' | 'commit' | 'command' | 'decoration' | 'clipboard' | 'link'` and `error: unknown`, which is correct for a boundary.
- **`SourceSwapEvent`**: `{ generation }`, the older channel's, heard on `editor.on` as `load` with the new `doc` beside the generation; emitted last in a `source` prop swap, once the new document, its selection and its link references are in place; `generation` counts swaps since mount and matches `EditorContext.documentGeneration`.
- **`SelectionPoint`**: the between-blocks gap caret sits _outside_ this union on purpose, and `getSelection()` reads null while a gap is live. Publishing a gap position later arrives as an additive read-side shape, never a new union member every consumer must switch over. While an image is selected whole, `getSelection()` reads a collapsed caret at the image's edge (its end, after a click): the next `insertMarkdown` or keystroke replaces the image, and `setSelection` of that value puts a caret back without selecting the image again.
- **The undo stack has no public shape at all.** No frozen type exposes the stack or its entries, and the `edit` event's `undo`/`redo` variants stay representation-agnostic, so a collaboration or version-history representation adopted later stays additive rather than breaking a bound receiver.

## Editable content and the closure matrix

### The four tiers

Every mechanism for plugin content that is _itself editable_ falls in one of four tiers, each bound to a CST guarantee (prior-art record: `docs/research/plugin-extension-surfaces.md`).

| Tier | Shape |
| --- | --- |
| Container | children are real CST blocks in a nested BlockList; the contentDOM analog |
| Chrome leaf | a reserved, single-line, plain-text child the container's raw owns |
| Editable leaf | a recognizer-backed standalone text block with native caret/IME/undo/clipboard parity |
| Atomic widget | opaque non-text embed, caret-addressable at its edges |

The chrome leaf stays narrower than the general editable leaf on purpose. The one shape rejected outright, a nested editor serialized as a blob, sits in [Explicitly excluded](#explicitly-excluded) with its siblings.

### Every tier answers every system

A new extension tier meets every editor subsystem whether or not its author considered them, so "it renders and round-trips" is a fraction of done (the whole-block-focus tier shipped answering 2 of 9 and leaked 4 holes).

**The rule.** Every extension tier, and every new per-kind capability on an existing tier, must define its behavior under each cross-cutting system _before it ships_: it fills its matrix row, a ✓ or a recorded gap, never a blank.

**Every tier supplies `measurePartialRects`**, the childless opaque container included. A decoration is only as good as its worst-painting tier, so a tier that can't measure a partial range ships the whole annotation layer a hole the ecosystem inherits.

**A kind's row is run, not declared.** Registering a kind enrolls it in a generic per-cell suite, and each cell runs wherever the kind's descriptor and `samples` make it apply; there's no field to opt a kind out of one. The headless cells (round-trip, merge eligibility, byte-slice clipboard, undo, and the search skip for a kind that isn't editable) run at the unit gate; focus, selection paint and search paint run per registered kind in a browser sweep; reorder and the simulation column (`simOracle`: whether a long random editing session ever produces a document gone wrong) run in their own e2e suites.

**The inline tier has its own harness.** An inline recognizer carries no descriptor to hang a row on, so its equivalent is the inline conformance kit on `@voithos-labs/aragonite/testing` ([the testing guide](../guide/plugin-testing.md#the-inline-checkup-runinlinekindconformance) covers its cells). Its four declared cells are required declarations rather than optional ones, like the container kit's `terminatorCollision`, because each failure is invisible to a byte round-trip and an optional cell gets left out by exactly the recognizers that need it. Fixtures are required, an unclaimed one fails rather than skips, and an excuse the kit can falsify, it falsifies.

### The matrix

The rows are the interaction tiers a caret meets; they refine the editable-content tiers above. The block-level **whole-block-focus opaque** tier, a childless opaque block that is its own focus target (a diagram, say), is split out from the **inline widget**, the atomic embed inside prose; the editable-content table folds that block-level case under Container.

_Legend: ✓ closed (defined + covered) · n/a structurally absent · ◐ partial (a recorded edge case) · gap (a recorded hole)._

| Tier | Round-trip | Focus | Merge / backspace | Selection paint | Search paint | Reorder | Undo | Clipboard | Simulation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Container | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐¹ | ✓ |
| Chrome leaf | ✓ | ✓ | ✓ | ✓ | ✓ | n/a² | ✓ | ◐¹ | ✓ |
| Editable leaf | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Whole-block-focus opaque | ✓ | ✓ | ✓ | ✓ | ✓³ | ✓ | ✓ | ✓ | ✓ |
| Inline widget | ✓ | ✓ | ✓⁴ | ✓ | ✓ | n/a⁵ | ✓ | ✓ | ✓ |
| Widget/replace decoration | ✓⁶ | ✓ | ✓⁷ | ✓⁸ | ✓ | n/a⁵ | ✓⁷ | ✓⁹ | ✓¹⁰ |
| Block decoration | ✓⁶ | ✓¹¹ | ✓¹² | ✓ | n/a¹³ | ✓¹² | ✓¹² | ✓⁹ | ✓¹⁴ |

1. **◐ Clipboard.** Both chrome directions round-trip the container: an end landing mid-chrome yields a chrome-only container, and a start landing mid-chrome reopens the container around the collected body, closing it where the walk leaves the subtree. What remains partial is the generic case the chrome pair sits inside: an endpoint landing in a container's body is skipped as an endpoint ancestor, so unless one of the four recovery paths applies, that container's wrapper is lost (issue #42; folded into the post-1.0 clipboard generalization).
2. **n/a Reorder.** A chrome leaf is the container's reserved child 0; it has no independent block identity to move.
3. **✓ Search.** A match inside a childless opaque container is found (the block's raw scans as a leaf), painted through the container shim's `measurePartialRects`, and navigable. Replace rewrites it too: the substitution lands in a private clone's raw and reparses, so the kind re-derives its own metadata. The one decline is kind-stability: bytes that break the opener line come back as a different kind, and a diagram must not silently become a plain code block.
4. **✓ Merge / backspace.** A caret-edge Backspace or Delete reveals the widget's source or atomically deletes it; block-level merge stays the host prose block's concern.
5. **n/a Reorder.** An inline widget isn't a block, and reorder is a block-level gesture. A widget or replace decoration is the same shape: view-only inline DOM, no block identity.
6. **✓ Round-trip.** Decorations never enter the CST, so round-trip holds by construction; the bytes a replace decoration covers stay in the document and never leave `getSource()` (property-pinned over arbitrary placements).
7. **✓ Merge / backspace / undo (widget/replace).** A widget decoration (zero bytes) is transparent: destructive keys act on the adjacent real byte, and at a true block boundary fall through to block merge. A replace decoration (hidden bytes) is selected whole by an edge press and deleted whole by the second, one CST commit and one undo entry, because silently eating one hidden byte would be invisible corruption.
8. **✓ Selection paint.** Sweeps measure and paint through these decorations normally. Deliberate zero-length case: a widget decoration spans no bytes, so it's invisible to selection cover rects. That's correct (nothing is selected), recorded so nobody "fixes" it.
9. **✓ Clipboard.** Excluded by construction: copy yields the source bytes (in live mode with a format run the range cuts through closed at its edges), so a range spanning one copies the real bytes, hidden bytes included, never the decoration DOM.
10. **✓ Simulation (widget/replace).** A simulation session paints a replace and a widget decoration and drives their caret walk, edge select-then-delete, transparent backspace, and adjacent typing under the corruption checks, the decoded-entity widget included.
11. **✓ Focus.** The badge widget mounts non-editable as the host's first child and must not capture focus or caret placement; the decorated block stays a fully functional editing surface.
12. **✓ Merge / backspace / reorder / undo (block).** A block decoration is source-derived, keyed by path: after any structural edit or restore, sources re-run against the new tree and the treatment lands wherever the source now points, a table row or cell included; a badge addressed to a row or cell is refused with a dev warning, since a row has no box of its own and a cell's children are its editable text, which every keystroke re-renders. Cleanup on change and dispose (class, attrs, badge removed) is e2e-pinned.
13. **n/a Search paint.** A block decoration adds no text; class, attrs, and badge carry nothing the document scan can match.
14. **✓ Simulation (block).** The same session badges a block, reorders it, and asserts the treatment follows the bytes to the new path (and back on undo), with the corruption checks run again after the move.

Table cells match prose: **inline-widget reveal-to-edit** and **widget and replace decoration rendering + edit** run in a cell through the same code paths. The one cell-specific rule: every write a cell makes, a key typed into a shown source included, re-escapes pipes and drops the prose trailing newline, so an edit can never split the row on reparse.

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

| Surface | Type |
| --- | --- |
| Component props (`node`, `document`), `EditorContext.document`, `DecorationSource.provide` doc | view |
| Descriptor read hooks (`contentStart.range`, `estimateHeight`, `reservedChrome.isCollapsed`) | view |
| Command / widget-editing contexts (`BlockCommandContext.node`, `InlineWidgetEditingContext.node`), `getPluginMetadata` | view |
| `parse` result, opener / directive-factory products, `chromeChild` | mutable |
| Write hooks (`rebuildRaw`, `setPluginMetadata`); the commit steps hand them owned nodes | mutable |
| Write rules (`rawWrite`, `bodyWrite`): bytes in, bytes out, and a context naming the block they are written into | strings, plus a view |

## Target shapes (designed ahead)

What's still ahead, sketched just far enough that building any of it is an addition over a shipped shape rather than a rework of one. Nothing here has a consumer yet, and nothing here is frozen.

- **Plugin-op vocabulary extension.** A way for a plugin to contribute an `OperationKind` (and its detail type) so its structural edits emit typed `EditEvent`s. Additive over `OperationDetailMap`, and waiting on the first plugin op that isn't a metadata update (those already emit `metadataUpdate`).
- **A `parse` error origin, and a structured plugin-error shape.** Both additive on `EditorError`, whose origins today are the seven in [Payloads bound as-is](#payloads-bound-as-is); neither has a consumer.
- **Normalize-on-commit / veto hook.** A hook for a plugin to veto a commit or append derived mutations atomically within it (ProseMirror `filterTransaction`/`appendTransaction`, CM6 `transactionFilter`). Post-1.0: additive over the commit steps, whose internal shape plugins never bind, and built when a real consumer settles its shape (veto versus append, sync versus async). Invariant enforcement stays editor-owned. No frozen surface precludes it, and three constraints are already fixed:

  - **Copy on write extends to it.** The protocol that copies a node before the commit writes it (G1.9) has to cover a plugin-contributed mutation too, not just the editor's own.
  - **One call per commit, never re-entry.** A running commit is the one place a half-applied document exists, so the hook gets exactly one call at one point; a later call would see a tree the commit has already validated.
  - **The view it receives doesn't outlive the call.** An owned copy is valid only until it's written back through the `$state` tree (`docs/contributing/rules.md` § The tree is the truth), so a retained handle is a stale write handle. Revoking it on return is part of the hook's shape, the same way `PluginSetupContext` throws on a leaked context.

- **Per-recognizer editing policy for a borrowed built-in kind.** A recognizer that produces a **built-in** kind inherits that kind's editing behavior wholesale, because the caret-edge dispatch resolves policy by kind: an Obsidian-style `![[embed]]` produced as an `image` edits like a GFM image. The additive shape is a **claim-keyed policy lookup layered over the kind-keyed one** (the node's syntax claim first, then the kind). Merging the two key spaces instead would break the built-in widget kinds, which carry policies and have no recognizer at all.
- **A plugin grid's selection in its own coordinates.** The descriptor already takes the two point-to-internals hooks a grid kind declares (`caretTargetAtPoint`, `foreignDragHitTest`), and only the built-in table declares the drag half today; `SelectionPoint`'s cell arm is that table's row-major cell index. A plugin grid addressing its own cells through that arm is post-1.0 and additive over both (the decision table's "selection coordinate-addressing").
- **Unified command registry + palette.** One dispatch point resolves every command id, but the handlers live in three homes: a `setup` plugin's block command in the `(kind, name)` registry, a plugin value's commands in each editor's command table (`src/lib/schema/editor-contributions.ts`), and a built-in kind command on the component's own `runCommand`, so anything enumerating commands sees only the plugins' halves. Moving the built-ins is internal work; the shapes a plugin binds don't change.
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
- **Runtime unregister / replace**, and with it registry-level replacement of a built-in kind's component or descriptor. Plugin System II. Registries are process-global, so an override would be global and last-writer-wins, the collision problem every surveyed ecosystem has already hit. The supported replacement path is **grammar-level**: a plugin kind claims the syntax ahead of the built-in in the opener priority order and proves it answers every system by enrolling in the conformance suite.
- **GitHub's repo-context sugar**: issue and PR refs (`#123`), `@`-mentions, cross-repo `user/repo#123`. It resolves against a repo or vault the editor doesn't own, so it belongs to the consumer rather than to the library.
- **Plugin-local state** (ProseMirror `StateField`/`PluginKey`, TipTap `addStorage`). The omission is a decision, not a gap. State belonging to a node goes _on_ the node, where it undoes, redoes, and, if it feeds `rebuildRaw`, round-trips. The rest of the need disappears: a state field elsewhere mostly holds a decoration set and maps it forward through edits, because positions there are integers into a flat sequence. Positions here are `(path, offset)` into a tree re-derived every edit, so a decoration source is a pure `doc → Decoration[]`. A plugin wanting state keeps its own `Map` keyed on the editor id; the platform stores nothing.
- **`registerPasteSurface`.** Built, used internally by the table cell, and withheld. The use case that asked for it (GitHub alert to admonition) needs a content-keyed transform, which a target-kind-keyed surface can't express: registering for prose kinds collides with the built-in defaults, and its types would drag the commit internals public. The content-keyed half shipped instead as `registerPasteTransform`.

## Enforcement

Where a check can hold one of the rules above, its guard is in the invariant catalog (`docs/design/invariants.md`), so look there before adding one. The plugins e2e project fails on any guard that fires in dev.
