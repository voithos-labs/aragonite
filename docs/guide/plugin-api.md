# Plugin API Reference

Every export of `@voithos-labs/aragonite/plugin` and `@voithos-labs/aragonite/svelte`, grouped by job, so you can find a name and what it does without reading the package's entry module. Nobody reads this page top to bottom; Ctrl+F your way to the name you're after. The recipes behind the names live in the [plugin guide](plugin-guide.md), and most groups link to their section there.

## API reference

`/svelte` is where everything with Svelte's types in it lives, so a plugin written in Svelte imports from both and one written without it never touches `/svelte`. Its rows and entries below are tagged _(from `/svelte`)_. It also holds `Editor` and `EditorProps`, the component a Svelte app mounts, which the [consumer guide](consumer-guide.md) covers.

Four words recur in every table, so here they are once:

- A **kind** is aragonite's word for a block type. Paragraph is a kind, fenced code is a kind, your plugin's block is about to be one.
- A block's **raw** is its exact source bytes, and saving a document is just concatenating them (with the blank lines kept between blocks).
- An **opener** is the piece of the parser that recognizes the line a block starts with.
- A **leaf** is a block with no child blocks; a **container** holds other blocks.

A group tagged _(pre-freeze / unstable)_ may still change shape until the freeze at the public release, and so may a single row or entry tagged the same way inside an untagged group. In an untagged group the model is settled (which calls exist, that each registers once, what a kind is), but the exact call shapes still freeze with everything else at the public release.

Each group is a table with a row per export. An export that takes more than a sentence or two to explain also gets an entry under its group's table (its signature, what it's for, its fields, the common case, usually a snippet), and its row links down to it.

The groups, in page order:

| Group | What it covers |
| --- | --- |
| [The plugin unit](#the-plugin-unit) | Packaging your extension, installing it, and what each mounted editor hands it back |
| [Kind declaration](#kind-declaration) | Creating a new block type's identity |
| [The block-kind descriptor](#the-block-kind-descriptor) | Telling the editor how your block type behaves, and the checklist every one must fill in |
| [Block views](#block-views) | Binding a block type to what draws it |
| [The parser opener](#the-parser-opener) | Teaching the parser to recognize your block's syntax |
| [Enter completion](#enter-completion) | Letting one typed line become a construct whose lines must sit together |
| [Directive authoring](#directive-authoring) | Owning a `:::name` block without writing your own parsing |
| [Container authoring](#container-authoring) | Blocks that hold other blocks, plus their title line |
| [Editable-leaf authoring](#editable-leaf-authoring) | A text-editing block with the editor's own caret, undo, and selection |
| [Code-block languages](#code-block-languages) | Adding syntax-highlighting grammars beyond the bundled set |
| [Plugin views](#plugin-views) | What an inline widget, a decoration's widget and an inline menu row are drawn with |
| [Inline authoring](#inline-authoring) | Your own syntax inside a paragraph, rendered as a widget |
| [Commands and keybindings](#commands-and-keybindings) | Keyboard shortcuts and commands, per block type or editor-wide |
| [Paste transforms](#paste-transforms) | Rewriting pasted text before the editor parses it |
| [Decorations](#decorations) | View-only annotations over content your plugin does not own |
| [Inline menus](#inline-menus) | A list under the caret that a typed trigger opens |
| [Insert catalogue](#insert-catalogue) | The blocks the insert menus offer, and adding your own |
| [Events](#events) | What the editor tells your plugin has happened, and the shapes it says it in |
| [Rects](#rects) | Where things are on screen: block boxes, ranges, the caret, scrolling to a block |
| [Caret geometry](#caret-geometry) | Answering where a press inside your block puts the caret |
| [Pointer gestures](#pointer-gestures) | Keeping a drag that belongs to your block (a pan, a brush) from starting a selection |
| [Selection geometry](#selection-geometry) | The shapes that describe what the user has selected |
| [Parse and serialize](#parse-and-serialize) | Markdown in, tree out, and back again |
| [Grammar scanners](#grammar-scanners) | The editor's own code-fence, HTML-tag, and blockquote rules, reusable so you never fork them |
| [Node access and metadata](#node-access-and-metadata) | Reading the document tree, and storing your own data on a block |
| [Injected renderers](#injected-renderers) | A library the host hands you to draw your block (KaTeX, mermaid), cached per theme |
| [Performance helpers](#performance-helpers) | A small cache and a scan index for render and recognition work |

### The plugin unit

_(pre-freeze / unstable)_ The installable package, and the per-editor context it gets back. Wiring and the traps: [The plugin unit](plugin-guide.md#the-plugin-unit) and [One process, many editors](plugin-guide/per-editor.md#one-process-many-editors).

| Export | Role |
| --- | --- |
| [`definePlugin`](#defineplugin) | Validate a plugin unit and return it, ready for the editor's `plugins` prop |
| `isPluginInstalled` | Has a plugin of this name installed? For the rare setup that has to branch on it |
| `EditorPlugin` | The unit's shape; the `plugins` prop and the main entry's `installPlugins` take these |
| The `plugins` prop | Installs once per process, and activates per editor: an editor runs the hooks, kinds, commands and paste transforms of exactly the plugins it lists (no prop at all activates every installed one) |
| `EditorPluginEntry` | One `plugins` prop entry: a bare unit, or `{ plugin, options }` to vary options per editor. A field you pass replaces the plugin's default for it (arrays too); the rest keep theirs |
| `PluginSetupContext` | What `setup(ctx)` receives; its `onEditor(cb)` registers a per-editor callback (call it from `setup`, synchronously) |
| `OnEditorCallback` | The callback itself: receives the `EditorContext` of each mounted editor that listed your plugin, may return a cleanup function the editor runs at unmount |
| [`EditorContext`](#editorcontext) | One editor's view for your plugin, handed to your `onEditor` callback |
| `InsertMarkdownOptions` | `insertMarkdown`'s second argument: `placement: 'below'` puts the text into a new paragraph after the top-level block holding the caret, in one undo entry; the default inserts at the caret |
| [`Draft`, `Result`](#draft-result) | A write in the document's bytes from `edit()`, and what its commit came to |
| `PresentationMode` | The union of the editor's view modes (source, reading, the two previews, live). Switch on it with a default branch, since a new mode would join the union. [Presentation modes](plugin-guide/presentation-modes.md#presentation-modes) |
| `ClickInput` | What `isActivationClick` reads off a click: its Ctrl and Cmd keys, its click count and its target. A `MouseEvent` is one, so pass the event |

#### `definePlugin`

```ts
function definePlugin<Options>(plugin: EditorPlugin<Options>): EditorPlugin<Options>;
```

Validates a `{ name, setup }` unit at definition time and returns it, ready for the editor's `plugins` prop. What the unit carries:

- `name`, a lowercase letter followed by letters, digits and hyphens.
- `setup(ctx)`, where every `register*` and `declare*` call on this page goes. One anywhere else throws in development.
- `defaults` (optional), where every editor's `options` start.
- `parseOptions(raw)` (optional), which checks an editor's entry before it lands on them.

```ts
export const shoutPlugin = definePlugin({
	name: 'shout',
	defaults: { volume: 11 },
	setup(ctx) {
		ctx.onEditor((editor) => {
			editor.options.volume; // 11, unless this editor's entry said otherwise
		});
	}
});
```

The factory convention, install order and what a throwing `setup` does: [The plugin unit](plugin-guide.md#the-plugin-unit).

#### `EditorContext`

One editor's view for your plugin, handed to your `onEditor` callback once for each mounted editor that lists your plugin. What's on it:

- `editorId`, the editor's id.
- `document`, the live, read-only document, and `documentGeneration`, how many times a `source` write has replaced it.
- `events`, subscribe-only: `on(name, handler)` ([Events](#events)).
- `options`, this editor's entry over your `defaults`.
- `decorations`, `rects` and `inlineMenus`, this editor's [decorations](#decorations), [geometry](#rects) and [inline menus](#inline-menus).
- `insertCatalogue`, `presentationMode` and `theme`, all live.
- `insertMarkdown(md, options?)`, a promise resolved when the insert lands, and `runCommand(id, arg?)`. Both act like the instance's own methods and return false where those would.
- `edit()`, a write in the document's bytes that commits as one undo step, now or after a wait ([`Draft`](#draft-result)).
- `computeInlineContent(node)`, this editor's inline parse.
- `isActivationClick(e)`, whether a click on a link your block draws (a footnote's back-link, say) should follow it, by the host's `linkClick` and the mode.

```ts
ctx.onEditor((editor) => {
	const off = editor.events.on('edit', () => {
		console.log(editor.document.children.length); // 3, then 4 after an Enter
	});
	return off; // runs at unmount
});
```

Per-editor state, and the closure trap that comes with it: [One process, many editors](plugin-guide/per-editor.md#one-process-many-editors).

#### `Draft`, `Result`

```ts
interface Draft {
	readonly stale: boolean;
	replace(range: { from: number; to: number }, text: string): this;
	insert(markdown: string): this;
	commit(options?: { caret?: number }): Promise<Result>;
	end(): void;
}

type Result =
	| { ok: true }
	| { ok: false; reason: 'moved' | 'unloaded' | 'reading' | 'overlap' | 'illegal' | 'empty'; message: string };
```

The way your plugin writes bytes, from `EditorContext.edit()` (a host gets the same from `EditorInstance.edit()`). Positions are byte offsets into the document's text as it stood when you called `edit()`, so you can measure a range, go fetch something, and write when it comes back:

```ts
const draft = editor.edit();
const card = await fetchCard(query); // the author keeps typing meanwhile
const result = await draft.replace({ from, to }, card).commit();
if (!result.ok) console.warn(result.reason, result.message); // 'moved': they typed inside it
```

- `replace(range, text)` swaps bytes `from` to `to` for `text`. Chain as many as you like; two far-apart ranges are still one undo step. These are the document's bytes, markers and all, so a new line you write inside a container carries the container's marker (`> `, a list item's indent) in `text`.
- `insert(markdown)` pastes Markdown at the caret once the replacements land, the way `insertMarkdown` does.
- `commit({ caret })` writes it all as one undo step, with the caret at byte `caret` of the new text. Leave `caret` out and the author's caret stays where it is, since a write landing while they type shouldn't drag them anywhere.
- `stale` turns true once a write elsewhere touches one of your ranges, or the host loads another document. It's reactive, so a Svelte effect reading it reruns.
- `end()` drops the draft without writing. One you just let go of is dropped eventually too, but ending it stops the editor tracking writes for it right away.

What a commit can come back with (nothing throws, and a refused commit writes nothing):

| `reason` | When |
| --- | --- |
| `moved` | Something wrote inside one of your ranges since `edit()`. Text written right before or after a range doesn't count, it just moves the range |
| `unloaded` | The host loaded another document |
| `reading` | The editor's in reading mode |
| `overlap` | Two of your own ranges overlap |
| `illegal` | A range runs past the document's end or splits a `\r\n`, or the insert had no caret to land at |
| `empty` | Nothing to write: no ranges, only the bytes already there, or the draft was ended |

### Kind declaration

Every kind starts here. No other call accepts a bare string where a kind goes.

| Export | Role |
| --- | --- |
| `declarePluginKind` | Create a block kind from a name and get the kind back; a collision with a built-in or a prior kind throws, and so do the reserved names `document` and `global` and a name that isn't a lowercase letter followed by letters, digits and hyphens |
| `declaredPluginKind` | Recover an already-declared kind in another module, no cast; throws for a name nobody declared |
| `PluginBlockKind`, `AnyBlockKind` | The plugin-declared kind type, and the union of built-in and plugin kinds a node can carry |

### The block-kind descriptor

The **descriptor** is a kind's written behavior: how it merges, whether it's editable, its container shape. Its required `closure` field is the kind's answer to each cross-cutting editor system (undo, search, selection, clipboard and friends), so a new kind can't ship silently broken under a subsystem nobody asked about. Cell by cell: [The closure block](plugin-guide/container-walkthrough.md#the-closure-block).

| Export | Role |
| --- | --- |
| `registerBlockKind` | Register a kind: its descriptor, the `view` that draws it and, for a kind a line starts, the `opener` that recognizes it, in one call. A registration with no view doesn't compile, and a kind never registered errors at first use |
| `augmentBlockKind` | Merge extra fields into a kind your own plugin registered; built-in kinds and another plugin's kinds are refused with a throw |
| [`BlockKindRegistration`](#blockkindregistration) | What `registerBlockKind` accepts |
| `HeightEstimateEnv` | What `estimateHeight` reads besides the block: the editor's width, its line heights and character width, the frame it adds to every block, and the floor for an unsized image |
| [`BlockKindAugmentation`](#blockkindaugmentation) | The patch `augmentBlockKind` merges |
| [`WriteRule`, `WriteContext`](#writerule-writecontext) | A kind's rule for making written bytes legal, and what it reads besides them |
| [`ContainerDescriptorGroup`](#containerdescriptorgroup) | The descriptor's container-only half |
| `MergeRole`, `ContainerUnwrapRole` | Closed sets naming how a kind merges on Backspace, and how a container releases a child at its edge |
| `ChildRawChange` | `rebuildRaw`'s optional second argument: which one child's bytes just moved, for a rebuilder that re-emits only that region. Ignoring it and re-deriving the whole raw is always correct, just slower |
| `ClosureBlock`, `ClosureColumn`, `ClosureCell` | The closure matrix: nine columns, one cell each, and a cell is `implemented` (name the mechanism), `inherit-default`, or `not-supported` (name the degradation). A missing column fails the typecheck |
| `simpleLeafClosure`, `SimpleLeafClosureCells` | Closure preset for a plain text leaf: bakes the five cells every such leaf answers alike, requires the four your component determines (`focus`, `searchPaint`, `undo`, `simOracle`) |
| `containerClosure`, `ContainerClosureCells` | Closure preset for a container of real child blocks: bakes the four structural cells plus `roundTrip: implemented`, requires the round trip's `via` string and the four the container determines |

#### `BlockKindRegistration`

```ts
function registerBlockKind(kind: AnyBlockKind, registration: BlockKindRegistration): void;
```

What `registerBlockKind` accepts: the descriptor's fields, plus the `view` that draws the kind and, for a kind a line starts, its `opener`. The quickstart's parrot registration is a whole one ([The first fifteen minutes](plugin-guide.md#the-first-fifteen-minutes)). The optional fields worth knowing by name:

- `label`, what a screen reader and the block menu call the block.
- `pageRole`, whether it reads as prose (no drag handle) or as an object.
- `estimateHeight(node, env)`, its height guess before it's measured (`env` is a `HeightEstimateEnv`).
- `dragLabel`, what the drag ghost calls it.
- `textPosition: 'while-source-shows'`, for a block your own component draws as a picture of its source until a click opens the text. Cut, copy and paste only reach the text while it's open. A DOM view with `surface: 'render-primary'` already says this, so it doesn't need the field.

Fields that only work together are declared together:

- `contentStart: { range, backspace? }`, typed `ContentStart`, for a kind whose markers sit in front of its text.
- The `container` group, for a container ([`ContainerDescriptorGroup`](#containerdescriptorgroup)).

A combination that can't work, like a block focused as one unit or a container that also parses inline syntax, won't compile.

#### `BlockKindAugmentation`

```ts
function augmentBlockKind(kind: AnyBlockKind, patch: BlockKindAugmentation): void;
```

The patch `augmentBlockKind` merges into a kind your plugin registered. Top-level fields replace, and a partial `container` group merges into the existing one.

Some fields are fixed at registration, and an augment naming one throws, even from plain JavaScript:

- the view and the opener;
- the fields other fields depend on: `contextDependentKind`, `blockFocus`, `supportsInline`, `textPosition`, `contentStart`, the title row and the unwrap strategies.

#### `WriteRule`, `WriteContext`

```ts
interface WriteRule {
	normalize(raw: string, ctx: WriteContext): string;
	mapOffset(raw: string, offset: number, ctx: WriteContext): number;
	text?(raw: string): string;
}

interface WriteContext {
	node: NodeView;
	mode: 'authored' | 'literal';
	lineEnding: LineEnding;
}
```

A kind's write rule, which makes written bytes legal. You declare one as `rawWrite` for the kind's own bytes, or as `container.bodyWrite` for a child's. The editor runs your rule on every content write and moves the caret with your `mapOffset`.

- `normalize(raw, ctx)` makes the written bytes legal.
- `mapOffset(raw, offset, ctx)` says where a caret in them lands.
- `text(raw)` (optional) returns the part of the bytes that is the block's text, leaving out structure your rule may rewrite (a fence's lines). The dev checks that an indent or a list move kept your text read it.

`ctx` carries the block (`node`), the document's `lineEnding` for any line the rule puts back, and a `mode`: `'authored'` when the user typed the bytes into the block, `'literal'` for content that arrives whole (a paste, a replace, a range delete). A rule that repairs half-written syntax should check `mode`, or it'll fight the user's typing.

For a kind that holds its own fence, [`fenceRawWrite`](#fencerawwrite-fenceshapeofraw-fenceshape) is a finished one.

#### `ContainerDescriptorGroup`

```ts
type ContainerDescriptorGroup = {
	contract: 'strip' | 'grid' | 'opaque';
	rebuildRaw: (node: CstNode, changed?: ChildRawChange) => void | StripRebuild;
	// plus the optional fields below
};
```

The descriptor's container-only half, declared as `container` on the registration. Two fields are required:

- `contract`: `'strip'`, `'grid'` or `'opaque'`.
- `rebuildRaw`, the hook that recomputes a container's raw from its children after an edit ([the write hook](plugin-guide.md#rebuildraw-the-write-hook)).

The rest are optional:

- the body wrap (`bodyWrap`) and the body write rule (`bodyWrite`);
- the reserved title line (`reservedChrome`) and unwrap behavior (`unwrapRole`);
- paste merging (`containerPaste`);
- how its marker rides its lines (`lines`: `{ marker: 'every-line' | 'first-line', lazy }`), and when two of it count as one container (`merges`: `{ key }` names the metadata field they share, `{}` means any two), which cut, copy and paste read;
- a content line's first space (`contentStartSpace`);
- which child holds its last line (`lastLineChild`), for a container whose own bytes end it, like a table holding only its header row;
- whether its children reorder among themselves (`reorderChildren`).

A declared title line already decides what Backspace does at its start, so its `unwrapRole` names only `middleChildBackspace`.

### Block views

| Export | Role |
| --- | --- |
| [`defineBlockView`](#defineblockview) | Make a view that draws into an element the editor makes for the block, no framework needed |
| [`BlockViewSpec`](#blockviewspec) | What `defineBlockView` takes, one shape per surface |
| [`BlockViewContext`](#blockviewcontext) | What `mount` gets |
| `LeafSurface` | `attach(el)`, the element whose text the editor edits. It holds nothing of yours, since the editor owns its text, so chrome goes beside it. Also `reveal(offset?)` to focus it, `commitSource(text)` to replace the block's text as one undo step, and `setCommandHooks(hooks)` |
| [`RenderPrimarySurface`](#renderprimarysurface) | A render-primary leaf's `ctx.leaf`: the `LeafSurface` calls plus the rendered half |
| [`ContainerSurface`](#containersurface) | A container's `ctx.container`: where the child blocks mount, plus the container helpers |
| [`BlockViewHandle`, `LeafViewHandle`](#blockviewhandle-leafviewhandle) | What `mount` returns |
| `CommandHooksSurface` | `setCommandHooks(hooks)`, on the leaf and container surfaces: what a block command running on this block gets as `ctx.hooks` (open your own editor, say). The last value set wins ([commands](plugin-guide/commands.md)) |
| `AmbientPrefix`, `AmbientInteractiveRange` | What `ambientPrefix` returns: the marker's text, or `{ text, interactive }` with ranges of it clickable, each with its class, click handler, role and an optional tab stop ([the container walkthrough](plugin-guide/container-walkthrough.md)) |
| [`HandBuiltSurface`, `HandBuiltBlock`](#handbuiltsurface-handbuiltblock) | A `'none'` view's `ctx.block`, and what you publish through it |
| `svelteBlockView` | _(from `/svelte`)_ Make a view from your Svelte component, plus an optional per-node extra-props hook; a component that forgot to publish its surface fails the typecheck here |
| [`reactBlockView`, `vueBlockView`](#reactblockview-vueblockview) | _(from `@voithos-labs/aragonite-react` and `-vue`)_ Make a view from a React or Vue component |
| `LeafContent`, `BlockChildren` | _(from the same two packages)_ The element the editor edits a leaf's text in, and the one it mounts a container's children into. Both render empty, so your chrome goes beside them |
| [`useBlockHandle`](#useblockhandle) | _(from the same two packages)_ How a `'none'` block's component hands the editor `focus` and friends |
| `textBlockView` | The editor's own plain text block as a view, with an optional `blockClass` on its element: for a kind that's just editable text |
| `BlockView` | What draws a kind, the registration's `view`. You can't look inside one: `defineBlockView`, `svelteBlockView` or `textBlockView` makes it, and `registerBlockKind` throws on anything else, a hand-built object included |
| `BlockComponent`, `BlockComponentExports` | The surface a block component publishes: a factory leaf's single `blockApi` export, a container's single `containerApi` export, or a hand-built leaf's own members |
| [`BlockComponentProps`](#blockcomponentprops) | The props every block component receives |

#### `defineBlockView`

```ts
function defineBlockView(spec: BlockViewSpec): BlockView;
```

Makes a view that draws into an element the editor makes for the block, no framework needed. Its `surface` says what the editor builds in there for you:

| `surface` | What the editor builds | What you call |
| --- | --- | --- |
| `'none'` | Nothing: you draw all of it | `ctx.block.publish`, to hand over `focus` and friends |
| `'leaf'` | Editable text, caret, IME and undo included | `ctx.leaf.attach(el)`, with the element to edit in |
| `'render-primary'` | The same text, behind a rendered view you draw until a click opens it (block math's shape) | `ctx.leaf.attach` and `ctx.leaf.attachRendered` |
| `'container'` | The child blocks | `ctx.container.mountChildren(box)`, with the box they mount in |

`registerBlockKind` refuses a surface that doesn't fit the kind: a container kind takes `'container'`, anything else `'none'`, `'leaf'` or `'render-primary'`.

```ts
const shoutView = defineBlockView({
	surface: 'leaf',
	singleLine: true,
	mount(target, ctx) {
		target.className = 'shout';
		const badge = document.createElement('span');
		badge.textContent = 'LOUD';
		const text = document.createElement('span');
		target.append(badge, text);
		ctx.leaf.attach(text); // the block's text goes here, caret, undo and IME included
		return {};
	}
});
// the badge sits beside the text, where the editor never types into it
```

The quickstart's parrot is a whole render-primary view ([The first fifteen minutes](plugin-guide.md#the-first-fifteen-minutes)).

#### `BlockViewSpec`

```ts
type BlockViewSpec = HandBuiltViewSpec | LeafViewSpec | RenderPrimaryViewSpec | ContainerViewSpec;
```

What `defineBlockView` takes, one shape per surface (`BlockSurface` is the surface's name). Every shape has these:

- `surface`, the surface.
- `mount(target, ctx)`, which fills `target`. Add your classes and children to it, but don't wrap a second box inside, since the editor measures `target` as the block.
- `watchDocument: true` (optional) gets you an `update` for every change to the document, not only to your block (a table of contents wants that).

The surfaces add their own:

- `HandBuiltViewSpec`, the `'none'` surface's, takes nothing more.
- `LeafViewSpec` takes `singleLine`.
- `RenderPrimaryViewSpec` takes `singleLine`, `renderSource` and `reshapeSource`, the same painter and reshaper `createEditableLeaf` takes.
- `ContainerViewSpec` takes `ambientPrefix(state, editor)`, the read-only marker drawn before its first child's text (a footnote definition's `[^label]: `), read live.

#### `BlockViewContext`

```ts
interface BlockViewContext {
	state(): BlockViewState;
	readonly editor: EditorContext;
}
```

What `mount` gets, one shape per surface: `HandBuiltViewContext`, `LeafViewContext`, `RenderPrimaryViewContext` and `ContainerViewContext`. Each has:

- `state()`, which reads a `BlockViewState` when you call it: the node, its path, the presentation mode, the theme name and `revealed` (a render-primary block's text is showing).
- `editor`, your plugin's `EditorContext` in the editor drawing the block. It's always there, since a view only mounts inside an editor.
- Plus `block`, `leaf` or `container` on those surfaces.

#### `RenderPrimarySurface`

```ts
interface RenderPrimarySurface extends LeafSurface {
	attachRendered(el: HTMLElement | null): void;
}
```

A render-primary leaf's `ctx.leaf`: the `LeafSurface` calls plus `attachRendered(el)`, the rendered half. A click there opens the text at the spot your kind's `caretTargetAtPoint` names.

- Swap your halves in `update` on `state.revealed`.
- Call `attach` from inside the `update` that reveals, so the caret lands with the render. A later attach still gets the caret, a beat late, and dev warns.
- Call `attach(null)` when it folds. That hands the element back empty, so you can attach the same one next time.

The parrot's `draw` does all three ([The first fifteen minutes](plugin-guide.md#the-first-fifteen-minutes)).

#### `ContainerSurface`

```ts
interface ContainerSurface extends CommandHooksSurface {
	mountChildren(box: HTMLElement): void;
	attachFocus(el: HTMLElement | null): void;
	// plus the container helpers below
}
```

A container's `ctx.container`. `mountChildren(box)` mounts the child blocks into `box`. Alongside it:

- the container helpers `updateOwnMetadata`, `moveFocusOut`, `captureScrollPosition` and `openDraft`, the same ones `createContainerBlock` hands a Svelte container;
- `setCommandHooks(hooks)`.

A kind declaring `blockFocus: 'whole-block'` mounts no children and calls `attachFocus(el)` instead, with the element the block takes focus on (its edit box included). Any other kind that calls it throws ([React and Vue](plugin-guide/react-and-vue.md#a-block-with-its-own-editing-surface)).

#### `BlockViewHandle`, `LeafViewHandle`

```ts
interface BlockViewHandle {
	update?(state: BlockViewState): boolean | void;
	destroy?(): void | Promise<void>;
}

interface LeafViewHandle extends BlockViewHandle {
	afterInput?(text: string): void;
}
```

What `mount` returns.

- `update(state)` runs when the block's bytes, path, mode or theme change. Inside a container that's every keystroke in a child, so keep it cheap. Return `false` and the view is destroyed and mounted again from scratch.
- `destroy()` runs when the block leaves the screen.
- A leaf's `afterInput(text)` runs once after each change to its text (typing, a delete, a paste, an IME commit, an undo), never mid-composition.

A throw in `mount` or `update` shows the block's source with a notice, like a broken Svelte block. One in `destroy` or `afterInput`, or a rejection of a promise `destroy` returns, is reported on the `error` event.

#### `HandBuiltSurface`, `HandBuiltBlock`

```ts
interface HandBuiltSurface {
	publish(block: HandBuiltBlock | null): void;
}
```

A `'none'` view's `ctx.block`. `publish(block)` hands the editor what it calls on the block (a `HandBuiltBlock`):

- `focus`, `getCursorOffset` and `focusable` at least;
- plus any of `parkCaret`, `focusAtColumn`, `getSelectedText`, `setSelection`, `measurePartialRects`, `getCommandContext`, `isCommandActive` and `runCommand`.

The editor reads nothing else. Publish again when they change; the last one wins, and the same members again change nothing. Until you publish, and after `publish(null)`, the block takes no focus and arrows pass over it.

A plain arrow pressed inside the block moves to the neighbour it points at, unless it's in a text field of yours or you `preventDefault` it.

A `'none'` block can't write its own bytes or run a plugin block command at itself, since nothing hands it the writes (`replaceRaw`, `updateMetadata`) a `getCommandContext` would have to return. A block that edits itself goes on the container surface with `blockFocus: 'whole-block'`.

#### `reactBlockView`, `vueBlockView`

_(from `@voithos-labs/aragonite-react` and `-vue`)_

```ts
function reactBlockView(Component, options: { surface } & ReactBlockViewOptions): BlockView;
function vueBlockView(component, options: { surface } & VueBlockViewOptions): BlockView;
```

Make a view from a React or Vue component, which gets `state`, `ctx` and a click-to-edit block's `draft` as props (`BlockViewProps`). The options (`ReactBlockViewOptions`, `VueBlockViewOptions`) are `defineBlockView`'s minus `mount`, for a `'none'`, `'leaf'`, `'render-primary'` or `'container'` surface (`FrameworkSurface`), plus:

- `className` for the block's element;
- `afterInput`;
- React's `wrap` or Vue's `app`, for your providers.

```tsx
export const memoView = reactBlockView(Memo, { surface: 'leaf', singleLine: true, className: 'memo' });
```

The options one by one, and a block for every surface: [React and Vue blocks](plugin-guide/react-and-vue.md).

#### `useBlockHandle`

_(from `@voithos-labs/aragonite-react` and `-vue`)_

```ts
function useBlockHandle(create: () => HandBuiltBlock, deps?): void;
```

How a `'none'` block's component hands the editor `focus`, `getCursorOffset`, `focusable` and friends (a `HandBuiltBlock`). It's a hook in React and a composable in Vue. It makes the handle again when `deps` change and takes it back on unmount.

```tsx
useBlockHandle(
	() => ({
		focusable: true,
		focus: () => button.current?.focus(),
		getCursorOffset: () => (document.activeElement === button.current ? 0 : null)
	}),
	[]
);
```

The whole die that goes with it: [a block you draw whole](plugin-guide/react-and-vue.md#a-block-you-draw-whole).

#### `BlockComponentProps`

```ts
interface BlockComponentProps {
	node: NodeView;
	index: number;
	myPath: number[];
	ambientPrefix: AmbientPrefix;
	document?: DocumentView;
	rects?: EditorRects;
}
```

The props every block component receives:

- `node`, and its `index` and path (`myPath`).
- `ambientPrefix`, the marker prefix a container hands its first child (a footnote definition's `[^label]: `). A leaf that drops it loses its markers on screen.
- `document`, the read-only whole document.
- `rects`, the editor's geometry surface ([Rects](#rects)).

### The parser opener

The `opener` a kind registers with teaches the parser its Markdown syntax. Where your opener sits in the priority order, and the two placement rules: [Opener priority](plugin-guide/parser.md#opener-priority).

| Export | Role |
| --- | --- |
| [`BlockOpener`, `OpenContext`, `UnfinishedReading`](#blockopener-opencontext-unfinishedreading) | The opener contract, the line cursor it inspects, and the declaration for a reading a later line can change |
| `BlockOpenerResult` | A claim: the node built, plus `consumed`, the count of lines it took |
| `OPENER_PRIORITIES` | The built-in priorities your opener picks its own number relative to; lower dispatches first _(pre-freeze / unstable)_ |
| [`lineStartsOuterBlock`, `OuterBlockScan`](#linestartsouterblock-outerblockscan) | "Does this line start a block at the outer level?" _(pre-freeze / unstable)_ |

#### `BlockOpener`, `OpenContext`, `UnfinishedReading`

```ts
interface BlockOpener {
	priority: number;
	tryOpen(ctx: OpenContext): BlockOpenerResult | null;
	interruptsParagraph: ((lineText: string) => boolean) | false;
	readingNotFinal?: UnfinishedReading;
}
```

The opener contract, a registration's `opener` field. Its `tryOpen` inspects an `OpenContext`, the line cursor:

- the lines and the position;
- the blank lines above (`leadingTrivia`);
- the parse's scope and depth;
- the `grammar` to pass on to any nested parse.

An opener whose reading a line further down can still change (an unclosed `$$` becomes a paragraph, an unclosed fence takes in everything below) declares `readingNotFinal`, an `UnfinishedReading`:

- `notFinal(raw)` says whether lines further down could still change how a block reads.
- `mayClose(line)` says whether a line could be the one that does.
- `closer(raw)` gives the line that closes it (`null` where no line does). An opener written on a line of its own above such a line gets it at once, whether it was typed, pasted, dropped or moved there.
- `readsOn` marks a reading that takes in every line below until its closer, like an open fence.

The parrot's opener is a whole one ([The first fifteen minutes](plugin-guide.md#the-first-fifteen-minutes)), and [A reading that isn't final](plugin-guide/parser.md#a-reading-that-isnt-final) has the rest of `readingNotFinal`.

#### `lineStartsOuterBlock`, `OuterBlockScan`

_(pre-freeze / unstable)_

```ts
function lineStartsOuterBlock(line: ParsedLine, scan: OuterBlockScan): boolean;
```

"Does this line start a block at the outer level?" It's the shared end-of-extent test for a container opener scanning its own lines. Its inputs, the `OuterBlockScan`:

- `paragraphOpen`, whether a paragraph is open above;
- `grammar`, required: pass the one your opener was given, so a syntax the editor left out starts nothing;
- `window` (optional), the lines around it, for an opener that needs a later line to open.

```ts
const [heading, lazy] = splitLines('# heading\nlazy\n');
lineStartsOuterBlock(heading, { paragraphOpen: true, grammar: ctx.grammar }); // true
lineStartsOuterBlock(lazy, { paragraphOpen: true, grammar: ctx.grammar }); // false
```

### Enter completion

_(pre-freeze / unstable)_ The recipe: [Typing a multi-line construct into existence](plugin-guide/parser.md#typing-a-multi-line-construct-into-existence).

| Export | Role |
| --- | --- |
| `registerBlockCompleter` | Let one typed line complete into a grammar whose lines must sit adjacent, which Enter alone can never type |
| `BlockCompleter` | The contract: `tryComplete(line)` claims with a result, or declines with null; `onType: true` also consults it as the line is typed |
| `CompletionResult` | A claim: the lines to insert, endings omitted (the editor attaches the block's own ending, else the document's), plus where the caret lands inside the insertion |

### Directive authoring

_(pre-freeze / unstable)_ The `:::name` grammar itself is the [directives guide](directives.md)'s subject; the worked container is [the walkthrough](plugin-guide/container-walkthrough.md#walkthrough-a-conspiracy-container-end-to-end).

| Export | Role |
| --- | --- |
| `activateDirectives` | Turn the `:::name` grammar on, once at startup, before the first parse; until it runs no `:::` line parses as a directive (the pure helpers below work either way) |
| `registerDirective` | Map a `(tier, name)` pair to one of your kinds; a container mapping must bring its node factory (`fromDirective`) and a text mapping must not, or registration throws |
| `isDirectiveRegistered` | The is-it-there check for a directive, asked as `(tier, name)` |
| `parseDirectiveAttributes` | Opt-in reader pulling a `[label]` and a `{#id .class key=val}` block out of a directive's info string; one-way, it reads and never writes back |
| `serializeDirective` | Re-emit a directive's exact bytes from its parts (colon count, name, verbatim info string, body, closer shape), growing the fences itself so no body line reads as the closer |
| `escalatedColonCount` | The fence length a body forces, for an emitter building `:::name` text by hand instead of through `serializeDirective` |
| [`createDirectiveRebuild`](#createdirectiverebuild) | Build the `rebuildRaw` hook for a `:::` container |
| `withDirectiveName` | Rename a `:::` container by rewriting its opener line, for a command that switches variants through `replaceRaw` |
| `DIRECTIVE_BODY_WRAP` | The wrap every `:::` body parses with; declare it as your container kind's `bodyWrap` so a blank line against the fence stays with the fence |
| `DIRECTIVE_OPENER_LINE` | The kind of every `:::` container's first row, its opener line; a `:::` kind that folds names it as `reservedChrome.kind` |
| `DirectiveDefinition`, `ParsedDirective` | The registration's shape, and the parsed fence your factory receives: the fence parts, the parsed body, the exact consumed bytes |
| `DirectiveTier`, `DirectiveFence`, `DirectiveAttributes` | The three tiers (container, leaf, text), one parsed opener line, and what the attribute reader returns |

#### `createDirectiveRebuild`

```ts
function createDirectiveRebuild(): (node: CstNode) => void;
```

Builds the raw-recompute hook (`rebuildRaw`) for a `:::` container. It writes child 0, the opener line, back as typed, then the body and the closer, CRLF included. The grammar builds that child 0 for every `:::` container (kind `directiveOpenerLine`), so your factory returns only the body.

```ts
container: {
	contract: 'opaque',
	rebuildRaw: createDirectiveRebuild(),
	bodyWrap: DIRECTIVE_BODY_WRAP
}
```

### Container authoring

_(pre-freeze / unstable)_ A container's **chrome** is its own furniture: the border, the title line, an icon if you like. The factory hides everything else (child-list state, ancestor wiring, the mounting of only what's visible), so your component only has to supply the chrome. Worked end to end in [the walkthrough](plugin-guide/container-walkthrough.md#walkthrough-a-conspiracy-container-end-to-end).

| Export | Role |
| --- | --- |
| `createContainerBlock` | _(from `/svelte`)_ Wire a nested-child-list container so your component is as thin as the built-in blockquote's |
| `BlockList` | _(from `/svelte`)_ The child-list component your container renders, spread with the factory's props, as a direct child of your box |
| `registerChromeLeaf` | Register a container's title or summary line as a kind of its own, with a sensible default keymap. Not for a `:::` container, whose title row is its opener line (`directiveOpenerLine`), built by the grammar |
| `chromeChild` | Build the reserved child-0 node for that line: the title text plus its newline (an empty title keeps the bare newline). Again not for a `:::` container |
| `isCollapsedContainer` | Read a container's collapse state through its descriptor, so your component and the editor's own walks agree |
| `rowContentRange` | Where the title sits on a container's title line, past a `:::name` and the spaces after it, so a view reading the title skips the name |
| [`ContainerBlock`, `ContainerBlockComponent`](#containerblock-containerblockcomponent) | _(from `/svelte`)_ What the factory returns, and the shape its `containerApi` must satisfy |
| `ContainerBlockDeps`, `ContainerBlockListProps` | _(from `/svelte`)_ The factory's inputs, live getters rather than captured values, and the props `BlockList` takes |
| [`DraftSpec`, `DraftCloseCause`](#draftspec-draftclosecause) | An edit your block holds outside the document (a textarea's text), as a draft of its bytes |
| `RefSlots` | The per-child reference accessors the child-list props carry |
| `ChildList` | A container's children as the editor walks down to one: their references, their render window, and whether the body is collapsed. `containerApi.childList()` returns it; the factory builds yours, so you'd only write one for a hand-rolled container |
| `ChromeLeafOptions` | `registerChromeLeaf`'s options: the name a screen reader and the block menu give the line, a CSS class for styling it, keymap overrides, the merge role |
| [`rebuildStripRaw`](#rebuildstripraw) | Your `rebuildRaw` for a container that puts a prefix on every line |
| `StripRebuild` | What `rebuildStripRaw` returns: `rereads` says a kept line stopped continuing a paragraph, so the bytes have to be read whole. Your `rebuildRaw` returns it as it came |
| `StripRebuildOptions` | `rebuildStripRaw`'s last argument: the `changed` hint, the `previous` codec when your metadata changed the prefix, and an `opener` line |
| `quoteLines` | The codec for `>`-prefixed lines, the one the built-in blockquote uses |
| [`hangingIndentLines`](#hangingindentlines) | Build the codec for a container written like a list item |
| [`LineCodec`, `LinePlace`, `BodyLine`](#linecodec-lineplace-bodyline) | What a codec is, if neither of the two fits |

#### `ContainerBlock`, `ContainerBlockComponent`

_(from `/svelte`)_

```ts
function createContainerBlock(deps: ContainerBlockDeps): ContainerBlock;
```

What the factory returns:

- the child-list props (`blockListProps`), which you spread onto `<BlockList>`;
- the `containerApi` you publish, which must satisfy `ContainerBlockComponent`;
- the keydown handler (`handleKeydown`);
- the commit (`updateOwnMetadata`), which can also say where the caret goes after it;
- the focus-exit (`moveFocusOut`), mode, theme, options, scroll-hold (`captureScrollPosition`) and draft (`openDraft`) entries;
- `getEditor`, for this editor's `EditorContext`.

The component that spreads all of it: [The component](plugin-guide/container-walkthrough.md#the-component).

#### `DraftSpec`, `DraftCloseCause`

```ts
interface DraftSpec {
	close(cause: DraftCloseCause): void;
}

type DraftCloseCause = 'mode-change' | 'undo' | 'document-swap';
```

A block holding an edit outside the document (a textarea's text) opens a [`Draft`](#draft-result) of its own bytes with the container factory's `openDraft(spec)`. It goes `stale` once a write elsewhere touches the block, and the editor calls `close(cause)` on one you haven't ended: `'mode-change'` and `'undo'` (an undo or redo about to replace the document) may still save, `'document-swap'` writes nothing. `end()` it once your box closes or your block unmounts. [What your own editing surface has to do](plugin-guide/render-primary.md#what-your-own-editing-surface-has-to-do) walks through it.

#### `rebuildStripRaw`

```ts
function rebuildStripRaw(node: CstNode, lines: LineCodec, options?: StripRebuildOptions): StripRebuild;
```

Your `rebuildRaw` for a container that puts a prefix on every line (a quote's `>`, a footnote's indent). It rebuilds the bytes from the children and keeps every line the edit didn't touch, as the author spelled it. Pass:

- the codec (`quoteLines`, `hangingIndentLines`, or your own `LineCodec`);
- the `changed` hint `rebuildRaw` got;
- `opener`, for a line above the body that holds none of it (an alert's `> [!NOTE]`).

Return what it returns. The bundled alert's whole rebuild:

```ts
function rebuildGithubAlertRaw(node: CstNode, changed?: ChildRawChange) {
	const alertType = getPluginMetadata<GithubAlertMetadata>(node)?.alertType ?? 'NOTE';
	return rebuildStripRaw(node, quoteLines, { changed, opener: `> [!${alertType}]` });
}
```

#### `hangingIndentLines`

```ts
function hangingIndentLines(shape: {
	opener: string;
	column: number;
	readOpener: (line: string) => string | null;
	continuesLazily?: LineCodec['continuesLazily'];
}): LineCodec;
```

Builds the codec for a container written like a list item: `opener` starts the first line, and every other line is indented `column` columns.

- `readOpener` says how the parser reads the first line's marker back (any spelling it accepts).
- `continuesLazily` is the parser's lazy-line rule, CommonMark's by default.

```ts
const footnote = hangingIndentLines({
	opener: '[^1]: ',
	column: 4,
	readOpener: (line) => (line.startsWith('[^1]: ') ? '[^1]: ' : null)
});
footnote.write('first', { first: true, trailingBlank: false }); // '[^1]: first'
footnote.write('second', { first: false, trailingBlank: false }); // '    second'
```

#### `LineCodec`, `LinePlace`, `BodyLine`

```ts
interface LineCodec {
	read(line: string, place: LinePlace): BodyLine | null;
	write(text: string, place: LinePlace): string;
	spells(line: string, text: string, place: LinePlace): boolean;
	continuesLazily(above: string, line: string, aboveFirst: boolean): boolean;
}
```

What a codec is, if neither of the two fits:

- `read` reads a line into the body line it holds (a `BodyLine`).
- `write` writes one back.
- `spells` is a cheap is-this-already-it check.
- `continuesLazily` is the lazy-line rule.

`LinePlace` says whether the line opens the container or sits in the blank run that ends it. Read the line the same way your parser strips it, or the rebuild respells lines it should have kept.

### Editable-leaf authoring

_(pre-freeze / unstable)_ The container factory's sibling for leaves; the full story is [The editable leaf](plugin-guide/editable-content.md#the-editable-leaf).

| Export | Role |
| --- | --- |
| `createEditableLeaf` | _(from `/svelte`)_ Wire a text-editing leaf with the editor's own caret, IME, undo, selection and clipboard; one spread wires the whole surface |
| [`EditableLeaf`](#editableleaf) | _(from `/svelte`)_ What the factory returns |
| `EditableLeafBlockApi` | The type of `leaf.blockApi`: a `BlockComponent` whose caret, selection, insert and source-commit methods are all there, so you call them without a `?.` |
| `EditableLeafMode` | _(from `/svelte`)_ The two modes: `'plain'` (always-editable source, per-keystroke commits) and `'render-primary'` (rendered view, reveal to edit, one commit on leaving) |
| `EditableLeafSurfaceProps`, `EditableLeafRenderProps` | _(from `/svelte`)_ The two spreads: the source surface's, and the folded rendered view's (a render-primary block spreads both) |
| [`EditableLeafDeps`](#editableleafdeps) | _(from `/svelte`)_ The factory's inputs |
| `StickyColumnDirection` | Which vertical direction the caret is entering your block from, handed to `focusAtColumn` so the column carries across lines |

#### `EditableLeaf`

_(from `/svelte`)_

```ts
function createEditableLeaf(deps: EditableLeafDeps): EditableLeaf;
```

What the factory returns:

- `blockApi`, everything the editor calls on your block, and your component's one export: `export const blockApi = leaf.blockApi`.
- The spreads (`surfaceProps`, and `renderProps` for a render-primary block).
- `sourceText`, the block's text.
- The mode and theme reads (`getPresentationMode`, `getTheme`).
- `getOptions<O>()`, your `defaults` when no editor is mounted, once your plugin is installed.
- `getEditor`, for this editor's `EditorContext`.
- The programmatic edits, `reveal` and `commitSource`.

#### `EditableLeafDeps`

_(from `/svelte`)_

```ts
createEditableLeaf({
	getNode: () => node,
	getIndex: () => index,
	getPath: () => myPath,
	getEl: () => sourceEl
});
```

The factory's inputs. The required ones are live getters, for the node, the index, the path and your source element. Then:

- the static `mode` and `singleLine` settings;
- `isRevealed` / `setRevealed`, in render-primary mode only, where you own the swap. Leaving one out there is a type error, and a throw when the leaf is built;
- the optional rest: `commandHooks`, and the painted-source trio `renderSource`, `onSourceEdit` and `reshapeSource`.

### Code-block languages

_(pre-freeze / unstable)_ The syntax-highlighting registry behind fenced code. The editor ships a curated couple dozen (the usual suspects: javascript, python, rust, bash, sql, the C family, and friends) plus their aliases, since every grammar is bundle weight for every host. `listLanguages()` tells you exactly which ones you have.

Register **before mounting an editor**: a block already on screen re-tokenizes only when its own bytes next change. An unregistered language is not an error: the fence still authors, commits and round-trips, and its body renders untokenized. A language your plugin's `setup` registers highlights, and shows in the picker, only in the editors that list your plugin. `listLanguages`, `getLanguageAliases` and `highlightCode` have no editor to ask, so they answer for every installed plugin.

| Export | Role |
| --- | --- |
| `registerLanguage` | Add a grammar under a name, with optional aliases; register-once, so a repeat call with the same name throws |
| `listLanguages` | Every registered language once, under its canonical name, sorted: the rows a picker with every installed plugin offers |
| `getLanguageAliases` | The other spellings a language answers to, asked by any of them: what a picker's filter matches on |
| `highlightCode` | The code block's tokenizer: `(body, language)` to a text-preserving fragment of `code-tok-*` spans, for a plugin's own source surface |
| `LanguageGrammar` | The registry's read shape: the resolved name and its definition |
| `LanguageFn` | highlight.js's grammar-definition type, re-exported so you needn't import highlight.js directly (you hold it only as a transitive dep) |
| `sliceFencedSource`, `FencedSource` | A fenced source split into its opener line, body and closer line, each keeping its own ending; null when the first line opens no fence |
| `renderFencedSource` | The code block's own drawing of a fenced source: the fence lines as markers the marker-hiding modes collapse, and the body through the painter you pass (`highlightCode`, say). Text-preserving, and it keeps a line for the caret under an empty last body line |
| `fenceBodyAsDrawn` | The body as `renderFencedSource` draws it: the line break before the closer belongs to the closer's line, unless the body is blank or nothing closes the fence |
| `fencedBodyRange` | Where the body sits in a fenced source, its line ending left out, or null while the fence has no body line yet. It's what a fenced kind returns from its descriptor's `bodyRange` |

```ts
import { registerLanguage } from '@voithos-labs/aragonite/plugin';
import elixir from 'highlight.js/lib/languages/elixir';

registerLanguage('elixir', elixir, ['ex', 'exs']);
```

The picker shows `elixir` once, and `ex` and `exs` are search keys for that row, so a user typing `ex` finds it without knowing the full name.

### Plugin views

_(pre-freeze / unstable)_ What an inline widget, a decoration's widget or badge, and an inline menu row are drawn with. The editor makes an element, hands it to your view with that slot's props, calls `update` when the props change and `destroy` when the slot drops it. A view that throws anywhere in there costs only itself: its slot draws the fallback (the source, no widget, the default row) and the `error` event gets one report. The recipe: [Rendering it as a widget](plugin-guide/inline-kinds.md#rendering-it-as-a-widget).

| Export | Role |
| --- | --- |
| `PluginView` | `(target, props) => handle`: draw into `target`, an element the editor made for you and removes once you're destroyed |
| `PluginViewHandle` | What a view hands back, both optional: `update(props)` takes the slot's next props (leave it out and what you first drew stays), `destroy()` releases what you hold, a framework root or a listener, and a promise it returns has its rejection reported |
| `svelteView` | _(from `/svelte`)_ A Svelte component as a view for any of these slots, as long as the props it declares are ones the slot passes: it's mounted into the target with the props live, so `update` re-renders only what reads a prop that changed |
| `reactView`, `ReactViewOptions` | _(from `@voithos-labs/aragonite-react`)_ A React component as a view for any of these slots, with the slot's props as its props; `update` re-renders it, `destroy` unmounts its root, and `wrap` hands it your providers |
| `vueView`, `VueViewOptions` | _(from `@voithos-labs/aragonite-vue`)_ A Vue component as a view for any of these slots, given the props it declares; `update` re-renders it, and `app` hands it your app's `provide`s and plugins |

### Inline authoring

_(pre-freeze / unstable)_ Syntax inside a paragraph: recognize it at a trigger character, render it as an **atomic widget** (one indivisible rendered thing the caret can sit beside but not inside), give it an editing policy. Several recognizers can share one trigger character; the editor asks them in priority order, and a **prefix handler** is one that's only asked where its multi-character prefix matches. The render paths and the tier's limits: [Inline kinds](plugin-guide/inline-kinds.md#inline-kinds).

| Export | Role |
| --- | --- |
| `declarePluginInlineKind` | Create an inline kind, the one-level-down twin of `declarePluginKind` |
| `declaredPluginInlineKind` | Recover a declared inline kind in another module |
| `registerInlineSyntax` | Hook the inline scanner on one trigger character with your recognizer; a reserved trigger (one a built-in owns, like `[`) takes only a prefix handler, priced below `INLINE_PRIORITIES.builtin` |
| `INLINE_PRIORITIES` | The inline priority order, lower asked first: `prefixOverride` (40) outranks a reserved trigger's built-in case, `builtin` (50) is where that case sits and the ceiling a reserved-trigger prefix stays under, `plugin` (100) is the bare-trigger default |
| `InlineSyntaxRecognizer` | The recognizer contract: inspect the raw at the trigger, claim a span by returning a node, or decline with null |
| `InlineSyntaxOptions` | The options bag: the multi-character `prefix`, the `priority`, `rewriteImage`, and `autoPair` |
| `ImageSyntaxRewriter`, `ImageFields` | The `rewriteImage` contract, for a registration whose recognizer builds built-in image nodes and must write edits back in its own syntax, and the edited fields it receives |
| `registerInlineWidgetKind` | Render an inline kind as a live atomic widget, drawn by the descriptor's `view` |
| `PluginInlineKind`, `InlineNode` | The inline kind type, and the node your recognizer builds |
| `InlineWidgetDescriptor` | The widget registration: the is-this-a-widget test, the `view` that draws it, the editing policy, and `frame` for a widget that stands as a box taller than its text, the way a picture does |
| [`InlineWidgetComponentProps`](#inlinewidgetcomponentprops) | A widget view's props |
| [`InlineWidgetEditingPolicy`, `InlineWidgetEditingContext`](#inlinewidgeteditingpolicy-inlinewidgeteditingcontext) | How the caret, a click and the delete keys treat your widget |

#### `InlineWidgetComponentProps`

```ts
interface InlineWidgetComponentProps {
	inline: InlineNode;
	source: string;
	getPresentationMode: () => PresentationMode;
	getTheme: () => string;
	getDocument: () => DocumentView | undefined;
	getContentVersion: () => number;
	navigateTo: (path: number[], offset?: number) => Promise<boolean>;
	computeInlineContent: (node: NodeView) => InlineNode[];
	isActivationClick: (click: ClickInput) => boolean;
}
```

A widget view's props. First, `{ inline, source }`: typing that moves the widget sends a new `inline` through `update`, and a changed source mounts a new view. Then the live getters, all always passed, so there's no default to pick:

- `getPresentationMode`, `getTheme`, `getDocument` and `getContentVersion`, for the mode, the theme, the document and the content version.
- `navigateTo(path, offset?)`, to jump to another block, optionally at an offset in it. A container path with no offset lands at the start of its first line, and an offset into its bytes lands in the child holding that byte.
- `computeInlineContent`, the editor's own inline parse.
- `isActivationClick(e)`, whether a click is the widget's to act on.

#### `InlineWidgetEditingPolicy`, `InlineWidgetEditingContext`

```ts
registerInlineWidgetKind(mention, {
	isWidget: () => true,
	view: mentionView,
	editing: { revealSource: true, deleteGranularity: 'atomic', onEdge: 'step-over' }
});
```

The policy, the descriptor's `editing` field. Every field is optional:

- `revealSource`, to reveal the source on caret entry;
- `revealContentSpan`, where the content sits inside the delimiters;
- `revealOffsetAtPoint`, which offset a press on the rendered widget names, so a click puts the caret where it landed;
- `deleteGranularity`, `'atomic'` or `'select-then-delete'`;
- `onEdge`, the edge behavior: `'select'` or `'step-over'`;
- `onSelectedKey`, a selected-key handler, which receives an `InlineWidgetEditingContext`;
- `claimsActivationClick`, whether the widget goes somewhere on a click the way a link does.

The policy field by field: [The editing policy](plugin-guide/inline-kinds.md#the-editing-policy).

### Commands and keybindings

_(pre-freeze / unstable)_ Which tier dispatches what: [Block commands](plugin-guide/commands.md#block-commands).

| Export | Role |
| --- | --- |
| [`registerBlockCommand`](#registerblockcommand) | Create a `(kind, name)` command and get back its id, for a keymap binding to target |
| `registerRangeIndent` | Let your kind's own indent command work over a selection spanning blocks: `(kind, command, shift)`, where `shift` rewrites the lines the selection covers in each of your blocks. Without it, an indent key over a range leaves your blocks alone |
| `RangeLineShift` | That `shift`: `(node, range) => { text, selection } \| null`, over the block's text without its final line ending; null when no line changes |
| `registerBlockContextActions` | Add, under a name unique to `kind`, the actions a right-click on a block of `kind` offers (its context menu), ahead of the editor's own copy, replace and remove rows; listed only in the editors that activate your plugin |
| `BlockContextAction` | One such action: id, label, optional glyph and danger flag, and `run(ctx)` |
| [`BlockActionContext`](#blockactioncontext) | What a context action's `run` receives |
| `BlockContextActionProvider` | The registered function: `(node, path, noun) => BlockContextAction[]`, consulted on every open; `noun` is what the menu calls the block |
| `registerGlobalCommand` | Create a process-wide command run against whichever editor dispatched it, optionally on a global chord; also returns its id. The handler receives that editor's `EditorContext` and the argument `runCommand(id, arg)` or the chord's binding carried |
| `CommandId` | A built-in command's id; a vocabulary your keymaps may bind too. `decorations.activateAtCaret` ships with no chord at all: it runs the `onActivate` of the mark under the caret ([Interactive marks](plugin-guide/decorations.md#interactive-marks-click-hover-and-the-keyboard)) |
| `KeyBinding` | One keymap entry: a chord (`Mod` / `Alt` / `Shift` plus the key, normalized to that order), a command id, an optional baked argument. A chord with an unknown modifier or no key throws when the kind registers or is augmented |
| [`CommandRun`](#commandrun) | The third argument a block's `runCommand` gets: `afterRemoval` |
| [`BlockCommandContext`, `BlockCommandHandler`](#blockcommandcontext-blockcommandhandler) | What a block command's handler receives, and the handler's signature |
| `BlockCommandTarget` | What a block hands a block command to run against (the node, `updateMetadata`, `replaceRaw`, the component's hooks), and what `BlockComponent.getCommandContext` returns, so a hand-built component can let the editor run your `afterRemoval` commands in it |
| `BlockCommandOptions` | That fourth argument's type |
| `PluginCommandId`, `AnyCommandId` | The id `registerBlockCommand` or `registerGlobalCommand` hands back, and the union of that and a built-in `CommandId` |
| [`imeOwnsKey`](#imeownskey) | Whether a keydown belongs to the IME |

#### `registerBlockCommand`

```ts
function registerBlockCommand(
	kind: AnyBlockKind,
	name: string,
	handler: BlockCommandHandler,
	options?: BlockCommandOptions
): PluginCommandId;
```

Creates a `(kind, name)` command and gets back its id, for a keymap binding to target. The fourth argument says what a key bound to it does over a selection:

- `{ overRange: 'afterRemoval' }` removes a selection spanning blocks first, then runs the command.
- `{ overSelection: 'afterRemoval' }` does the same over a selection inside the block.

```ts
const tag = registerBlockCommand(memo, 'memo.tag', (ctx) => {
	if (ctx.node.raw.startsWith('%%!')) return false; // already tagged
	ctx.replaceRaw('%%!' + ctx.node.raw.slice(2));
	return true;
});
// in the descriptor: keymap: [{ chord: 'Mod+Alt+T', command: tag }]
```

Names, metadata writes and the selection options at length: [Block commands](plugin-guide/commands.md#block-commands).

#### `BlockActionContext`

```ts
interface BlockActionContext {
	node: NodeView;
	path: number[];
	deleteBlock(): Promise<void>;
	replaceRaw(raw: string): Promise<void>;
	transformPaste(text: string): string;
	lineEnding: LineEnding;
}
```

What a context action's `run` receives:

- the node and its path;
- `deleteBlock()` and `replaceRaw(raw)`, one undo entry each. `replaceRaw`'s bytes go through your kind's write rule, every line break in the document's ending;
- `transformPaste(text)`, the paste transforms of the plugins that editor lists;
- `lineEnding`, the document's, for a line you rebuild from the block's own bytes.

A provider and its actions in full: [Block context actions](plugin-guide/commands.md#block-context-actions).

#### `CommandRun`

```ts
interface CommandRun {
	afterRemoval: boolean;
}
```

The third argument a block's `runCommand` gets. `afterRemoval` is true when the editor removed a selection before running the command.

A hand-built block reads it in its own `runCommand` to skip an "Enter on an empty line" branch of its own. A plugin handler gets the same field as `ctx.afterRemoval`, since `BlockCommandContext` extends `CommandRun`.

#### `BlockCommandContext`, `BlockCommandHandler`

```ts
type BlockCommandHandler = (ctx: BlockCommandContext) => boolean;
```

What a block command's handler receives, and the handler's signature. The context:

- `node`, the focused node, read-only;
- `arg`, the argument;
- `updateMetadata(patch)`, a container's metadata patch, which its `rebuildRaw` writes into the bytes;
- `replaceRaw(raw)`, a rewrite of the block's bytes as one undo entry, which is how a leaf's command changes its metadata;
- `hooks`, the mounted component's own hooks;
- `editor`, the dispatching editor's `EditorContext`;
- `afterRemoval`, from `CommandRun`.

#### `imeOwnsKey`

```ts
function imeOwnsKey(e: KeyboardEvent): boolean;
```

Whether a keydown belongs to the IME: one inside a composition, or the key that opens one (Chromium and WebKit send that with `isComposing` false, as `Process` or code 229). Start a keydown handler of your own, a textarea's or an overlay's, with it, so the Enter or Escape someone typing Chinese or Japanese presses to pick a word never runs your command.

```ts
textarea.addEventListener('keydown', (e) => {
	if (imeOwnsKey(e)) return;
	if (e.key === 'Enter') save();
});
```

### Paste transforms

_(pre-freeze / unstable)_ The recipe: [Paste transforms](plugin-guide/paste-transforms.md#paste-transforms).

| Export | Role |
| --- | --- |
| `registerPasteTransform` | Register a pre-parse rewrite of pasted text; transforms run at every paste site, in install order, each seeing the previous one's output (the first gets CRLF already turned to LF), and never on load or typing |
| `PasteTransform` | The unit: a process-unique `name`, plus `transform(text)` returning the replacement or null for "not mine" |

### Decorations

_(pre-freeze / unstable)_ View-only annotations drawn over the rendered document. They live outside the tree, so they reach neither the saved bytes nor the undo stack. You register a source per editor through `editor.decorations` (your `onEditor` context). The recipe and both authoring contracts: [Decorations](plugin-guide/decorations.md#decorations).

| Export | Role |
| --- | --- |
| `DecorationRegistry` | The `editor.decorations` surface; `addSource` registers a source and returns its handle |
| `DecorationSource` | A named, pure source: `provide(document, ctx)` returns the decorations to render, and is re-run after every edit |
| `DecorationSourceHandle` | The handle back: `invalidate()` re-runs just your source, synchronously, except from an `edit` handler, where it waits for the commit to publish; `dispose()` removes it |
| `ProvideContext` | `provide`'s second argument, carrying `editEpoch`: a counter that bumps once per document change and never on `invalidate()`. Key a cached scan on it |
| `Decoration` | The union of the four decoration types a source may return |
| `MarkDecoration`, `WidgetDecoration`, `ReplaceDecoration`, `BlockDecoration` | The four: a styled span over an inline range, a zero-width widget at an offset, a widget covering a range whose bytes stay in the document, and a whole-block treatment with an optional badge |
| `MarkInteractions` | What a mark's `interactive` field takes: `onClick`, `onHover` and `onActivate`, at least one of them. A mark with `onClick` takes the click; a hover-only mark lets it through to the text. `onActivate` is the keyboard's way in, run by the `decorations.activateAtCaret` command |
| `MarkHover` | What `onHover` gets when the pointer enters a mark: `anchor`, the rect it entered (put your popup here), and `rects`, every rect the mark paints, all in viewport coordinates. It gets `null` once the hover's over |
| `DecorationWidgetSpec` | How a decoration's widget or badge renders: `{ view }`, a `PluginView` given `{ decoration }`. A widget that stays put across a re-run keeps its view, which gets `update` with the new decoration |

### Inline menus

_(pre-freeze / unstable)_ A list the editor opens under the caret while the author types after a trigger: `#` for a tag, `[[` for a link to another document. You register a source per editor through `editor.inlineMenus` (your `onEditor` context); a host that owns the data reaches the same registry as `getInlineMenus()`. The editor owns the session: it notices the typed trigger, holds the arrow keys, Enter, Tab and Escape while a list is up, anchors the list to the typed range, and writes the pick over the trigger and the query as one undo entry. The caret never leaves the document. The recipe: [Recipe: a typed-trigger menu](consumer-guide/recipes.md#recipe-a-typed-trigger-menu).

| Export | Role |
| --- | --- |
| [`InlineMenuRegistry`](#inlinemenuregistry) | The `editor.inlineMenus` surface |
| [`InlineMenuSource`](#inlinemenusource) | A named source: its trigger, its list, and what happens around a pick |
| `InlineMenuOpenOptions` | `open`'s second argument: a `query` typed after the trigger, so the list opens already narrowed |
| `InlineMenuSourceHandle` | The handle back: `dispose()` removes the source and closes its list |
| [`InlineMenuItem`](#inlinemenuitem) | One row of the list |
| [`InlineMenuCommit`](#inlinemenucommit) | What `onCommit` gets as its third argument |
| `InlineMenuQuery` | What `items` is asked: the `query` typed so far, the leaf's `path`, the raw range `[start, end)` a pick would replace, and a `signal` aborted once a later keystroke supersedes the read |
| `InlineMenuRowProps` | What a `row` view receives, at mount and on each `update`: the `item`, whether it is `active`, and the `query` (for highlighting the match) |

#### `InlineMenuRegistry`

```ts
interface InlineMenuRegistry {
	addSource(source: InlineMenuSource): InlineMenuSourceHandle;
	open(name: string, options?: InlineMenuOpenOptions): boolean;
	close(): void;
	readonly isOpen: boolean;
}
```

The `editor.inlineMenus` surface.

- `addSource` registers a source and returns its handle.
- `open(name, { query })` types a source's trigger, then the query if given, at the caret as one undo entry, and opens its list over it. It's what a shortcut or a toolbar button calls. It returns `false`, writing nothing, for an unknown name, in reading mode, with no caret in prose, or for a query holding a line break.
- `close()` dismisses.
- `isOpen` is true while a list is on screen.

#### `InlineMenuSource`

```ts
interface InlineMenuSource {
	name: string;
	trigger: string;
	items(query: InlineMenuQuery): InlineMenuItem[] | Promise<InlineMenuItem[]>;
	opensAt?(raw: string, pos: number): boolean;
	accepts?(query: string): boolean;
	onCommit?(item, query, editor: InlineMenuCommit): void | Promise<void>;
	row?: PluginView<InlineMenuRowProps>;
}
```

A named source. The required half:

- its `trigger`, one line, never empty;
- `items(query)`, which returns the list or a promise of it.

And optionally:

- `opensAt`, to decline a trigger by position;
- `accepts`, to end the session on a query that is no longer yours;
- `onCommit`, run after the bytes land, with the range the pick replaced (so the caret is at `start + insert.length`) and an `InlineMenuCommit`, the editor context to write through. If it returns a promise, every write that lands while it's pending, up to the author's next input, is part of the pick's undo entry;
- `row`, a `PluginView` that paints a row's content and takes `update` as the row turns active or the query changes. A row whose view throws shows the default label, and the throw is reported on the `error` event.

```ts
editor.inlineMenus.addSource({
	name: 'tags',
	trigger: '#',
	items: ({ query }) =>
		['urgent', 'someday', 'never']
			.filter((tag) => tag.startsWith(query))
			.map((tag) => ({ id: tag, label: tag, insert: `#${tag} ` }))
});
// typing `#so` lists "someday"; Enter writes `#someday ` over `#so`, as one undo entry
```

#### `InlineMenuItem`

```ts
interface InlineMenuItem {
	id: string;
	label: string;
	detail?: string;
	icon?: MenuIconName;
	insert: string;
}
```

One row:

- an `id` unique within the list. Where two rows share an id the first is kept and the rest are dropped and reported on the `error` event;
- a `label`;
- an optional dim `detail`;
- an optional `icon`, a menu glyph name the default row draws;
- `insert`, the bytes that replace the trigger and the query. It's one line of inline bytes, empty allowed. A line break is refused and reported, and a block belongs in `onCommit`.

#### `InlineMenuCommit`

```ts
interface InlineMenuCommit extends EditorContext {
	readonly signal: AbortSignal;
}
```

What `onCommit` gets as its third argument: your plugin's `EditorContext` scoped to the pick, live like it, except that `insertMarkdown` and `runCommand` write nothing and answer false once the host has loaded another document. The `signal` aborts then too. Write through it, not the context you closed over in `onEditor`.

### Insert catalogue

_(pre-freeze / unstable)_ The blocks the insert menus offer: the built-in lists, quote, divider, code block and table, then the blocks plugins add. Read it through `editor.insertCatalogue` (your `onEditor` context); a host reads the same list as `getInsertCatalogue()`.

| Export | Role |
| --- | --- |
| `registerInsertEntry` | Add your block to every insert menu, called from `setup`. It is listed only in the editors that activate your plugin. Throws on a duplicate id and on an icon the menu cannot draw |
| `InsertEntry` | One entry: an `id`, a `label`, an `icon`, `keywords` a filter should also match, its `markdown`, and an optional `withArgument` giving the Markdown and dim text for `/table 3x4` |
| `MenuIconName` | The glyph names a menu row can draw |

### Events

_(pre-freeze / unstable)_ The payloads `EditorContext.events` delivers to an `on(name, handler)` subscription. The channel itself: [The plugin unit](plugin-guide.md#the-plugin-unit).

| Export | Role |
| --- | --- |
| `EditorEventMap` | Event name to payload, so a handler you declare apart from the `on` call still types |
| `EditEvent` | The `edit` payload: `op`, the `path` it landed at, a per-op `detail`, and a `timestamp`. `op` and `detail` are correlated, so narrowing `op` narrows `detail` with it |
| `OperationKind` | The structural-operation vocabulary `EditEvent.op` draws from |
| `SelectionChangeEvent`, `EditorError` | The other two payloads worth naming: the anchor/focus pair (or null), and a contained failure with its `origin` and context |
| `SourceSwapEvent` | The `sourceSwap` payload: the `generation` a `source` write replaced the document at |

### Rects

_(pre-freeze / unstable)_ Where things are on screen, reached through `editor.rects` (your `onEditor` context) or the `rects` prop every block component receives.

#### `EditorRects`

```ts
interface EditorRects {
	blockRect(path: number[]): DOMRect | null;
	rangeRects(path: number[], start: number, end: number): DOMRect[];
	caretRect(): DOMRect | null;
	reveal(path: number[]): Promise<boolean>;
	scrollTo(path: readonly number[], opts?: { block?: 'nearest' | 'center'; hold?: boolean }): Promise<boolean>;
	navigateTo(path: readonly number[], offset?: number): Promise<boolean>;
}
```

The geometry surface:

- `blockRect`, a block's box;
- `rangeRects`, an inline range's rects, one per visual line, or one per cell in a table;
- `caretRect`, the native caret;
- `reveal`, which mounts a block the editor had skipped (it only mounts blocks in view);
- `scrollTo`, which mounts then brings a block into view;
- `navigateTo`, which also lands the caret there, at the block's start or at an offset you name.

```ts
await editor.rects.navigateTo([4], 12); // true once block 4 is on screen with the caret 12 bytes in
```

### Caret geometry

_(pre-freeze / unstable)_ What a kind fills its descriptor's `caretTargetAtPoint` with. The rendered view and the source are different strings, so only your kind knows how a press on one lines up with the other; these three are the pieces that don't depend on your grammar. The worked example is the quickstart's parrot: [The first fifteen minutes](plugin-guide.md#the-first-fifteen-minutes).

| Export | Role |
| --- | --- |
| [`caretOffsetAtPoint`](#caretoffsetatpoint) | The character offset in one of your own elements nearest a viewport point |
| `CaretTarget` | What the hook answers: the child path to the leaf (empty when your block is the leaf) and the offset inside it |
| `CURSOR_END`, `CursorEnd` | The offset meaning "wherever that leaf ends", and its type; a plain `0` is the other end, since that one is a real offset |

#### `caretOffsetAtPoint`

```ts
function caretOffsetAtPoint(el: HTMLElement, clientX: number, clientY: number): number | null;
```

The character offset in one of your own elements nearest a viewport point.

- The point clamps into that element's box first, so a press on your chrome still names one.
- A press in its top or bottom padding takes the column under it on the nearest line.
- Null means the element holds no position at all.

```ts
function parrotCaretAtPoint(blockEl: HTMLElement, clientX: number, clientY: number): CaretTarget | null {
	const caption = blockEl.querySelector<HTMLElement>('.parrot-caption');
	if (!caption) return null;
	const offset = caretOffsetAtPoint(caption, clientX, clientY) ?? 0;
	// The caption starts after `%%parrot ` in the source, so its offsets shift by that much.
	return { path: [], offset: offset + Number(caption.dataset.captionStart) };
}
```

The quickstart's full version also handles a click while the source is showing ([The first fifteen minutes](plugin-guide.md#the-first-fifteen-minutes)).

### Pointer gestures

_(pre-freeze / unstable)_ One attribute, for a block whose drags are its own (a diagram you pan, a canvas you draw on). Without it the editor reads the press as the start of a selection, and your pan runs under a painted block range. Calling `stopPropagation()` in your own handler doesn't help: Svelte delivers pointer events from the app root, so the editor's listener has already run.

#### `POINTER_GESTURE_ATTR`

```ts
const POINTER_GESTURE_ATTR: string;
```

Put it on the element whose drags are yours. A press inside it is left alone by drag-to-select, and by the double and triple click too, as long as the element sits outside any `contenteditable` (inside editable text, the inline widget's own click rules apply instead). The editor reads it at press time, so declare it always or only while your gesture is armed.

```svelte
<div class="viewport" {...{ [POINTER_GESTURE_ATTR]: focused ? '' : undefined }} onpointerdown={beginPan}>
```

That is what mermaid does: unfocused, a drag on the diagram selects like it would on any block; focused, it pans.

### Selection geometry

_(pre-freeze / unstable)_ The selection shapes a decoration source or geometry consumer reads.

| Export | Role |
| --- | --- |
| [`EditorSelection`, `SelectionPoint`](#editorselection-selectionpoint) | The `selectionChange` payload, and one endpoint of it |
| `SELECTION_END`, `SelectionEnd` | The importable "through the end of this block's measurable content" value `rangeRects` accepts as `end`, and its type |

#### `EditorSelection`, `SelectionPoint`

```ts
interface EditorSelection {
	anchor: SelectionPoint;
	focus: SelectionPoint;
}
```

The `selectionChange` payload, an anchor/focus pair. A `SelectionPoint` is one endpoint of it: a `{ path, offset }`. Inside a table `offset` counts cells rather than characters, and `cellCoordinate: true` says so on every such point.

```ts
const firstFive: EditorSelection = {
	anchor: { path: [2], offset: 0 },
	focus: { path: [2], offset: 5 }
}; // the first five characters of block 2
```

The consumer side of the same shape: [the consumer guide](consumer-guide.md#reading-the-document-and-the-selection).

### Parse and serialize

_(pre-freeze / unstable)_ The editor's own parse and serialize entries, re-exported here so an opener or a transform never digs into the package's internals.

| Export | Role |
| --- | --- |
| `parse` | Parse a body of Markdown into a document you can lift children from |
| `ParseScope` | What a parse entry is told about its input: a whole document, or one block's bytes (`'fragment'`) |
| [`parseContainerBody`, `ContainerBodyWrap`](#parsecontainerbody-containerbodywrap) | Parse a body that sits between your container's own fence lines |
| `serialize` | A whole document back to its exact source bytes |
| `serializeChildren` | Child nodes joined back into their exact source bytes |
| `Document` | The parsed-document shape both parse entries return |
| `splitLines` | Split source into the parsed lines every line-scoped helper here consumes |
| `ParsedLine` | One source line: its text, its bytes with the ending, the ending itself, its offsets |
| `isBlankLine` | The GFM blank-line test, spaces and tabs only. `trim()` isn't a stand-in: it would let a pasted non-breaking space split a block |
| `isBlankText` | The same test over a whole block's text, line breaks allowed: the "is this block empty?" check, where a non-breaking space someone typed still counts as content |
| `isWhitespaceChar` | Whether one character is Markdown whitespace: a space, a tab, a line-break character, a vertical tab or a form feed, never a non-breaking space. Ask this where your grammar would've reached for `/\s/` |
| `trimWhitespace` | `trim()`, but Markdown's: the characters `isWhitespaceChar` accepts come off both ends, and a non-breaking space stays. Use it on an info string or a caption before you show it |
| `isUnicodeWhitespace` | Whether one character is the Unicode whitespace emphasis reads beside a `*`: a space, a tab, a line break, a form feed or any space separator, the non-breaking space included. Ask this beside a delimiter of your own, like latex's `$` |
| `trimTrailingLineEnding` | Cut the one trailing line ending (LF or CRLF) off a block's bytes, giving the text you display |
| `ownTrailingLineEnding` | The ending a block's bytes close with (`''` when they have none): what you put back after editing the display |
| `trailingLineEnding` | The ending a line rebuilt from a block's bytes takes: the block's own, else the fallback you pass (a write rule's or a context action's `ctx.lineEnding`, or `documentLineEnding` of a document you hold) |
| `firstLineEnding` | The first line break in some bytes, or `null`. In a document with one ending (nearly all of them), any break in your block's bytes is the document's |
| `documentLineEnding` | The ending every line written into a document takes: its first line break, else LF |
| `LineEnding` | `'\n'` or `'\r\n'` |
| `displayLines` | A block's display as lines, each line's text apart from its ending, so a `\r` never reaches a line match |
| `joinDisplayLines` | Lines from `displayLines` back into their exact bytes |
| `normalizeLineEndings` | CRLF to LF, for text arriving from outside the document (a plugin-owned input surface) |
| `withLineEnding` | Every line break in some LF text rewritten as the ending you pass, for text coming back from a plugin-owned input into the document |

#### `parseContainerBody`, `ContainerBodyWrap`

```ts
function parseContainerBody(
	bodyText: string,
	wrap: ContainerBodyWrap,
	opts: { scope: ParseScope; grammar: GrammarView; depth?: number }
): Document;
```

Parses a body that sits between your container's own fence lines, keeping the separating blank lines out of the children.

- `wrap` says which fence lines exist (`afterOpenerLine`, `beforeCloserLine`), and matches your kind's `bodyWrap`.
- `opts` takes a `scope` and the grammar, both required. Pass the grammar your opener was given, so the body reads with the syntaxes the editor has on. `depth` is optional.

```ts
const body = parseContainerBody(
	'\nhello\n\n',
	{ afterOpenerLine: true, beforeCloserLine: true },
	{ scope: 'fragment', grammar: ctx.grammar }
);
// body.prefix '\n', body.suffix '\n', body.children: one paragraph, raw 'hello\n'
```

### Grammar scanners

_(pre-freeze / unstable)_ The built-in rules for three grammars a plugin commonly claims, exported so you reuse them instead of forking the spec (the spec is longer than it looks, every time, trust me).

| Export | Role |
| --- | --- |
| `matchFenceOpen` | Recognize a CommonMark code-fence opener line, keeping the verbatim indent and info bytes a byte-exact rebuild needs |
| `matchFenceClose` | Is this line the closer for a matched opener (same marker, at least its run length)? |
| `escalatedFenceLength` | The fence run a body forces so none of its lines reads as the closer; a floor, never a shortening. A kind that rebuilds its own raw around a body has to apply it, and grow the closer to match |
| `FenceOpen` | A matched opener: marker, run length, trimmed `info`, verbatim `indent` and `infoRaw` |
| `matchFenceInfo` | Build an opener matcher that claims only fences whose info string's first word is your token: `matchFenceInfo('mermaid')` is how the bundled diagram kind takes ` ```mermaid ` from the code block |
| `findFenceCloser`, `FenceRun` | The index of the first line in a range that closes a fence of that marker and run length (the closer the parser would pick), or -1 |
| `scanFence`, `FenceScan` | A fence's extent from its opener line, as an opener's `tryOpen` needs it: the closer's index (-1 when nothing closes it), the lines consumed, the exact bytes, and the body between the fence lines |
| `fenceAnatomy`, `FenceAnatomy` | Where a fenced block's parts sit in its bytes: the opener's indent, marker run and info string, the body, and the closer line; null when the first line opens no fence |
| [`fenceRawWrite`, `fenceShapeOfRaw`, `FenceShape`](#fencerawwrite-fenceshapeofraw-fenceshape) | The code block's write rule, for any kind that holds its own fence |
| `fenceReading` | The fence's `readingNotFinal`: declare it on an opener that claims a fence, and an edit that moves where your fence closes re-pairs every fence below it the way a reload does |
| `htmlBlockTagLineMatcher` | Build a recognizer answering `'open'`, `'close'`, or null for one tag name's HTML block line, in every spelling the spec passes through (indented, upper-cased, trailing space), not just the canonical one |
| `blockquoteExtent` | Scan a blockquote's full extent (CommonMark lazy continuation) from a start line: its exact bytes plus the index past it (a slice bound, not a consumed count), no child decomposition. Its optional grammar argument defaults to every installed plugin's |

#### `fenceRawWrite`, `fenceShapeOfRaw`, `FenceShape`

```ts
function fenceRawWrite(shapeOf: (node: NodeView) => FenceShape): WriteRule;
function fenceShapeOfRaw(node: NodeView): FenceShape;
```

The code block's write rule, for any kind that holds its own fence. Declare `rawWrite: fenceRawWrite(fenceShapeOfRaw)` and every write to your block's bytes goes through it, typing included.

- A find/replace, a range delete or a paste that cuts your closer gets it back.
- Both runs grow past a body line that would close the block early.
- It never deletes a byte the write didn't touch, so a closer whose opener went stays and reads on, the way a reload reads it.
- A fence you're still typing, with no closer yet, is left alone.

`````ts
const rule = fenceRawWrite(fenceShapeOfRaw);
// a paste (ctx.mode 'literal') into a block whose bytes were '```\ncode\n```\n':
rule.normalize('```\ncode\n', ctx); // '```\ncode\n```\n', the closer back
rule.normalize('```\na\n```\nb\n```\n', ctx); // '````\na\n```\nb\n````\n', both runs grown
`````

### Node access and metadata

_(pre-freeze / unstable, beyond the stable metadata pair `setPluginMetadata` / `getPluginMetadata`)_ The document tree from a plugin's side of the glass: what you read arrives read-only, and what you build yourself stays writable ([Views](plugin-guide.md#views-what-you-read-what-you-own)).

| Export | Role |
| --- | --- |
| `CstNode` | The writable tree-node shape you construct: what a factory builds and a `rebuildRaw` mutates |
| `NodeView`, `DocumentView` | The read-only views every read surface hands you. Writing bytes through one is a compile error |
| `setPluginMetadata`, `getPluginMetadata` | Store and read your kind's own typed per-node data, no casting; keep the stored shape primitive-valued |
| `getContentRange`, `ContentRange` | The content span inside a block's raw, syntax markers excluded (a heading's `#`s at either end, a setext underline) |
| `headingLevel` | A heading's level, ATX or setext, null for anything else: the outline read a table-of-contents plugin wants |
| [`computeInlineContent`](#computeinlinecontent) | Inline-parse a prose leaf with every installed plugin's syntax, for a pipeline with no editor mounted |
| `isProseKind` | Does this kind host inline content? The gate that keeps a code block's bytes out of an inline walk |
| [`walkBlocks`, `WalkControl`](#walkblocks-walkcontrol) | Visit every block under a document or a block, parents first |
| `blockNodeAt` | The block at a path, or null when there's none. The empty path is the document itself, which isn't a block, so that's null too |

#### `computeInlineContent`

```ts
function computeInlineContent(node: NodeView): InlineNode[];
```

Inline-parses a prose leaf with every installed plugin's syntax, for a pipeline with no editor mounted. Inside an editor use `editor.computeInlineContent`, which reads only what that editor lists.

It's uncached. With no document to define them, reference-style links come back as plain text.

#### `walkBlocks`, `WalkControl`

```ts
function walkBlocks(root, visit: (node, path: number[]) => WalkControl, basePath?: readonly number[]): boolean;
type WalkControl = void | 'skip' | 'stop';
```

Visits every block under a document or a block, parents first, each with its path (yours to keep).

- Return `'skip'` to leave a block's children out.
- Return `'stop'` to quit; `walkBlocks` then returns true.
- `WalkControl` is that return type, for a visitor you write as its own function.
- Walking a subtree? Pass its path third to get document paths.

```ts
walkBlocks(parse('# Plans\n\n> ## Secret plans\n> nap\n'), (node, path) => {
	console.log(path.join('.'), node.kind);
});
// 0 heading
// 1 blockquote
// 1.0 heading
// 1.1 paragraph
```

### Injected renderers

_(pre-freeze / unstable)_ For a block or widget drawn by a library the host hands your plugin (KaTeX, mermaid). A **renderer slot** is the one place that library plugs in: your plugin's setup calls `set`, your component calls `render`, and the slot handles the caching and the fallbacks. The [render-primary recipe](plugin-guide/render-primary.md#recipe-a-render-primary-block) walks through one.

| Export | Role |
| --- | --- |
| [`createRendererSlot`](#createrendererslot) | A slot for a renderer that answers right away |
| `createAsyncRendererSlot` | The same for a renderer that returns a promise. The promise is what's cached, so two blocks asking for one diagram share a single call, and a rejection resolves through `failed` |
| `RendererSlot`, `AsyncRendererSlot` | What the two hand back: `set(renderer)` (`null` removes it, and either way the cache empties), `configured`, and `render(input, ctx)`. `resetPluginPlatformForTests` removes the renderer too |
| `RendererSlotSpec` | What you pass either one: `key`, `missing`, `failed`, and an optional `cap` (256 renders by default) |
| `SyncRendererSlotSpec` | `createRendererSlot`'s spec: a `RendererSlotSpec` plus an optional `cloneOnRead(value)`, which hands each caller its own copy of a cached value. The async slot caches a promise, so it has no use for one |
| `RenderContext` | `{ theme }`, the second argument to every `render` and to your renderer. It's required, so nothing gets drawn or cached without a theme. Read the theme with `getTheme()` inside your render effect, since that read is what redraws the block on a switch |
| [`renderSourceFallback`](#rendersourcefallback) | The typed source in the code font, with a message on hover: a decent fallback output |

#### `createRendererSlot`

```ts
function createRendererSlot<Input, Output>(spec: SyncRendererSlotSpec<Input, Output>): RendererSlot<Input, Output>;
```

A slot for a renderer that answers right away.

- Each render is cached under the editor's theme plus your `key(input)`, so a theme switch misses the cache and switching back is a hit.
- With no renderer set you get `missing(input)`.
- When the renderer throws you get `failed(input, error)`, cached like a success.
- Pass `cloneOnRead` when the output holds a live DOM node.

The bundled math plugin's slot:

```ts
export const mathSlot = createRendererSlot<{ source: string; display: boolean }, MathRender>({
	key: ({ source, display }) => `${display}\0${source}`,
	cloneOnRead: ({ dom, error }) => ({ dom: dom.cloneNode(true) as HTMLElement, error }),
	missing: ({ source }) => ({ dom: renderSourceFallback(source, 'Math renderer not configured') }),
	failed: ({ source }, error) => {
		const message = error instanceof Error ? error.message : String(error);
		return { dom: mathErrorNode(source, message), error: message };
	}
});
// setup: mathSlot.set(renderer); a block: mathSlot.render({ source, display: true }, { theme })
```

#### `renderSourceFallback`

```ts
function renderSourceFallback(source: string, message: string): HTMLElement;
```

Builds the typed source in the code font, with `message` on hover: a decent `missing` or `failed` output for anything drawn from source text. It's neutral, so add your own error color where a failure should look like one (math does).

```ts
const el = renderSourceFallback('$x^$', 'Expected group after ^');
el.style.color = 'var(--color-error)'; // a span reading `$x^$`, the message in its tooltip
```

### Performance helpers

_(pre-freeze / unstable)_ Two small tools: the cache under the renderer slot, and a scan index the inline recognizers lean on.

| Export | Role |
| --- | --- |
| `createBoundedMemo` | A bounded, least-recently-used memo for per-source work. Async work stores the promise (in-flight renders shared, failures cached like successes); `cloneOnRead` covers a cached value holding a live DOM node |
| `BoundedMemoOptions` | The memo's options: the entry `cap`, the optional `cloneOnRead` |
| `createScanIndex` | Turn a per-block position collector into a "first candidate at or after this offset" lookup (-1 when none), so a recognizer's decline costs one block scan instead of one per trigger |

---

Working on aragonite itself and adding an export? Give it a row in its group, tagged the way its entry-module section is tagged; one that takes more than a sentence or two also gets an entry under the table, and its row links down to it. A test (`src/lib/test/plugins/plugin-guide-coverage.test.ts`) diffs this page against the entry module and fails naming any export without a row or entry. It finds the catalog by the exact `## API reference` heading, so if you rename the heading, rename it there too.
