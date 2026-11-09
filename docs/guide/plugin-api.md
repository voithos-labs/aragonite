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
| `PluginSpec` | What you hand `definePlugin` to get a plugin value instead: `name`, `version`, the `editor` range it runs on, `defaults`, `validate`, `needs`, `conflicts`, and `contributes(options)`, which each editor calls with its own options |
| `Plugin` | The plugin value that comes back. Call it with options (`math({ render })`) to give one editor different ones |
| `PluginList` | A list of plugin values, whatever their options, as `needs` takes it |
| `Contribution` | What `contributes` hands back for one editor: its `blocks`, a `setup(editor)` that runs once that editor mounts, the `commands` it runs, its `inserts` rows, its caret `menus`, and its selection `actions` |
| `Editor` | What `setup` and your commands get: the plugins on, the mode, the theme, the `inserts` rows, `on`, `run` and `can` (a command by value or id, with its argument), `claims`, `openMenu` (types a caret menu's trigger at the caret and opens it), `openRows` (opens a selection action's rows over a range) and `edit`. It's one object per plugin per editor, and a listener you add there goes away with your plugin |
| `PluginError` | An error your plugin caused: its name, what the editor was doing with it (`install`, `validate`, `contributes`, `setup`, `dispose`, `run shout/hello` for a command, or `on('edit')` for a listener that threw), and the cause |
| `BlockType` | A block type: its `name` (yours read `plugin/local` once an editor runs your plugin) and its `label` |
| `builtin` | The built-in block types by kind (`builtin.blocks.paragraph`), to place yours relative to one or tell what a block is |
| `lineBlock` | A block type that's exactly one line, matched whole by `match`. A `text` named group is the part you type in, the rest its marker. List it in `contributes(...).blocks` |
| `LineBlockSpec` | What `lineBlock` takes: `match`, plus `data(match)` and `write(data, text)` together when the line carries data. For a line a regex can't read (a closing run that counts only after a space, say), `match` is a function returning the text's `[start, end]` and the line's `data`, or null, with `write` beside it |
| `fencedBlock` | A block type opened by one line and closed by a later one: a code fence with your info string (` ```math `), or your own opening and closing lines. A code fence's closer grows past a body line that would close it |
| `FencedBlockSpec` | What `fencedBlock` takes: `fence`, one spelling or several |
| `container` | A block type holding other blocks. You say how its lines look in `lines` and the editor reads and writes them, so there's no opener or writer to write. Its children are the editor's to draw, inside your drawing |
| `ContainerSpec` | What `container` takes: `lines`, plus `joins` (default true: text joined to its end from below lands in its deepest text block), `merges` (the data field a pasted one must share with the one it lands in to join it, rather than nest) and `draw` |
| `ContainerLines` | The line shapes a `container` takes: a `marked` one (a marker on every line, with a `head` line or not) or an `indented` one, the same shapes as [`LineShape`](#lineshape-markedlines-indentedlines). An indented container shows its marker ahead of its first child's text, read-only |
| `Fence` | `{ info }` takes over code fences with that info string; `{ open, close, escape? }` opens on a line `open` matches and closes on the line `close` spells. A body line spelling the closer goes through `escape`, or ends the block there without one. Unclosed, the opening line stays plain text |
| `BlockInsert` | A block type's `insert`: its row in the insert menus (`label`, `icon`, `keywords`, the Markdown it `insert`s), listed as `plugin/name`, or `{ none: 'why' }` for a type nobody inserts from a menu |
| `Completion` | A block type's `complete`: a typed or entered line (`on`) that `line` matches, written out as `complete(match)`'s lines with the caret where it says. A completion that wouldn't read back as the block type is refused |
| `BlockCommon` | What every block type answers: `name`, `label`, `icon`, `sample`, `insert`, `role` (`prose` merges with its neighbours, an `object` is picked up whole), `interrupts`, `before` (the built-in types it goes ahead of), `height` and `complete` |
| `LeafCommon` | What a block holding text adds: `body` (`markdown` or `literal`) and how it draws (`LeafDraw`) |
| `LeafDraw` | `edit` and `draw`. `edit: 'text'` keeps the text always editable, writing every keystroke; `edit: 'source'` shows your drawing until the caret comes in and writes the text once as it leaves; `edit: 'box'` lets no caret in. Without `draw` a block is plain text; with it the default is `'source'`. `renderSource` and `reshapeSource` paint and reshape the shown text |
| `Drawn` | What `draw(block, ctx)` hands back: your `dom`, and optionally `caret` (where a click on your picture of the text lands), `update`, `keep` (events the editor leaves to you), `focus` and `destroy` |
| `DrawContext` | What every drawing gets: `editor`, `mode`, `theme`, `focused`, `render(el, produce)` (a renderer's output cached per bytes and theme, the source and the error when it throws) and `keepScroll()` |
| `TextDrawContext` | Adds `source`, the editor's element for the block's text, for you to place, and `typed`, the text as typed before an `edit: 'source'` block writes it |
| `ContainerDrawContext` | Adds `children`, the editor's element holding the block's children, for you to place, and `title`, its title row's element, or null |
| `BoxDrawContext` | Adds `leave(edge, x?)`, which hands the caret to the neighbour past `edge` from an editing surface of your own, and `focusWhole()`, which gives the box whole-block focus back from a field of your own (Escape out of an edit box) |
| `BoxFocus` | `Drawn.focus` for a box with an editing surface of its own: `enter` takes the caret at an edge (with the column an up or down arrow keeps) or back at an offset, and `offset()` says where its caret is |
| `svelteBlock`, `SvelteBlockProps`, `reactBlock`, `vueBlock`, `BlockProps`, `ReactBlockOptions`, `VueBlockOptions`, `useDrawn` | _(`svelteBlock` from `/svelte`, the others from `@voithos-labs/aragonite-react` and `-vue`, and each has its own `useDrawn`)_ A `draw` from your component. It gets `{ block, ctx, Slot }`, and `<Slot of="source" />` (or `"children"`, `"title"`) is where the editor's element goes. `className` lands on the block's element; React's `wrap` adds your providers, Vue's `app` renders in your app's context. Your component adds a `focus`, `keep` or `caret` with `useDrawn(() => ({ focus }))`, and the editor calls that function each time it needs one, so a ref's element is there by then |
| `Block` | A block as your code reads it: its `type`, `data`, `text`, `body` and `children`, `from` and `to` (its bytes in the document, read when you ask, so a box writes itself with `edit().replace({ from: block.from, to: block.to }, text)`; both -1 once it's gone), and `is(type)` to narrow its data |
| `EditorPlugin` | The unit's shape; the `plugins` prop and the main entry's `installPlugins` take these |
| The `plugins` prop | A `setup` plugin installs once per process and a plugin value is read by each editor on its own, but either way an editor runs the hooks, kinds, commands and paste transforms of exactly the plugins it lists (no prop at all runs every installed one). The host's `use` changes the list later |
| `EditorPluginEntry` | One `plugins` prop entry: a bare unit, or `{ plugin, options }` to vary options per editor. A field you pass replaces the plugin's default for it (arrays too); the rest keep theirs |
| `PluginSetupContext` | What `setup(ctx)` receives; its `onEditor(cb)` registers a per-editor callback (call it from `setup`, synchronously) |
| `OnEditorCallback` | The callback itself: receives the `EditorContext` of each mounted editor that listed your plugin, may return a cleanup function the editor runs at unmount |
| [`EditorContext`](#editorcontext) | One editor's view for your plugin, handed to your `onEditor` callback |
| `InsertMarkdownOptions` | `insertMarkdown`'s second argument: `placement: 'below'` puts the text into a new paragraph after the top-level block holding the caret, in one undo entry; the default inserts at the caret |
| [`Draft`, `DraftResult`](#draft-draftresult) | A write in the document's bytes from `edit()`, and what its commit came to |
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
- `edit()`, a write in the document's bytes that commits as one undo step, now or after a wait ([`Draft`](#draft-draftresult)).
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

#### `Draft`, `DraftResult`

```ts
interface Draft {
	readonly stale: boolean;
	replace(range: { from: number; to: number }, text: string): this;
	insert(markdown: string): this;
	data<D>(block: Block<D>, data: D): this;
	commit(options?: { caret?: number }): Promise<DraftResult>;
	end(): void;
}

type DraftResult =
	| { ok: true }
	| { ok: false; reason: 'moved' | 'unloaded' | 'off' | 'reading' | 'overlap' | 'illegal' | 'empty'; message: string };
```

The way your plugin writes bytes, from `edit()` on the `Editor` your `setup` gets or on an `EditorContext` (a host gets the same from `EditorInstance.edit()`). Positions are byte offsets into the document's text as it stood when you called `edit()`, so you can measure a range, go fetch something, and write when it comes back:

```ts
const draft = editor.edit();
const card = await fetchCard(query); // the author keeps typing meanwhile
const result = await draft.replace({ from, to }, card).commit();
if (!result.ok) console.warn(result.reason, result.message); // 'moved': they typed inside it
```

- `replace(range, text)` swaps bytes `from` to `to` for `text`. Chain as many as you like; two far-apart ranges are still one undo step. These are the document's bytes, markers and all, so a new line you write inside a container carries the container's marker (`> `, a list item's indent) in `text`. Write an opener on a line of its own (a `$$`, a fence, a `:::note`) above a block that would close it, and the editor adds its closing line under it, same as it does for one the author types.
- `insert(markdown)` pastes Markdown at the caret once the replacements land, the way `insertMarkdown` does.
- `data(block, data)` sets the data of a block your `draw` was handed, rewriting only the bytes that carry it: a line block's line through its `write`, a container's head or first line. Inside a quote the `> ` stays. It's refused as `moved` if the block changed since you read it (checked at commit, so `stale` doesn't watch it), and a block with no data, or one you haven't narrowed with `is`, won't compile here.
- `commit({ caret })` writes it all as one undo step, with the caret at byte `caret` of the text as you wrote it (a closing line the editor added above it pushes it down for you). Leave `caret` out and the author's caret stays where it is, since a write landing while they type shouldn't drag them anywhere.
- `stale` turns true once a write elsewhere touches one of your ranges, or the host loads another document. It's reactive, so a Svelte effect reading it reruns.
- `end()` drops the draft without writing. One you just let go of is dropped eventually too, but ending it stops the editor tracking writes for it right away.

What a commit can come back with (nothing throws, and a refused commit writes nothing):

| `reason` | When |
| --- | --- |
| `moved` | Something wrote inside one of your ranges since `edit()`. Text written right before or after a range doesn't count, it just moves the range, except inside a quote or a list, where the same letter typed right next to a range counts as inside |
| `unloaded` | The host loaded another document |
| `off` | The host turned your plugin off in this editor (`use`). Turning other plugins on or off doesn't count, your ranges just follow the bytes |
| `reading` | The editor's in reading mode |
| `overlap` | Two of your own ranges overlap |
| `illegal` | A range runs past the document's end or splits a `\r\n`, or the insert had no caret to land at |
| `empty` | Nothing to write: no ranges, only the bytes already there, or the draft was ended |
| `closed` | The menu the row was picked from closed before the write (a selection action's row) |

### Kind declaration

Every kind starts here. No other call accepts a bare string where a kind goes.

| Export | Role |
| --- | --- |
| `declarePluginKind` | Create a block kind from a name and get the kind back; a collision with a built-in or a prior kind throws, and so do the reserved names `document` and `global` and a name that isn't a lowercase letter followed by letters, digits and hyphens |
| `declaredPluginKind` | Recover an already-declared kind in another module, no cast; throws for a name nobody declared |
| `PluginBlockKind`, `AnyBlockKind` | The plugin-declared kind type, and the union of built-in and plugin kinds a node can carry |

### The block-kind descriptor

The **descriptor** is a kind's written behavior: how it merges, whether it's editable, its container shape.

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

#### `BlockKindRegistration`

```ts
function registerBlockKind(kind: AnyBlockKind, registration: BlockKindRegistration): void;
```

What `registerBlockKind` accepts: the descriptor's fields, plus the `view` that draws the kind and, for a kind a line starts, its `opener`. The quickstart's parrot registration is a whole one ([The first fifteen minutes](plugin-guide.md#the-first-fifteen-minutes)). The optional fields worth knowing by name:

- `label`, what a screen reader and the block menu call the block.
- `pageRole`, whether it reads as prose (no drag handle) or as an object.
- `estimateHeight(node, env)`, its height guess before it's measured (`env` is a `HeightEstimateEnv`).
- `dragLabel`, what the drag ghost calls it.
- `textPosition: 'while-source-shows'`, for a block your own component draws as a picture of its source until a click opens the text. Cut, copy and paste only reach the text while it's open. A block type drawn with `edit: 'source'` already says this, so it doesn't need the field.

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
| [`ContainerSurface`](#containersurface) | A container's `ctx.container`: where the child blocks mount, plus the container helpers |
| [`BlockViewHandle`](#blockviewhandle) | What `mount` returns |
| `CommandHooksSurface` | `setCommandHooks(hooks)`, on the container surface: what a block command running on this block gets as `ctx.hooks` (open your own editor, say). The last value set wins ([commands](plugin-guide/commands.md)) |
| `AmbientPrefix`, `AmbientInteractiveRange` | What `ambientPrefix` returns: the marker's text, or `{ text, interactive }` with ranges of it clickable, each with its class, click handler, role and an optional tab stop ([the container walkthrough](plugin-guide/container-walkthrough.md)) |
| [`HandBuiltSurface`, `HandBuiltBlock`](#handbuiltsurface-handbuiltblock) | A `'none'` view's `ctx.block`, and what you publish through it |
| `svelteBlockView` | _(from `/svelte`)_ Make a view from your Svelte component, plus an optional per-node extra-props hook; a component that forgot to publish its surface fails the typecheck here |
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
| `'container'` | The child blocks | `ctx.container.mountChildren(box)`, with the box they mount in |

`registerBlockKind` refuses a surface that doesn't fit the kind: a container kind takes `'container'`, anything else `'none'`. A block with text the editor edits is a block type with a `draw` instead ([The editable leaf](plugin-guide/editable-content.md#the-editable-leaf)).

```ts
const stampView = defineBlockView({
	surface: 'none',
	mount(target) {
		target.className = 'stamp';
		target.textContent = 'APPROVED';
		return {}; // it publishes nothing, so arrows pass over it
	}
});
```

#### `BlockViewSpec`

```ts
type BlockViewSpec = HandBuiltViewSpec | ContainerViewSpec;
```

What `defineBlockView` takes, one shape per surface (`BlockSurface` is the surface's name). Every shape has these:

- `surface`, the surface.
- `mount(target, ctx)`, which fills `target`. Add your classes and children to it, but don't wrap a second box inside, since the editor measures `target` as the block.
- `watchDocument: true` (optional) gets you an `update` for every change to the document, not only to your block (a table of contents wants that).

The surfaces add their own:

- `HandBuiltViewSpec`, the `'none'` surface's, takes nothing more.
- `ContainerViewSpec` takes `ambientPrefix(state, editor)`, the read-only marker drawn before its first child's text (a footnote definition's `[^label]: `), read live.

#### `BlockViewContext`

```ts
interface BlockViewContext {
	state(): BlockViewState;
	readonly editor: EditorContext;
}
```

What `mount` gets, one shape per surface: `HandBuiltViewContext` and `ContainerViewContext`. Each has:

- `state()`, which reads a `BlockViewState` when you call it: the node, its path, the presentation mode and the theme name.
- `editor`, your plugin's `EditorContext` in the editor drawing the block. It's always there, since a view only mounts inside an editor.
- Plus `block` or `container` on those surfaces.

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

#### `BlockViewHandle`

```ts
interface BlockViewHandle {
	update?(state: BlockViewState): boolean | void;
	destroy?(): void | Promise<void>;
}
```

What `mount` returns.

- `update(state)` runs when the block's bytes, path, mode or theme change. Inside a container that's every keystroke in a child, so keep it cheap. Return `false` and the view is destroyed and mounted again from scratch.
- `destroy()` runs when the block leaves the screen.

A throw in `mount` or `update` shows the block's source with a notice, like a broken Svelte block. One in `destroy`, or a rejection of a promise `destroy` returns, is reported on the `error` event.

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

#### `reactBlock`, `vueBlock`, `svelteBlock`, `useDrawn`

_(`svelteBlock` and its `useDrawn` from `/svelte`; the others from `@voithos-labs/aragonite-react` and `-vue`)_

```ts
function reactBlock(Component, options?: { className?; wrap? }): (block, ctx) => Drawn;
function vueBlock(component, options?: { className?; app? }): (block, ctx) => Drawn;
function svelteBlock(Component): (block, ctx) => Drawn;
function useDrawn(parts: () => { focus?; keep?; caret? }): void;
```

Make a block type's `draw` from a component, which gets `block`, `ctx` and `Slot` as props (`BlockProps`, `SvelteBlockProps`). `<Slot of="source" />` (or `"children"`, `"title"`) places the editor's element. `className` lands on the block's element; React's `wrap` and Vue's `app` hand your providers in.

`useDrawn`, called in the component (a hook in React, in `setup` in Vue, at init in Svelte), adds what a plain `draw` hands back beside its `dom`: `caret`, `focus` and `keep`. The editor calls the function each time it needs one, so a ref's element is there by then.

```tsx
const draw = reactBlock(Dice, { className: 'dice' });

function Dice({ ctx }: BlockProps<never, BoxDrawContext>) {
	const button = useRef<HTMLButtonElement | null>(null);
	useDrawn(() => ({
		focus: {
			enter: () => button.current?.focus(),
			offset: () => (document.activeElement === button.current ? 0 : null)
		}
	}));
	return <button ref={button}>roll</button>;
}
```

A block for each shape, the die whole: [React and Vue blocks](plugin-guide/react-and-vue.md).

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
- `closer(raw)` gives the line that closes it (`null` where no line does). An opener written on a line of its own above such a line gets it at once, whether it was typed, pasted, dropped, moved there or written by a `Draft`.
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
| [`COLON_LINES`](#colon_lines) | A `:::` container's lines, for your kind's `container.lines`: the editor writes its bytes from them |
| `withDirectiveName` | Rename a `:::` container by rewriting its opener line, for a command that switches variants through `replaceRaw` |
| `DIRECTIVE_BODY_WRAP` | The wrap every `:::` body parses with, for a parser of your own (a kind with `lines: COLON_LINES` gets it without asking) |
| `DIRECTIVE_OPENER_LINE` | The kind of every `:::` container's first row, its opener line; a `:::` kind that folds names it as `reservedChrome.kind` |
| `DirectiveDefinition`, `ParsedDirective` | The registration's shape, and the parsed fence your factory receives: the fence parts, the parsed body, the exact consumed bytes |
| `DirectiveTier`, `DirectiveFence`, `DirectiveAttributes` | The three tiers (container, leaf, text), one parsed opener line, and what the attribute reader returns |

#### `COLON_LINES`

The lines of a `:::` container, as your kind's `container.lines`. The editor writes the opener line (child 0) back as typed, then the body, then a closing line as long as the one it replaces, widening every colon run past a body line that would close it. The grammar builds that child 0 for every `:::` container (kind `directiveOpenerLine`), so your factory returns only the body.

```ts
container: { lines: COLON_LINES }
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
| [`LineShape`, `MarkedLines`, `IndentedLines`](#lineshape-markedlines-indentedlines) | How your container's lines look, as data on `container.lines`. The editor writes the bytes from it, so there's no `rebuildRaw` to write |
| `fencedLines`, `FencedLines` | Lines of your own around the body, like `<details>` and `</details>`: `fencedLines({ open, close })` writes the opening lines from your metadata and the title row (child 0), and the closing line after the body |
| `ColonLines` | The type of `COLON_LINES` |
| `QUOTE_LINES` | The built-in quote's lines, to build yours on (an alert is a quote with a head line) |
| `headedLines`, `HeadedLines` | Marked lines under a head line that holds no child, like an alert's `> [!NOTE]`. `headedLines({ ...QUOTE_LINES, head })` makes one |
| `stripShapedLines` | Your opener's lines read the way the editor writes them, so the two can't disagree. A `container` doesn't need it, since the editor reads its lines itself |
| `StripRebuild` | What a `rebuildRaw` may return: `rereads` says a kept line stopped continuing a paragraph, so the bytes have to be read whole |

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

A block holding an edit outside the document (a textarea's text) opens a [`Draft`](#draft-draftresult) of its own bytes with the container factory's `openDraft(spec)`. It goes `stale` once a write elsewhere touches the block, and the editor calls `close(cause)` on one you haven't ended: `'mode-change'` and `'undo'` (an undo or redo about to replace the document) may still save, `'document-swap'` (another document, or the host switching plugins) writes nothing. `end()` it once your box closes or your block unmounts. [What your own editing surface has to do](plugin-guide/render-primary.md#what-your-own-editing-surface-has-to-do) walks through it.

#### `LineShape`, `MarkedLines`, `IndentedLines`

```ts
container: { lines: LineShape<YourMetadata> }
```

Say how your container's lines look and the editor writes them for you. It keeps every line an edit didn't touch the way the author spelled it, and writes new lines your way. A container with `lines` declares no `contract`, `rebuildRaw` or `bodyWrap`, since the shape already says them.

- `marked`: a marker on every line, like a quote's `>`. `first` and `rest` are what it writes; `reads` is how a marker reads back, and it has to read `first` and `rest` whole (a dev build throws where the kind registers if it doesn't). `lazy` says a line without the marker can still continue a paragraph. A `head` is a first line that holds no child (an alert's `> [!NOTE]`), and you give the shape one with `headedLines({ ...lines, head })`: `match` reads it after the marker, `data` turns the match into your metadata, and `write` spells it, for a new head or one whose data changed (an untouched one keeps the author's spelling). A blank line gets `first` or `rest` without its last space, except in a body emptied of all its text, whose lines keep their markers as spelled.
- `indented`: a marker on the first line and an indent after, like a footnote. `open` reads the marker, `data` turns the match into your metadata, `first(data)` writes the marker back, and `rest(data)` is the indent. It's spaces only, and its width is the column the body starts at (a tab counts to the next multiple of four, same as the parser).

The editor writes with your kind's metadata, so store what `data` returns as the metadata. The bundled footnote definition, whole:

```ts
const DEFINITION_LINES: IndentedLines<{ label: string }> = {
	shape: 'indented',
	open: /^ {0,3}\[\^([^\]]+)\]: ?/,
	data: (match) => ({ label: match[1] }),
	first: (data) => `[^${data.label}]: `,
	rest: () => '    ',
	lazy: true
};
// in the opener: setPluginMetadata(node, { label }), and the body read with
// stripShapedLines(DEFINITION_LINES, { label }, lines)
registerBlockKind(kind, { ..., container: { lines: DEFINITION_LINES } });
```

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
| [`command`](#command) | Make a command your plugin lists in `contributes`. An editor runs it by value, as `yourplugin/id`, or by its chord |
| `Command` | What `command` hands back. Its `id` reads `yourplugin/id` once an editor installs your plugin |
| `CommandSpec` | What `command` takes: `id`, `title`, an optional `chord`, `when(editor, arg)` and `run(editor, arg)`, both handed your plugin's own `Editor` |
| `Chord` | A chord as a type: `Mod`, `Alt` and `Shift` in any combination, then the key. Only a command that can run without its argument takes one, since a key can't hand it anything |
| [`registerBlockCommand`](#registerblockcommand) | Create a `(kind, name)` command and get back its id, for a keymap binding to target |
| `CommandId` | A built-in command's id; a vocabulary your keymaps may bind too. `decorations.activateAtCaret` ships with no chord at all: it runs the `onActivate` of the mark under the caret ([Interactive marks](plugin-guide/decorations.md#interactive-marks-click-hover-and-the-keyboard)) |
| `KeyBinding` | One keymap entry: a chord (`Mod` / `Alt` / `Shift` plus the key, normalized to that order), a command id, an optional baked argument. A chord with an unknown modifier or no key throws when the kind registers or is augmented |
| [`CommandRun`](#commandrun) | The third argument a block's `runCommand` gets: `afterRemoval` |
| [`BlockCommandContext`, `BlockCommandHandler`](#blockcommandcontext-blockcommandhandler) | What a block command's handler receives, and the handler's signature |
| `BlockCommandTarget` | What a block hands a block command to run against (the node, `updateMetadata`, `replaceRaw`, the component's hooks), and what `BlockComponent.getCommandContext` returns, so a hand-built component can let the editor run your `afterRemoval` commands in it |
| `BlockCommandOptions` | That fourth argument's type |
| `PluginCommandId`, `AnyCommandId` | The id `registerBlockCommand` hands back, and the union of that and a built-in `CommandId` |
| [`imeOwnsKey`](#imeownskey) | Whether a keydown belongs to the IME |

#### `command`

```ts
function command<A = void>(spec: CommandSpec<A>): Command<A>;
```

A command your plugin lists in `contributes`. The editor puts your plugin's name in front of the id, so `id: 'hello'` in a plugin named `shout` runs as `shout/hello`.

```ts
const shout = definePlugin({
	name: 'shout',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		commands: [
			command({ id: 'hello', title: 'Say hello', chord: 'Mod+Alt+H', run: () => console.log('hello') })
		]
	})
});

handle.run('shout/hello'); // true, and "hello" in the console
handle.can('shout/hello'); // true; false in reading mode, or where `when` says no
```

`run` comes back `false` when the command didn't run here (its plugin isn't on, the editor's reading, `when` said no) or your `run` returned `false` (that doesn't hand your chord's key back to the browser, though). A throw counts as run, and it reaches `onError` as `run shout/hello`, the same as a rejected promise.

A chord goes to the first of three owners. One the editor takes everywhere (search's `Mod+F` and `Mod+H`, undo and redo) leaves your plugin out at install. Then the host's `keybindings` beat yours. Then, between two plugins in one editor, the one listed first keeps it and the later one's left out. The editor tells `onError` about each plugin it leaves out.

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

_(pre-freeze / unstable)_ A list the editor opens under the caret while the author types after a trigger: `#` for a tag, `[[` for a link to another document. A plugin value lists one in `contributes` as `menus` (`menu`, below). The editor owns the session: it notices the typed trigger, holds the arrow keys, Enter, Tab and Escape while a list is up, anchors the list to the typed range, and writes the pick over the trigger and the query as one undo entry. The caret never leaves the document. The recipe: [Recipe: a typed-trigger menu](consumer-guide/recipes.md#recipe-a-typed-trigger-menu).

A menu whose rows read the document (every tag in the note, say) can't be a plugin value's yet, since a value has no document read; until it has one, that menu is an inline-menu source on a `setup` plugin's `editor.inlineMenus` (or a host's `getInlineMenus()`), the `InlineMenu*` rows below.

| Export | Role |
| --- | --- |
| [`menu`](#menu) | Make a list your plugin lists in `contributes` as `menus`: it opens when its trigger is typed, and a pick writes nothing until you commit it through the `MenuPick` |
| `CaretMenu` | What `menu` takes: a `label` for screen readers, the `trigger`, `where` it opens (after a space or at a line's start by default, only at a line's start, or anywhere), `accepts(query, { editor })` to close the list on a query that's no longer yours, `rows(query, { editor })`, an optional `view` that draws a row, and `pick(row, pick)` |
| `MenuRow` | The row the editor draws when your menu has no `view`: a `label`, maybe a `detail` and an `icon`, and an `id` that keeps a screen reader on the same row as the query narrows the list (the label does that job without one) |
| `MenuRowProps` | What a menu's `view` gets, at mount and on each `update`: your `row`, whether it's `active`, and the `query` (for highlighting the match) |
| `MenuPick` | A `Draft` over the trigger and the query, with the `trigger`, the `query` and their `range`, plus `write(inline)`, `insertBlock(markdown)` and `run(command, arg?)` |
| [`InlineMenuRegistry`](#inlinemenuregistry) | The `editor.inlineMenus` surface |
| [`InlineMenuSource`](#inlinemenusource) | A named source: its trigger, its list, and what happens around a pick |
| `InlineMenuOpenOptions` | `open`'s second argument: a `query` typed after the trigger, so the list opens already narrowed |
| `InlineMenuSourceHandle` | The handle back: `dispose()` removes the source and closes its list |
| [`InlineMenuItem`](#inlinemenuitem) | One row of the list |
| `InlineMenuQuery` | What `items` is asked: the `query` typed so far, the leaf's `path`, the raw range `[start, end)` a pick would replace, and a `signal` aborted once a later keystroke supersedes the read |
| `InlineMenuRowProps` | What a `row` view receives, at mount and on each `update`: the `item`, whether it is `active`, and the `query` (for highlighting the match) |

#### `menu`

```ts
function menu<R>(spec: CaretMenu<R>): CaretMenu<R>;
```

A list under the caret. Picking a row hands it to your `pick` with a `MenuPick`, and nothing is written until you write through it: `write(inline)` swaps the trigger and the query for one line of text, `insertBlock(markdown)` takes them out and drops a block in (below the line, when the line has other text), and `run(command, arg)` takes them out and runs a command at the caret, in the same undo step. A shortcut or a toolbar button opens your menu with `editor.openMenu(menu, query?)`, which types the trigger for the author.

```ts
const mentions = definePlugin({
	name: 'mentions',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		menus: [
			menu<MenuRow>({
				label: 'People',
				trigger: '@',
				rows: (query) => people.filter((p) => p.label.startsWith(query)),
				pick: (row, pick) => void pick.write(`@${row.label}`)
			})
		]
	})
});
// type "@ad", Enter: "@ad" becomes "@Ada", one undo step
```

A pick can wait (a fetch, a dialog). Whatever you write then lands as its own undo step, after the typing that came before it, or comes back refused: `moved` when the author changed the trigger or the query meanwhile, `unloaded` when the host loaded another document. It lands where the query was, wherever the author's caret has wandered off to.

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
	row?: PluginView<InlineMenuRowProps>;
}
```

A named source. The required half:

- its `trigger`, one line, never empty;
- `items(query)`, which returns the list or a promise of it.

And optionally:

- `opensAt`, to decline a trigger by position;
- `accepts`, to end the session on a query that is no longer yours;
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
- `insert`, the bytes that replace the trigger and the query. It's one line of inline bytes, empty allowed. A line break is refused and reported; a pick that writes a block, or writes later, is a caret menu's (`menu`).

### Selection actions

_(pre-freeze / unstable)_ Rows your plugin offers over a range: what the author selected, or a range you capture around the caret (the misspelled word under it, say). List them in `contributes` as `actions`. They show in the right-click menu, as one row in the selection toolbar where your capture is exactly the selection (its rows open beside it), and wherever you call `editor.openRows`. The editor asks for your rows only when one of those opens, never as the toolbar redraws.

| Export | Role |
| --- | --- |
| `SelectionAction` | One action: a `label`, an `icon`, `lead` to sit first in the right-click menu with a divider after, an optional `capture(editor, selection)` returning the range to act on (or null), and `rows(captured)`, an array or a promise of one |
| `ActionRow` | One row: a `label`, an `icon`, `disabled`, and `run(draft)` |
| `Captured` | What `rows` is asked about: the range's `text` (its bytes), the `range` in document bytes, the `box` it paints in, measured when you read it (null when it isn't drawn, or runs from one text block into the next), and whether it's `editable` |
| `Icon` | A menu glyph's name, or `{ svg }`, your own markup, drawn as given at the menu's icon size |

```ts
const shout: SelectionAction = {
	label: 'Shout',
	rows: (captured) => [
		{
			label: 'Upper case',
			run: (draft) => draft.replace(captured.range, captured.text.toUpperCase()).commit()
		}
	]
};
// select "def" in "abc def ghi", right-click, Upper case: "abc DEF ghi", one undo step
```

Without `capture`, an action acts on the selection and offers nothing at a bare caret. A promise from `rows` shows one pending row until it settles, and a rejection drops your rows and reaches `onError`. `run` gets a draft opened when the row is picked. If it returns a promise the row stays pending and the menu stays open until it settles; close the menu first and the draft's commit comes back refused as `closed`.

`editor.openRows(action, range, anchor)` opens the same rows over `range` (captured the way your action says) at `anchor`, a rect or a point, taking no focus: what a hover card over a mark calls. It hands back `{ isOpen, close() }`, and any edit, Escape or a press elsewhere closes it.

### Insert catalogue

_(pre-freeze / unstable)_ The blocks the insert menus offer: the built-in lists, quote, divider, code block and table, then the rows plugins add. Read it as `editor.inserts`; a `setup` plugin's `onEditor` context and the host's handle read the same list (`insertCatalogue` and `inserts`).

| Export | Role |
| --- | --- |
| `InsertRow` | One row: an `id`, a `label`, an `icon`, optional `keywords` a filter should also match, and `insert`, the Markdown, or a function of the word typed after the row (`/table 3x4`, empty when there's none) giving the Markdown and the dim text saying how it read the word. List yours in `contributes` as `inserts`, and an editor shows each as `yourplugin/id`, only where your plugin is on. An icon the menu can't draw, or an id twice, leaves your plugin out |
| `registerInsertEntry` | A `setup` plugin's way to add its block, called from `setup`. It is listed only in the editors that activate your plugin. Throws on a duplicate id and on an icon the menu cannot draw |
| `InsertEntry` | What `registerInsertEntry` takes: an `id`, a `label`, an `icon`, `keywords`, its `markdown`, and an optional `withArgument` giving the Markdown and dim text for a typed word |
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
| `trailingLineEnding` | The ending a line rebuilt from a block's bytes takes: the block's own, else the fallback you pass (a write rule's, or `documentLineEnding` of a document you hold) |
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
