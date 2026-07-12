# Plugin Author Guide

Everything you need to extend the editor with your own block or inline content. The whole
authoring surface lives on one import path — the `aragonite/plugin` subpath — separate from the
`aragonite` embedding barrel a consumer uses. This guide is the entry point; for the `:::name`
directive grammar see the [directives guide](directives.md), and for embedding, theming, and
events see the [consumer guide](consumer-guide.md).

## 1. What a plugin is

A plugin teaches the editor a new **kind** — a first-class citizen of the document tree that
parses, renders, and serializes alongside the built-ins. You wire up to four things:

```
declare a kind ──┬─▶ descriptor   how it merges, its container/chrome shape, its keymap
                 ├─▶ component    how it renders and hosts any editable content
                 └─▶ grammar      how source becomes the kind:
                                    a block opener  │  a :::name directive  │  an inline recognizer
```

Only the kind and its descriptor are always required. A component makes it visible; grammar makes
it parseable from Markdown. A kind with no component renders a visible raw fallback; a kind with no
descriptor is an error at first use.

**Registration is process-global and register-once.** A kind is a definition every editor in the
page shares — the `customElements` model, where `customElements.define` defines an element for
every document. Registering the same kind, component, or opener twice is a **conflict that throws**,
not a silent override — so a plugin colliding with a built-in or another plugin fails loudly. There
is no unregister and no runtime replace.

Registrations get packaged into a **plugin** — a unit whose `setup` runs at most once per process
(below) — so you write each `register*` call straight; the unit, not a per-call guard, owns
idempotence. Editing a registration module still needs a full page reload to take effect — the
definitions cannot be hot-swapped in place.

### The plugin unit

A **plugin** bundles the registrations above into one installable unit. `definePlugin({ name, setup })`
validates it at definition time and returns an `EditorPlugin`; its `setup` runs the `register*` calls.
By convention a plugin is a **factory export** — `export function myPlugin(options?)` returns the unit —
so per-plugin configuration rides the factory's argument:

```ts
export function myPlugin(options?: { renderer?: Renderer }): EditorPlugin {
	return definePlugin({
		name: 'my-plugin',
		setup() {
			registerMyKind(options?.renderer ?? defaultRenderer);
			registerBlockComponent(declaredPluginKind('my-kind'), defineBlockComponent(MyBlock));
		}
	});
}
```

Install by passing units to the editor's **`plugins` prop** — set once at mount, before the first parse:

```svelte
<script module lang="ts">
	import { myPlugin } from './my-plugin';

	// Build the array once at module scope, not inline in the markup: an inline
	// `plugins={[myPlugin()]}` re-mints the unit every render, and the second render's
	// same-name/different-identity unit trips a harmless first-wins dev-warn. A stable
	// module-scope array is the canonical wiring.
	const plugins = [myPlugin()];
</script>

<Editor {source} {plugins} />
```

**A plugin installs once per process, keyed by name.** Passing the same unit again no-ops; passing a
_different_ unit under a name already installed keeps the first and dev-warns (naming the loser as
`name@version` when it carries a version). Units install in array order, and a `setup` that throws
stays failed — a later attempt rethrows and advises a reload, because a partial setup cannot re-run
against the register-once registries. Definitions are process-global, so there is no per-instance
plugin configuration: two editors passing the same plugin share one registration, and anything an
instance varies rides the factory's options.

For an editor-less `parse()` pipeline that needs the grammar live without mounting `<Editor>`, call
`installPlugins(units)` from the `aragonite` barrel — same once-per-process semantics.
`isPluginInstalled(name)` probes an install, for the rare setup that must branch on it; the prop and
`installPlugins` are already idempotent, so most consumers never reach for it.

### Stability

The authoring surface has two layers:

- **Registration base — stable.** Kind declaration, descriptor/component/opener registration, typed
  per-node metadata, and the idempotence probes. These shapes will not change in a breaking way.
- **Pre-freeze / unstable.** The plugin unit, the container factory and chrome leaf, the inline
  surface, and the directive surface. Built and refined against real consumers, frozen only at the
  public release — until then the shapes may change. They are labelled below.

## 2. The capability map

Every `aragonite/plugin` export, grouped by job. Values are the calls you make; the accompanying
types describe their inputs and outputs.

**Plugin unit** _(pre-freeze / unstable)_

| Export              | Role                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `definePlugin`      | Validate a `{ name, setup }` unit at definition time and return it for the `plugins` prop      |
| `isPluginInstalled` | Idempotence probe for a named plugin's install                                                 |
| `EditorPlugin`      | The plugin unit's shape — `<Editor plugins>` and the main barrel's `installPlugins` take these |

**Kind declaration**

| Export                            | Role                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `declarePluginKind`               | Mint a block kind from a name; rejects collisions with built-ins and prior kinds |
| `declaredPluginKind`              | Recover an already-declared kind's brand in another module without a cast        |
| `PluginBlockKind`, `AnyBlockKind` | The branded kind type, and the union of built-in and plugin kinds a node carries |

**Block-kind descriptor**

| Export                                                                                                                         | Role                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `registerBlockKind`                                                                                                            | Register a kind's descriptor — merge behavior, editability, container shape                                       |
| `augmentBlockKind`                                                                                                             | Merge extra fields into an already-registered descriptor                                                          |
| `BlockKindRegistration`, `BlockKindDescriptor`, `BlockKindAugmentation`, `ContainerDescriptorGroup`, `MergeRole`, `UnwrapRole` | The descriptor's write shape, read shape, augmentation patch, its container-only group, and the closed role enums |

**Component registry**

| Export                                                         | Role                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `registerBlockComponent`                                       | Bind a kind to the component that renders it                                             |
| `defineBlockComponent`                                         | Wrap a Svelte component into the registry's entry shape                                  |
| `BlockComponentEntry`, `BlockComponent`, `BlockComponentProps` | The registry entry, the component contract, and the props every block component receives |

**Parser opener**

| Export                       | Role                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `registerBlockOpener`        | Teach the parser to recognize a block's own Markdown syntax          |
| `BlockOpener`, `OpenContext` | The opener contract, and the line cursor it inspects to open a block |

**Directive authoring** _(pre-freeze / unstable)_ — full semantics in the [directives guide](directives.md)

| Export                                                                                             | Role                                                                                            |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `activateDirectives`                                                                               | Turn the `:::name` grammar on; call once at startup, before the first parse                     |
| `registerDirective`                                                                                | Map a `(tier, name)` to one of your kinds                                                       |
| `isDirectiveRegistered`                                                                            | Idempotence probe for a directive registration                                                  |
| `parseDirectiveAttributes`                                                                         | Opt-in reader pulling `[label]{attrs}` out of a directive's info string                         |
| `serializeDirective`                                                                               | Serialize a fence back to bytes losslessly from a registered kind                               |
| `DirectiveDefinition`, `ParsedDirective`, `DirectiveTier`, `DirectiveFence`, `DirectiveAttributes` | The registration definition, the parsed fence handed to your factory, and the supporting shapes |

**Inline authoring** _(pre-freeze / unstable)_

| Export                                                                                                                                                                        | Role                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `declarePluginInlineKind`                                                                                                                                                     | Mint an inline kind                                                                                                            |
| `declaredPluginInlineKind`                                                                                                                                                    | Recover a declared inline kind's brand in another module                                                                       |
| `isInlineKindDeclared`                                                                                                                                                        | Idempotence probe for an inline-kind declaration                                                                               |
| `registerInlineSyntax`                                                                                                                                                        | Hook the scanner on a trigger character with your recognizer                                                                   |
| `registerInlineWidgetKind`                                                                                                                                                    | Register an inline kind as a live atomic widget — a `component` (recommended) or a hand-built `buildWidget`                    |
| `PluginInlineKind`, `InlineNode`, `InlineSyntaxRecognizer`, `InlineWidgetDescriptor`, `InlineWidgetComponentProps`, `InlineWidgetEditingPolicy`, `InlineWidgetEditingContext` | The inline kind and node types, the recognizer contract, and the widget descriptor plus its component-props and editing shapes |

A widget kind renders through one of two paths, and the descriptor rejects declaring both:

- **A `component` (recommended).** Supply a Svelte component; the editor wraps it in the atomic
  island — stamping the marker attributes the cursor and selection machinery need — and mounts it
  with frozen `{ inline, source }` props. A keyed reuse pool keeps one live instance per
  `(kind, source)` across the editor's rebuild-everything-per-keystroke render: typing next to a
  widget adopts its instance rather than remounting it, and the instance is remounted only when its
  source text changes. Error handling: a **synchronous mount-time throw** is caught — the widget
  falls back to its raw source and an `error` event fires — but the component mounts as its own
  effect root, so nothing catches its post-mount runtime errors. They are yours to handle: render a
  legible error for bad input instead of throwing (the KaTeX widget shows an inline message).
  A render engine's stylesheet is also yours — import it in the module that owns the renderer so no
  route can forget it: KaTeX needs `import 'katex/dist/katex.min.css'`, or the MathML accessibility
  half of its output lays out unclipped and every equation paints twice.
- **A hand-built `buildWidget`.** Return the island DOM yourself when you need DOM-level control; you
  own the marker-attribute stamping. This is the lower-level path the image widget uses.

**Commands and keybindings**

| Export                                                                                                     | Role                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockCommand`                                                                                     | Mint a `(kind, name)` block command and get back its id                                                                                             |
| `CommandId`, `KeyBinding`, `BlockCommandContext`, `BlockCommandHandler`, `PluginCommandId`, `AnyCommandId` | A built-in command id, a per-kind chord binding, the context and signature of a command handler, a minted command's id, and the union spanning both |

**Container authoring and chrome** _(pre-freeze / unstable)_

| Export                                                                                                            | Role                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `createContainerBlock`                                                                                            | Wire a nested-`BlockList` container so your block is as thin as the blockquote                                            |
| `BlockList`                                                                                                       | The child-list component your container renders with the factory's props                                                  |
| `registerChromeLeaf`                                                                                              | Register a container's title/summary leaf with a default keymap                                                           |
| `isCollapsedContainer`                                                                                            | Read a container's collapse state, so a component and the model layer agree                                               |
| `ContainerBlock`, `ContainerBlockComponent`, `ContainerBlockDeps`, `ContainerBlockListProps`, `ChromeLeafOptions` | The container API, the component surface it returns, the deps it takes, the child-list props, and the chrome-leaf options |

**Editable-leaf authoring** _(pre-freeze / unstable)_

| Export                                                 | Role                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `createEditableLeaf`                                   | Wire a text-editing leaf surface — plain or render-primary — with native caret/IME/undo/cross-block-selection parity |
| `EditableLeaf`, `EditableLeafDeps`, `EditableLeafMode` | The leaf API your component re-exports and wires, its getter deps, and the two modes                                 |
| `StickyColumnDirection`                                | The vertical-entry direction `focusAtColumn` receives when the caret traverses into your block                       |

**Parse / serialize helpers**

| Export                   | Role                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| `parse`                  | Parse a body of Markdown into a document you can lift children from |
| `serializeChildren`      | Join child nodes back into their exact source bytes                 |
| `trimTrailingLineEnding` | Read a child's display text without dropping a trailing line ending |
| `normalizeLineEndings`   | Normalize external text (a plugin-owned input surface) to LF        |
| `Document`, `ParsedLine` | The parsed-document shape, and a single parsed source line          |

**Fence grammar** _(pre-freeze / unstable)_

| Export            | Role                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `matchFenceOpen`  | Recognize a CommonMark fence-opener line, verbatim indent/info bytes included                 |
| `matchFenceClose` | Test a line as the closer for a matched opener (marker + minimum run length)                  |
| `FenceOpen`       | The matched opener's shape: marker, run length, trimmed `info`, verbatim `indent` + `infoRaw` |

**CST node access and metadata**

| Export                                   | Role                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `setPluginMetadata`, `getPluginMetadata` | Store and read your kind's own typed per-node metadata without casting |
| `CstNode`                                | The tree-node shape your factory builds and your `rebuildRaw` mutates  |

**Idempotence probes**

| Export                                                                           | Role                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------- |
| `isBlockKindRegistered`, `isBlockComponentRegistered`, `isBlockOpenerRegistered` | Guard each register-once call so re-import is safe |

**Paste transforms** _(pre-freeze / unstable)_

| Export                   | Role                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `registerPasteTransform` | Register a content-keyed pre-parse clipboard rewrite (paste-scoped, install-order) |
| `PasteTransform`         | The transform's shape — a unique name and a `transform(text) → string \| null`     |

## 3. Walkthrough: a directive container end-to-end

We build a `:::note` container — a titled, editable box whose title is a real editable line and
whose body holds ordinary Markdown blocks. Every import is from the package, so this runs unchanged
in a fresh SvelteKit app that installs the editor. It reuses the `:::name` grammar rather than a
hand-written opener; the grammar's tiers, dispatch, and losslessness are the
[directives guide](directives.md)'s subject — here we own the descriptor and component side.

### The registration module

One file declares the kinds, describes them, maps the directive name, binds the component, and
returns the whole thing as a `notePlugin()` unit. `registerDirective`'s `(tier, name)` mapping, the
`ParsedDirective` shape, and the per-tier factory rules live in the [directives guide](directives.md);
this module supplies the container factory (`fromDirective`, required for the container tier) and the
descriptor.

```ts
// note-kind.ts
import {
	activateDirectives,
	definePlugin,
	declarePluginKind,
	declaredPluginKind,
	registerBlockKind,
	registerBlockComponent,
	registerBlockCommand,
	registerChromeLeaf,
	defineBlockComponent,
	registerDirective,
	serializeDirective,
	serializeChildren,
	trimTrailingLineEnding,
	setPluginMetadata,
	getPluginMetadata,
	type CstNode,
	type EditorPlugin,
	type ParsedDirective
} from 'aragonite/plugin';
import NoteBlock from './NoteBlock.svelte'; // the component built in the next section

const NOTE = 'note';
const NOTE_TITLE = 'note-title';

interface NoteMetadata {
	name: string; // the matched directive name; re-emitted into raw so an edit survives
	colonCount: number;
	closerColonCount: number;
	closerNewline: boolean;
}

// Build the node from a parsed :::note fence. Child 0 is the title (from the opener
// line); children 1+ are the parsed body. The fence bytes go to metadata so the raw
// can be rebuilt after an edit.
function noteFromDirective(parsed: ParsedDirective): CstNode {
	const title = parsed.fence.info.trim();
	const node: CstNode = {
		kind: declaredPluginKind(NOTE),
		leadingTrivia: parsed.leadingTrivia,
		raw: parsed.raw,
		innerPrefix: parsed.body?.prefix ?? '',
		children: [makeTitleChild(title), ...(parsed.body?.children ?? [])],
		innerSuffix: parsed.body?.suffix ?? ''
	};
	setPluginMetadata<NoteMetadata>(node, {
		name: parsed.fence.name,
		colonCount: parsed.fence.colonCount,
		closerColonCount: parsed.closerColonCount,
		closerNewline: parsed.closerNewline
	});
	return node;
}

function makeTitleChild(text: string): CstNode {
	return {
		kind: declaredPluginKind(NOTE_TITLE),
		leadingTrivia: '',
		raw: text ? `${text}\n` : '\n'
	};
}

// Re-emit raw from the children after any structural edit: title back into the
// opener line, body children back into the fence.
function rebuildNoteRaw(node: CstNode): void {
	const meta = getPluginMetadata<NoteMetadata>(node);
	const children = node.children ?? [];
	const title = children[0] ? trimTrailingLineEnding(children[0].raw) : '';
	node.raw = serializeDirective({
		colonCount: meta?.colonCount ?? 3,
		name: meta?.name ?? NOTE,
		info: title ? ` ${title}` : '',
		innerPrefix: node.innerPrefix ?? '',
		body: serializeChildren(children.slice(1)),
		innerSuffix: node.innerSuffix ?? '',
		closerColonCount: meta?.closerColonCount ?? 3,
		closerNewline: meta?.closerNewline ?? true
	});
}

export function notePlugin(): EditorPlugin {
	return definePlugin({
		name: 'note',
		setup() {
			activateDirectives(); // idempotent; the shared grammar must be live before the first parse

			const note = declarePluginKind(NOTE);
			const noteTitle = declarePluginKind(NOTE_TITLE);

			// Two names, one kind: :::note and :::tip both resolve here; any other name
			// falls through to the generic directive fallback.
			registerDirective('container', NOTE, { kind: note, fromDirective: noteFromDirective });
			registerDirective('container', 'tip', { kind: note, fromDirective: noteFromDirective });

			// A block command that switches the variant. updateMetadata is the sanctioned
			// commit path: it merges the patch, runs rebuildRaw, and makes one undoable edit —
			// and because the name flows into raw, the change survives a round-trip.
			const setVariant = registerBlockCommand(note, 'note.setVariant', (ctx) => {
				if (typeof ctx.arg !== 'string') return false;
				ctx.updateMetadata({ name: ctx.arg });
				return true;
			});

			registerBlockKind(note, {
				mergeRole: 'container',
				editable: true,
				supportsInline: false,
				container: {
					// The title lives in the opener line, so raw is not a strip of the children:
					// 'opaque' marks raw authoritative.
					contract: 'opaque',
					rebuildRaw: rebuildNoteRaw,
					reservedChrome: { kind: noteTitle },
					unwrapRole: {
						firstChildBackspace: 'lift-first-child',
						middleChildBackspace: 'default-merge'
					}
				},
				keymap: [
					{ chord: 'Mod+7', command: setVariant, arg: 'note' },
					{ chord: 'Mod+8', command: setVariant, arg: 'tip' }
				]
			});

			registerChromeLeaf(noteTitle, { blockClass: 'note-title' });
			registerBlockComponent(declaredPluginKind(NOTE), defineBlockComponent(NoteBlock));
		}
	});
}
```

### The component

The component supplies only its own chrome; `createContainerBlock` hides the child-list state,
ancestor wiring, and windowing. Read the reactive `node`, `index`, and `path` through **getters** —
a plain value would snapshot stale state. Re-export the returned container API so the editor host
can drive the block.

```svelte
<!-- NoteBlock.svelte -->
<script lang="ts">
	import { BlockList, createContainerBlock, type CstNode } from 'aragonite/plugin';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();
	let boxEl: HTMLElement | undefined = $state();

	const { blockListProps, containerApi, handleKeydown } = createContainerBlock({
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get path() {
			return myPath;
		},
		getBoxEl: () => boxEl
	});

	export const editable = containerApi.editable;
	export const focusable = containerApi.focusable;
	export const focus = containerApi.focus;
	export const getCursorOffset = containerApi.getCursorOffset;
	export const getCursorPosition = containerApi.getCursorPosition;
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;
	export const isVerticallyTransparent = containerApi.isVerticallyTransparent;
	export const enterEdgeWidget = containerApi.enterEdgeWidget;
	export const getBlockComponentByPath = containerApi.getBlockComponentByPath;
	export const revealByPath = containerApi.revealByPath;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="note-block" bind:this={boxEl} onkeydown={handleKeydown}>
	<BlockList {...blockListProps} />
</div>

<style>
	.note-block {
		border: 1px solid var(--color-ui-muted);
		border-radius: 6px;
		padding: 8px 12px;
	}
	.note-block :global(.note-title) {
		font-weight: 600;
	}
</style>
```

`BlockList` must stay a **direct** child of your box so the container's windowing finds it; you may
place other chrome (an icon, a toggle button) beside it.

### Wire it into a page

Pass the plugin to the editor's `plugins` prop — it installs before the seed parses, so `:::note`
resolves to your kind. Build the array once at module scope (see [The plugin unit](#the-plugin-unit)):

```svelte
<script module lang="ts">
	import { notePlugin } from './note-kind';

	const plugins = [notePlugin()];
</script>

<script lang="ts">
	import { Editor } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';

	const SEED = ':::note My Title\nBody paragraph\n:::\n';
	let editor = $state();
</script>

<Editor bind:this={editor} source={SEED} {plugins} theme="light" />
```

The chords are live: focus the note and press `Mod+7` / `Mod+8` to switch it between `note` and
`tip` — then read `editor.getSource()` back and watch the opener line change with it. Chord strings
follow the consumer guide's chord model — fixed-order `Mod`/`Alt`/`Shift` plus the key's own value;
shifted-symbol chords are not modeled, so bind plain digits and letters. Add a collapse
toggle by giving `reservedChrome` an `isCollapsed` probe over the node — every focus walk, merge,
and window clamp then reads that one declaration.

## 4. Editable-content tiers

Content that is _itself editable_ comes in four tiers, each backed by a tree guarantee:

| Tier              | What it hosts                                                         | Status                 |
| ----------------- | --------------------------------------------------------------------- | ---------------------- |
| **Container**     | Real document blocks in a nested child list — the walkthrough's body  | shipped                |
| **Chrome leaf**   | One reserved, single-line, plain-text child the container's raw owns  | shipped                |
| **Editable leaf** | A standalone text surface with native caret/IME/undo/selection parity | shipped _(pre-freeze)_ |
| **Atomic widget** | An opaque, non-text embed, caret-addressable only at its edges        | shipped                |

The chrome leaf is deliberately narrow: it is always present, single-line and unsplittable (paste
flattens to inline), and is cleared — never deleted — by a destructive range, staying the same kind
through every edit. The contract guarantees the empty leaf's presence, not its look — an empty-state
affordance (say, placeholder text over an untitled chrome leaf) is yours to build with CSS on the
leaf's block class. Nested-editor interiors — a second editor state serialized as a blob — are
**rejected permanently**: they break byte-lossless round-trip.

### The editable leaf

`createEditableLeaf` is the container factory's sibling for leaves: it reads the editor's contexts
itself (deps are live getters — `node`, `index`, `path` — plus `getEl()` returning your source
contenteditable) and hands back everything a text-editing block needs. **Native parity** is the
tier's whole claim: the editor's caret and sticky-column traversal enter and leave your block like
any built-in text block, IME composition is respected, undo batches like prose, and a cross-block
selection sweeps through your text. Two modes:

- **`'plain'`** — the source is always the editable view; every keystroke commits to the tree
  (prose-like undo batching). Your component binds the returned handlers onto its contenteditable
  and calls `syncSource()` from one `$effect` — the factory owns the text sync, the Chromium
  trailing-newline caret anchor, and the caret restore after external rewrites.
- **`'render-primary'`** — a rendered view by default; focus, click, or arrow-traversal reveals the
  raw source in your contenteditable, and leaving it commits **once** — the whole
  reveal→edit→blur cycle is one undo entry. You own the swap flag (`isRevealed`/`setRevealed`) and
  both views' rendering; the factory owns everything else, `onRenderPointerDown` included.

**Commit semantics.** A commit parses the edited text and lands it through the editor's own edit
ladder: same-kind text updates the node in place (caret preserved), a kind change remounts the
block, and text that parses to **multiple blocks structurally replaces the leaf with all of them**,
the caret following the edit position into whichever block it falls in. Editing past your own fence
therefore re-splits the document instead of wedging foreign text into your node, and the
byte round-trip (`serialize(parse(source)) === source`) holds through every commit.

Block math (`$$…$$` in the LaTeX dogfood plugin) is the worked example: its component script is the
factory call, two view effects (KaTeX render, source populate), and one-line re-exports of the
returned `BlockComponent` surface. Registration is the ordinary leaf recipe — `registerBlockKind`
(no container group), `registerBlockOpener`, `registerBlockComponent`.

## 5. Recipe: a render-primary block (diagram, canvas, embed)

Some blocks are not text: a diagram, a chart, an embed — content that renders as a picture and is
edited through its own UI, not through the editor's caret. The Mermaid reference plugin is the
worked example; the shape generalizes to any render-primary block:

```
fence claim ──▶ opaque container, NO children ──▶ component renders the diagram
                  code lives in metadata            edit UI is plugin-owned
                  rebuildRaw re-emits the fence     commits ride updateOwnMetadata
```

- **Claim your grammar, decline everything else.** The opener accepts exactly the fences the
  built-in `fencedCode` would, gated on the info string's first word, and must price **ahead** of
  `fencedCode` — unlike a kind that slots between built-ins, a fence claim competes with a superset
  matcher. Declining returns the fence to `fencedCode`, which is also your uninstall story: without
  the plugin the same bytes parse as a plain code block and round-trip byte-identically. Pin both
  states with round-trip tests. Match the fence with the barrel's `matchFenceOpen` /
  `matchFenceClose`, gated on the info string's first word — never carry a copy of the CommonMark
  fence rules.
- **Code in metadata, an empty container around it.** Register the kind with
  `container: { contract: 'opaque', rebuildRaw }` and give nodes `children: []`. The source text
  and every fence byte the rebuild needs (indent, marker, info string, closer shape) go into typed
  plugin metadata — primitive values only — and `rebuildRaw` re-emits the exact bytes from them.
  Build the parsed node's `raw` by calling your own rebuild, so opener and rebuild agree by
  construction.
- **Edit mode commits through `updateOwnMetadata`.** The component swaps its body to a plugin-owned
  `<textarea>` seeded from metadata; commit (Ctrl+Enter, blur) writes the new code with the
  container factory's `updateOwnMetadata` — one undoable entry, your `rebuildRaw` re-emitting the
  fence so `getSource()` reflects the edit byte-exactly. Escape cancels without touching the tree.
- **Inject the renderer.** The engine is the consumer's dependency: take it as a plugin option
  (`mermaidPlugin({ renderer })`) and pass it by module to the component. Memoize per source text
  so re-renders of unchanged code do zero engine work, resolve failures to a legible inline error
  (never a throw), and render a static code fallback with a note when no renderer is configured.
  The engine's stylesheet travels with the renderer module too — a KaTeX-based renderer requires
  `katex/dist/katex.min.css`.
- **Interior interactivity stays inside your DOM.** Pan/zoom, buttons, overlays — anything
  draggable must `stopPropagation()` on pointerdown, or the drag starts a cross-block selection. A
  focus view is just a fixed-position overlay in the component's own tree: mount it in place, focus
  it on open, close on Escape.
- **Commands need a node → component bridge.** A minted block-command resolves to the focused node
  and a metadata writer — there is no component channel — so view-state commands (open the editor,
  open the overlay) go through a plugin-owned map from node to the mounted component's hooks,
  re-bound when an undo replaces the node.

**What you give up with the textarea.** The code text is not editor-native: no cross-block
selection through it, and the textarea's caret/IME is the browser's, not the editor's. Because the
container has no children, a caret cannot land _inside_ it — so opt into **whole-block focus**:
declare `blockFocus: 'whole-block'` on the kind and hand the factory a `getFocusEl` getter
returning the element that takes DOM focus (a `tabindex=0` viewport). Arrows then stop on the block
(ThematicBreak's model), a caret-adjacent Backspace/Delete focuses it before a second press
deletes, Enter inserts a paragraph below, and Alt+arrows reorder it — keyboard and click share the
one focus state, and keys inside your own editing surface never trigger a block delete. Supply a
focus element for **every steady state** — error, loading, and static fallbacks included — so a
broken render stays keyboard-reachable; if the getter returns null anyway, the editor degrades to
focusing your chrome box and warns in dev. The
editable-leaf tier (§ 4) is the answer when you want a source view with a native caret — rebuilding
the render-primary block on `createEditableLeaf` (block math's shape) is the recipe's upgrade path.

## 6. What a plugin may and may not do

A plugin **may**:

- Register kinds, components, and openers — once; a duplicate throws.
- Declare a `rebuildRaw` and have the editor invoke it when the document changes.
- Build containers and chrome through the factories.
- Store primitive per-node metadata, and commit metadata through the sanctioned update path.
- Contribute per-kind keymaps over the command vocabulary.
- Render as an unknown kind and degrade to a visible raw fallback.
- Transform pasted plain text before it is parsed — a content-keyed, paste-scoped hook (see
  [Paste transforms](#paste-transforms)).

A plugin **may not**:

- Treat its DOM as authoritative or mutate the tree from the view layer — boundary events flow up,
  and the tree always wins.
- Write bytes through a node reference captured before an edit — after any change, read the node
  back from the tree; the old reference is stale.
- Pass reactive tree state by value across a module boundary — hand it through getters only.
- Invent merge-role, unwrap, or container-contract values — those are closed sets.
- Silently override a built-in or another plugin's registration.
- Intercept loading or typing, or rewrite the whole document from a paste. The paste-transform hook
  below is **paste-scoped and pre-parse only**: it sees the clipboard text, never the load path or
  keystrokes, and a whole-document migration still belongs at the document level — read
  `getSource()`, transform the Markdown, and write the editor's `source` prop (the consumer guide's
  re-sync contract), which replaces the document in one step.

Most of this boundary is enforced by **shape**: the factories never hand you a raw context key or a
mutation handle, so the disallowed move is unavailable. The rest is enforced by **dev-mode checks
that are stripped from a production build** — so a plugin developed against a production build gets
no signal. **Develop against a dev build.**

### Paste transforms

`registerPasteTransform` records a **content-keyed, pre-parse** rewrite of pasted plain text. Each
transform is a `{ name, transform(text) }` unit: `transform` returns a replacement string, or `null`
to decline ("not mine"). Transforms run at every paste site before the clipboard text is parsed, in
**install order** — each sees the previous transform's output — so a plugin keys off the _content_ it
recognizes rather than the block it lands in. The name is unique (register-once; a duplicate throws,
naming the owning plugin) and scopes the transform for attribution.

Two habits keep a transform sound:

- **Decline cheaply, then convert precisely.** Probe the text for your marker first and return `null`
  when it is absent — the pipeline runs on every paste, so a fast reject keeps the common case free.
- **Scope through the parser, not a naive text scan.** A line-level scanner rewrites marker-shaped
  lines that happen to sit inside a pasted code fence; a converter that parses first and rewrites only
  the blocks it means to is fence-safe. Keep the transform **idempotent** — re-running it on its own
  output must decline or reproduce it (a dev warning fires otherwise, catching paste feedback loops).

The admonitions dogfood is the worked example: it probes for a GitHub-alert blockquote (`> [!NOTE]`),
and when one is present converts only the top-level blockquote alerts to `:::name` directive source
through a parse-scoped converter, so an alert-shaped line inside a pasted fence survives literally.
The transform serves pastes; a host button running the same converter over `getSource()` serves
already-loaded documents.

### Misuse outcomes

Why the dev build is where plugin development belongs — what each mistake does in each build:

| Misuse                                    | Dev build                                                           | Production build                                    |
| ----------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| `rebuildRaw` writes the wrong bytes       | Warns at edit time, naming the kind                                 | Silent until the bytes surface in a round-trip      |
| A component throws while rendering        | Contained as a failed-block fallback plus an `error` event, by path | Same containment (the boundary ships in production) |
| An opener returns a non-advancing index   | Parse throws, naming the kind, before the loop can spin             | Parse loop spins — the tab hangs on load            |
| An opener's `raw` ≠ the lines it consumed | Parse warns, naming the kind                                        | Silent round-trip break                             |
| An opener throws                          | Propagates uncaught (parse runs at init and on every edit)          | Same — uncaught                                     |

## 7. Verifying your plugin

**Round-trip is the contract.** Read the live document back with `editor.getSource()` (see the
[consumer guide](consumer-guide.md)) and confirm it equals what you authored. Test the case that
matters most for a plugin platform: author a document using your directive **with your plugin not
registered** — the generic fallback must return it byte-for-byte, so uninstalling a plugin never
corrupts a saved document.

**Dev-mode warnings are your guard channel.** The shape checks above only fire in a dev build. Run
`vite dev` while developing and watch the console: a `rebuildRaw` byte mismatch, an opener that
disagrees with the lines it consumed, or a collapse probe that contradicts the descriptor all warn
there and are silent in production. A clean dev-console round-trip is the signal your plugin is
sound.
