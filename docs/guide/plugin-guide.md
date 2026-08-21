# Plugin Author Guide

Everything you need to extend the editor with your own block or inline content. The whole authoring surface lives on one import path — the `@voithos-labs/aragonite/plugin` subpath — separate from the `@voithos-labs/aragonite` embedding barrel a consumer uses.

Start here. The `:::name` directive grammar has its own [directives guide](directives.md); embedding, theming, and events are the [consumer guide](consumer-guide.md)'s subject. Every export named in this guide is cataloged in the [API reference](#api-reference) at the bottom.

## What a plugin is

A plugin teaches the editor a new **kind** — a first-class citizen of the document tree that parses, renders, and serializes alongside the built-ins. You wire up to four things:

```
declare a kind ──┬─▶ descriptor   how it merges, its container/chrome shape, its keymap
                 ├─▶ component    how it renders and hosts any editable content
                 └─▶ grammar      how source becomes the kind:
                                    a block opener  │  a :::name directive  │  an inline recognizer
```

Only the kind and its descriptor are always required. A component makes it visible; grammar makes it parseable from Markdown. A kind with no component renders a visible raw fallback; a kind with no descriptor is an error at first use.

**Registration is process-global and register-once.** A kind is a definition every editor on the page shares — the `customElements` model, where `customElements.define` defines an element for every document. Registering the same kind, component, or opener twice is a **conflict that throws**, not a silent override, so a plugin colliding with a built-in or another plugin fails loudly. There is no unregister and no runtime replace. (Under a dev server, re-evaluating a registration module replaces its prior registrations in place, so a changed definition takes effect on re-run; editing a plugin unit's own `definePlugin` still needs a page reload. That replace covers **every** register-once seam, the paste-transform registry included, while production and a test run keep the throw — so the throw is what your suite observes.)

Registrations get packaged into a **plugin unit** whose `setup` runs at most once per process — so you write each `register*` call straight, and the unit, not a per-call guard, owns idempotence. A registrar that runs at **module scope** instead has no such owner, and guards each call on a probe: `isBlockKindDeclared`, `isBlockKindRegistered`, `isBlockComponentRegistered`, `isBlockOpenerRegistered`, `isBlockCompleterRegistered`, `isPasteTransformRegistered`, `isDirectiveRegistered`, and `isInlineKindDeclared` for the inline tier. Guard on the probe, never on a module-level `registered` flag — a flag survives `resetPluginPlatformForTests()` and silently skips the re-registration your next test case needs.

### The plugin unit

`definePlugin({ name, setup })` validates a unit at definition time and returns an `EditorPlugin`; its `setup` runs your `register*` calls. By convention a plugin is a **factory export** — `export function myPlugin(deps?)` returns the unit — so a **process-global dependency** the plugin needs (a render engine, say — the same for every editor) rides the factory's argument. Per-_instance_ configuration takes a different path ([Per-instance context](#per-instance-context)); the factory argument is for what never varies between editors.

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
	// same-name/different-identity unit trips a harmless first-wins dev-warn.
	const plugins = [myPlugin()];
</script>

<Editor {source} {plugins} />
```

**A plugin installs once per process, keyed by name.** Passing the same unit again no-ops. Passing a _different_ unit under a name already installed keeps the first and dev-warns (naming the loser as `name@version` when it carries one). Units install in array order, and a `setup` that throws stays failed — a later attempt rethrows and advises a reload, because a partial setup cannot re-run against the register-once registries.

Definitions are process-global — two editors passing the same plugin share one registration — but per-instance _configuration_ is not: an editor may pass `{ plugin, options }` and the plugin reads its own `options` off each instance's context ([Per-instance context](#per-instance-context)). Reserve the factory argument for a process-global dependency; route anything two editors would vary through the prop's options.

For an editor-less `parse()` pipeline that needs the grammar live without mounting `<Editor>`, call `installPlugins(units)` from the `@voithos-labs/aragonite` barrel — same once-per-process semantics. `isPluginInstalled(name)` probes an install, for the rare setup that must branch on it; the prop and `installPlugins` are already idempotent, so most consumers never reach for it.

### What is stable, what is not

- **Registration base — stable.** Kind declaration, descriptor/component/opener registration, typed per-node metadata, and the idempotence probes. These shapes will not change in a breaking way. (One exception landed pre-freeze: an opener's return became a line count in 0.9.36, see [What an opener returns](#what-an-opener-returns).)
- **Pre-freeze / unstable.** Everything else, and the [API reference](#api-reference) below carries the list rather than this sentence: **a section labelled _(pre-freeze / unstable)_ may still change shape until the freeze.** Those labels mirror the section headers of the `@voithos-labs/aragonite/plugin` entry point (`src/lib/plugin.ts` in the repository), so the two cannot drift apart. The big families are the plugin unit itself, the authoring tiers (container, editable leaf, inline, directive), the grammar hooks, paste transforms, and the view surfaces (decorations, rects, selection geometry). Each is being refined against real consumers and freezes at the public release.

## Per-instance context

`setup` runs once per process, but a plugin often needs to react to _each editor_ — recompute derived state on every edit, hold per-document data, read the options a given editor passed. `ctx.onEditor(cb)` is that seam: it registers a callback fired once per mounted `<Editor>`, handed that instance's **`EditorContext`**.

| Field              | What it gives you                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `editorId`         | A stable per-mount id — key your own `Map` / `WeakMap` on it for per-editor state                             |
| `document`         | A live getter for the root document — a `DocumentView`, read-only by type ([views](#views))                   |
| `events`           | The subscribe-only event view — `events.on('edit', …)` returns a disposer                                     |
| `options`          | The options this editor passed, typed when you write `definePlugin<Options>` (see below)                      |
| `decorations`      | This editor's decoration registry — register a source ([Decorations](#decorations))                           |
| `rects`            | This editor's viewport-space geometry — block box, range rects, caret, reveal, navigation                     |
| `presentationMode` | The effective mode, live, with the `presentationModeChange` event ([Presentation modes](#presentation-modes)) |
| `theme`            | The editor's theme name, live, with the `themeChange` event — for content whose colors an engine paints       |

Return a disposer from the callback and the editor runs it at unmount. Registration is **synchronous-only** — call `onEditor` from `setup`, not from a later callback.

### Recipe: per-instance derived state

There is no plugin-state field, and none is needed: keep your own map keyed on `editorId`, seed it when the editor mounts, recompute on the `edit` event, and delete the entry in the disposer.

```ts
import { definePlugin, type EditorContext } from '@voithos-labs/aragonite/plugin';

interface WordCountOptions {
	live: boolean; // recount on every edit, or only at mount
}

// Per-editor state lives in a plugin-owned map — not a platform field.
const countByEditor = new Map<string, number>();

function recount(editor: EditorContext<WordCountOptions>): void {
	const words = editor.document.children.reduce(
		(n, block) => n + block.raw.split(/\s+/).filter(Boolean).length,
		0
	);
	countByEditor.set(editor.editorId, words);
}

export const wordCountPlugin = definePlugin<WordCountOptions>({
	name: 'word-count',
	setup(ctx) {
		ctx.onEditor((editor) => {
			// A bare-unit install passes no options, so default them.
			const { live } = editor.options ?? { live: true };
			recount(editor); // seed on mount
			const off = live ? editor.events.on('edit', () => recount(editor)) : () => {};
			return () => {
				off();
				countByEditor.delete(editor.editorId); // per-editor cleanup
			};
		});
	}
});
```

### Recipe: per-instance options (and the factory-closure anti-pattern)

Two editors share one process-global registration but may still run different options — the split-pane case. A consumer varies them per editor through the `plugins` prop's entry form:

```svelte
<Editor source={left} plugins={[{ plugin: wordCountPlugin, options: { live: true } }]} />
<Editor source={right} plugins={[{ plugin: wordCountPlugin, options: { live: false } }]} />
```

`definePlugin<WordCountOptions>` carries the type through, so `editor.options` reads typed inside `onEditor` with no cast.

**The anti-pattern.** Do not hold per-instance config in the plugin factory's closure — `wordCountPlugin({ live: false })` looks like it configures the instance, but a plugin installs **once per process**, so only the first editor's factory value ever takes effect and the second is silently ignored. The discriminator: _would two editors ever want different values?_ If yes, it is per-instance — pass it through the prop entry and read `editor.options`. If no (a render engine, a shared parser), the factory argument is correct.

## Views

Every surface that hands a plugin a node to **read** types it as a view — `NodeView` for a block node, `DocumentView` for the root. A view is deep-readonly on the serialized bytes (`raw`, `kind`, `metadata`, trivia, children structure), so "never mutate the tree from the view layer" is compiler-enforced: a byte write through a view is a compile error, not a dev-mode warning. Views arrive on `BlockComponentProps.node` / `document`, `EditorContext.document`, a `DecorationSource`'s `provide(document, …)`, the descriptor read hooks (`getContentRange`, `estimateHeight`, `reservedChrome.isCollapsed`, `reservedChrome.expandPatch`), and the command contexts.

`CstNode` and `Document` stay the shapes a plugin **constructs and owns**: an opener or directive factory builds a `CstNode`, and `rebuildRaw` receives one to write — the ceremony hands it an owned node, which is exactly when byte writes are legal. A document you parsed yourself is mutable and feeds every view-typed parameter with no conversion.

Mutating the **live** tree goes through the sanctioned commit paths — `updateOwnMetadata`, block commands, `rebuildRaw` — never through a view. Do not cast a view back to `CstNode`: the readonly type is the editor's snapshot-aliasing invariant stated at the surface, and the cast reopens the corruption class it closed.

## Walkthrough: a directive container end-to-end

We build a `:::note` container — a titled, editable box whose title is a real editable line and whose body holds ordinary Markdown blocks. Every import is from the package, so this runs unchanged in a fresh SvelteKit app that installs the editor.

It reuses the `:::name` grammar rather than a hand-written opener. The grammar's tiers, dispatch, and losslessness are the [directives guide](directives.md)'s subject; here we own the descriptor and component side.

### The registration module

One file declares the kinds, describes them, maps the directive name, binds the component, and returns the whole thing as a `notePlugin()` unit.

```ts
// note-kind.ts
import {
	activateDirectives,
	chromeChild,
	createDirectiveRebuild,
	declarePluginKind,
	declaredPluginKind,
	definePluginBlock,
	registerBlockKind,
	registerBlockCommand,
	registerChromeLeaf,
	registerDirective,
	setPluginMetadata,
	type CstNode,
	type EditorPlugin,
	type ParsedDirective
} from '@voithos-labs/aragonite/plugin';
import NoteBlock from './NoteBlock.svelte'; // the component built in the next section

const NOTE = 'note';
const NOTE_TITLE = 'note-title';

interface NoteMetadata {
	name: string; // the matched directive name; re-emitted into raw so an edit survives
	colonCount: number;
	closerColonCount: number;
	closerNewline: boolean;
	lineEnding: string; // captured at parse; createDirectiveRebuild re-emits it (CRLF-safe)
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
		children: [
			chromeChild(declaredPluginKind(NOTE_TITLE), title),
			...(parsed.body?.children ?? [])
		],
		innerSuffix: parsed.body?.suffix ?? ''
	};
	setPluginMetadata<NoteMetadata>(node, {
		name: parsed.fence.name,
		colonCount: parsed.fence.colonCount,
		closerColonCount: parsed.closerColonCount,
		closerNewline: parsed.closerNewline,
		lineEnding: parsed.lineEnding
	});
	return node;
}

// Re-emit raw from the children after any structural edit. createDirectiveRebuild owns
// the title→opener line, the body serialization, and — the byte a hand-written copy
// silently drops — the authored line ending; you supply only the variant-name resolver.
const rebuildNoteRaw = createDirectiveRebuild<NoteMetadata>((meta) => meta?.name ?? NOTE);

function registerNote(): void {
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
			// Declare `reorderChildren` here if your container's direct children should
			// reorder among themselves (drag, or Alt+ArrowUp/ArrowDown). Absent, a child's
			// reorder resolves at an ancestor instead, which moves the whole container
			// among its own siblings. The closure block does not ask about this axis, and
			// a behavioural test on your container passes either way.
		},
		keymap: [
			{ chord: 'Mod+7', command: setVariant, arg: 'note' },
			{ chord: 'Mod+8', command: setVariant, arg: 'tip' }
		],
		// Required: how this kind behaves under every cross-cutting editor system.
		// A container's roundTrip must name its rebuildRaw (not inherit-default), and
		// a not-mergeable kind's mergeBackspace must name its non-merge behavior — a
		// missing cell or column is a compile error. See "The closure block" below.
		closure: {
			roundTrip: { mode: 'implemented', via: 'container contract=opaque — rebuildNoteRaw' },
			focus: { mode: 'implemented', via: 'focus walks to the title chrome / first body child' },
			mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
			selectionPaint: { mode: 'implemented', via: 'body child blocks paint; container cover' },
			searchPaint: {
				mode: 'implemented',
				via: 'children are real blocks — search descends and paints'
			},
			reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
			undo: {
				mode: 'implemented',
				via: 'updateMetadata — the variant switch commits as one undo entry'
			},
			clipboard: { mode: 'inherit-default' },
			simOracle: { mode: 'implemented', via: 'plugin e2e under the [invariant:] watcher' }
		}
	});

	registerChromeLeaf(noteTitle, { blockClass: 'note-title' });
}

// definePluginBlock wraps definePlugin around the register step and the component
// binding, so you write neither the setup-then-register order nor the
// registerBlockComponent(declaredPluginKind(...), defineBlockComponent(...)) double-wrap.
export function notePlugin(): EditorPlugin {
	return definePluginBlock({
		name: 'note',
		kind: NOTE,
		component: NoteBlock,
		register: registerNote
	});
}
```

`registerDirective`'s `(tier, name)` mapping, the `ParsedDirective` shape, and the per-tier factory rules live in the [directives guide](directives.md). This module supplies the container factory (`fromDirective`, required for the container tier) and the descriptor.

### The closure block

`closure` is a required field on every registration: the kind's answer to each cross-cutting editor system, so a new kind cannot ship closed under a subsystem nobody asked about (the incident behind it is the 0.9.18 whole-block-focus tier). Each of the nine `ClosureColumn`s — `roundTrip`, `focus`, `mergeBackspace`, `selectionPaint`, `searchPaint`, `reorder`, `undo`, `clipboard`, `simOracle` — takes a `ClosureCell`:

- `{ mode: 'implemented', via }` — a real mechanism you can name (a `rebuildRaw`, a keymap command, `measurePartialRects`).
- `{ mode: 'inherit-default' }` — the generic editor ceremony, nothing kind-specific.
- `{ mode: 'not-supported', reason }` — the subsystem is structurally absent; name the degradation.

`Record<ClosureColumn, …>` makes a missing column a compile error and the required field makes a missing block one. Two coherence rules also hold at bootstrap: a container must declare `roundTrip: implemented` (its `rebuildRaw` is the mechanism), and a `not-mergeable` kind cannot declare `mergeBackspace: inherit-default` (it has no default merge to inherit). The full row-by-tier reference is the closure matrix in `docs/design/plugin-contract.md` (in the repository).

**Name a mechanism your own kind carries.** `implemented` needs a nameable `via` — your component, your `rebuildRaw`, your test — never an internal editor mechanism you do not own; a cell you cannot name honestly is `inherit-default` or `not-supported`, never an invented capability.

**Simple leaves: `simpleLeafClosure`.** A not-mergeable, childless, source-editable leaf built on `createEditableLeaf` answers five columns the same way every such leaf does — its round-trip inherits the default serialize, its `not-mergeable` merge is a focus move, its selection paints through `measurePartialRects`, it reorders by whole-block drag, and its clipboard is a byte slice. `simpleLeafClosure` bakes those five and asks only the four your component determines — `focus`, `searchPaint`, `undo`, `simOracle`:

```ts
closure: simpleLeafClosure({
	focus: { mode: 'implemented', via: 'createEditableLeaf render-primary reveal' },
	searchPaint: {
		mode: 'implemented',
		via: 'source raw scanned; the rendered view carries no measurable text, so a match is counted but not painted'
	},
	undo: { mode: 'implemented', via: 'render-primary — reveal→edit→blur commits one undo entry' },
	simOracle: { mode: 'implemented', via: 'my-kind e2e' }
});
```

Omitting one of the four is a compile error, and a baked column stays overridable (a render-primary leaf scoping its `selectionPaint` to the revealed state, say).

**`simOracle` is the cell most authors hesitate over**, because the simulation battery is a repo script rather than a published kit. It answers the same way every other column does, and the question is about your **mechanism**, not about who runs the tests. The example above is `implemented` because that kind has its own e2e driving it under the corruption oracles; a plugin that adds no kind-specific simulation machinery writes `inherit-default`, which is the honest answer for most plugins and what several bundled kinds declare. `inherit-default` claims no coverage — it says your kind meets the simulation exactly as the generic ceremony does. `not-supported` is for a subsystem that is structurally absent, which a caret-bearing kind's simulation never is.

**Strip containers: `containerClosure`.** A container of real child blocks under a rebuilt marker wrapper answers four columns the same structural way — its children are the paint and search surfaces, it reorders whole-block through the parent `BlockList`, and it holds no clipboard anchor of its own — and its `roundTrip` is always `implemented` (its `rebuildRaw` is the mechanism). `containerClosure` bakes those, asking for the `roundTripVia` string plus the four the container determines — `focus`, `mergeBackspace`, `undo`, `simOracle`:

```ts
closure: containerClosure({
	roundTripVia: 'container contract=opaque — rebuildNoteRaw',
	focus: { mode: 'implemented', via: 'focus walks to the title chrome / first body child' },
	mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
	undo: {
		mode: 'implemented',
		via: 'updateMetadata — the variant switch commits as one undo entry'
	},
	simOracle: { mode: 'implemented', via: 'plugin e2e under the [invariant:] watcher' }
});
```

A container that synthesizes on copy overrides the baked `clipboard` cell; one that adds an indent gesture overrides the baked `reorder` cell. Whole-block-focus opaque leaves and any novel tier still hand-write the full nine, where the 0.9.18 lesson applies.

Optionally add a `conformanceFixture` — a small markdown source that parses to your kind — for the conformance battery.

### The component

The component supplies only its own chrome; `createContainerBlock` hides the child-list state, ancestor wiring, and windowing. Pass `node`, `index`, and `path` as **thunks** — `getNode`/`getIndex`/`getPath`, each a live read re-evaluated per use. A captured value would snapshot stale state, and on this frozen surface the type no longer lets you pass one: a function-valued field is a live read, a plain-valued field is static config.

```svelte
<!-- NoteBlock.svelte -->
<script lang="ts">
	import { BlockList, createContainerBlock, type NodeView } from '@voithos-labs/aragonite/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();
	let boxEl: HTMLElement | undefined = $state();

	const { blockListProps, containerApi, handleKeydown } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl
	});

	export { containerApi };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="note-block" bind:this={boxEl} onkeydown={handleKeydown}>
	<BlockList {...blockListProps} />
</div>

<style>
	.note-block {
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 6px;
		padding: 8px 12px;
	}
	.note-block :global(.note-title) {
		font-weight: 600;
	}
</style>
```

Three rules for that file, each earned the hard way:

- **`export { containerApi }` is the whole publication.** That one instance export is your block's `BlockComponent` surface, and the editor resolves a container ref through it. Both the name and the shape are fixed: the component registry types a block's exports as either a leaf surface or a container's `containerApi`, and the container arm is `ContainerBlockComponent`, which requires the descent verbs (`focusByPath`, `revealByPath`, `parkCaret` and the rest) rather than leaving them optional. So omitting the export, or publishing a surface missing one of them, fails your typecheck (svelte-check, or `tsc` on a plain-TypeScript plugin) at the call that registers your component (`definePluginBlock` in the recipe above, `registerBlockComponent` if you register by hand). The factory's surface satisfies that by construction; a hand-rolled one can annotate itself `satisfies ContainerBlockComponent` to get the same error at the definition instead of at the registration.
- **`BlockList` stays a _direct_ child of your box**, so the container's windowing finds it. Other chrome (an icon, a toggle button) may sit beside it.
- **Chrome CSS reads the editor's theme tokens**, with an inline fallback on every read — `var(--color-ui-muted, #a4a4a4)` — so the block still renders outside `.editor` scope. Match that fallback to the token's **dark base** value; dark is the base. The stable token set by role is the [consumer guide's theme-token manifest](consumer-guide.md#theme-tokens).

The factory returns more than the walkthrough destructures. **`updateOwnMetadata`** is the sanctioned commit path for a component that writes its own node's metadata; the [render-primary recipe](#recipe-a-render-primary-block) leans on it. In reading mode, which writes no bytes, it declines as a no-op (dev builds warn). **`moveFocusOut`** hands the caret to the neighbour a plain arrow points at, for a plugin-owned editing surface whose caret has run off its own edge — it routes through the editor's focus traversal, so the landing skips non-focusable blocks, enters containers and reveals a windowed target like any other arrow. **`getPresentationMode`** is the container tier's live mode read (see [Presentation modes](#presentation-modes)), and **`getTheme`** its sibling — the editor's theme name, for a body an engine PAINTS rather than CSS styles. Chrome styled with tokens needs neither: it rethemes itself through the cascade. **`getOptions`** returns this editor instance's options for the plugin owning your kind, typed `unknown`; it is the per-instance channel a definition-time factory argument cannot reach (see [the editable leaf](#the-editable-leaf)).

A marker-bearing container (a footnote definition's `[^label]: `, mirroring a list item's `- `) hands the factory a **`getAmbientPrefix`** getter. Its first child then paints that string as a dimmed, read-only prefix before its own bytes, and the caret and offset walk skip it exactly as they do a list marker. Read it live so a marker derived from metadata re-renders after an edit.

### Wire it into a page

Pass the plugin to the editor's `plugins` prop — it installs before the seed parses, so `:::note` resolves to your kind:

```svelte
<script module lang="ts">
	import { notePlugin } from './note-kind';

	const plugins = [notePlugin()];
</script>

<script lang="ts">
	import { Editor } from '@voithos-labs/aragonite';
	import '@voithos-labs/aragonite/styles/editor-theme.css';

	const SEED = ':::note My Title\nBody paragraph\n:::\n';
	let editor = $state();
</script>

<Editor bind:this={editor} source={SEED} {plugins} theme="light" />
```

The chords are live: focus the note, press `Mod+7` / `Mod+8` to switch it between `note` and `tip`, then read `editor.getSource()` back and watch the opener line change with it. Add a collapse toggle by giving `reservedChrome` an `isCollapsed` probe over the node — every focus walk, merge, and window clamp then reads that one declaration. Add `expandPatch` beside it, returning the metadata that opens the node, and a reveal into the collapsed body (a toc entry, a search match) opens the container first and commits it as one undoable edit; without it, such a reveal has nowhere to land and reports that it did not.

## Editable-content tiers

Content that is _itself editable_ comes in four tiers, each backed by a tree guarantee:

| Tier              | What it hosts                                                                   | Status                 |
| ----------------- | ------------------------------------------------------------------------------- | ---------------------- |
| **Container**     | Real document blocks in a nested child list — the walkthrough's body            | shipped                |
| **Chrome leaf**   | One reserved, single-line, plain-text child the container's raw owns            | shipped                |
| **Editable leaf** | A standalone text surface with native caret/IME/undo/selection/clipboard parity | shipped _(pre-freeze)_ |
| **Atomic widget** | An opaque, non-text embed, caret-addressable only at its edges                  | shipped                |

The chrome leaf is deliberately narrow: it is always present, single-line and unsplittable (paste flattens to inline), and it is cleared — never deleted — by a destructive range, staying the same kind through every edit. The contract guarantees the empty leaf's presence, not its look: an empty-state affordance (placeholder text over an untitled title, say) is yours to build with CSS on the leaf's block class.

**Declare `gapEdges` when your surface traps the caret at its edges.** A grid, a fence or an opaque embed leaves the boundary it shares with a neighbour unreachable: no caret can sit there, so no paragraph can be typed between two of them. `gapEdges: 'before' | 'after' | 'both'` on the kind opens the edges you name to a between-blocks caret, where typing or Enter mints a paragraph. Omit it and your kind behaves exactly as it does without the field. The bundled kinds set the precedent: an opaque container whose fences leave no textual way out (the callouts, details, the generic directive container) declares `'both'`; a container whose children can already escape at its boundary (a blockquote's unwrap, a list's exit) declares nothing.

Nested-editor interiors — a second editor's state serialized as a blob — are **rejected permanently**. They break byte-lossless round-trip.

### The editable leaf

`createEditableLeaf` is the container factory's sibling for leaves. It reads the editor's contexts itself (deps are live thunks — `getNode`, `getIndex`, `getPath` — plus `getEl()` returning your source contenteditable) and hands back everything a text-editing block needs.

**Native parity is the tier's whole claim**: the editor's caret and sticky-column traversal enter and leave your block like any built-in text block, IME composition is respected, undo batches like prose, the clipboard is intercepted for plain-Markdown copy/cut/paste like every editable surface, and a cross-block selection sweeps through your text.

**One spread wires the source surface.** Write `<div {...leaf.surfaceProps}>` on your source contenteditable and the nine DOM handlers, the `contenteditable` / `role` / `tabindex` / `spellcheck` attributes, and two view-lifecycle contracts land at once — so a forgotten handler (a dropped `oncompositionend` that silently breaks IME) can't happen. The two contracts the spread owns are the ones every consumer used to hand-write: the source is populated as a **single text node** (so `textContent === source` and the offset walk stays exact), and focus is parked on the editor root when the source unmounts.

That single text node carries every newline your source holds, which makes **`white-space: pre-wrap` (or `pre`) on your source element part of the contract** for any leaf whose bytes can span lines: without it the browser collapses the line breaks on screen while the offset walk goes on counting them, so the caret sits nowhere near where it looks. Beyond that you add only your own `class` / `aria-label`, and **`bind:this` in both modes** — the factory reaches your element only through `getEl()`, so plain mode's view sync reads it exactly as a reveal does; the modes differ only in that render-primary's `getEl()` returns null while the view is folded. Two modes:

- **`'plain'`** — the source is always the editable view; every keystroke commits to the tree (prose-like undo batching). The spread's sync mirrors external rewrites (undo, a structural replace) into the source and gates `contenteditable` off the mode, so the always-mounted surface goes inert in reading mode; the factory owns the Chromium trailing-newline caret anchor and the caret restore.
- **`'render-primary'`** — a rendered view by default; focus, click, or arrow-traversal reveals the raw source in your contenteditable, and leaving it commits **once** — the whole reveal→edit→blur cycle is one undo entry. You own the swap flag (`isRevealed` / `setRevealed`) and both views' rendering; there are two spreads, `surfaceProps` for the source and `renderProps` for the folded view. Spread both: the folded view owes the reveal click AND the chord dispatch, and one wired for the click alone swallows undo while it holds focus. A fold writes back only the bytes the reveal opened over, so an undo or a `source` swap that lands a different block at the index declines the write rather than corrupting it.

**Commit semantics.** A commit parses the edited text and lands it through the editor's own edit ladder: same-kind text updates the node in place (caret preserved), a kind change remounts the block, and text that parses to **multiple blocks structurally replaces the leaf with all of them**, the caret following the edit position into whichever block it falls in. Editing past your own fence therefore re-splits the document instead of wedging foreign text into your node, and the byte round-trip holds through every commit.

**Per-instance configuration.** `leaf.getOptions()` returns this editor instance's options for the plugin owning your kind, typed `unknown` for you to narrow — the container factory's `getOptions()` is the same door one tier up. Prefer it over a value your plugin factory captures: installation is process-global and first-wins, so a factory argument is fixed by whichever editor mounts first, while two editors on one page each read their own entry here. The bundled toc block resolves `maxDepth` this way and falls back to the factory argument, which then serves as the default for an instance declaring none.

Block math (`$$…$$` in the bundled `@voithos-labs/aragonite/plugins/latex` plugin) is the worked example: its component script is the factory call, one render effect (KaTeX), a `{...leaf.surfaceProps}` spread on the source, and one-line re-exports of the returned surface. Registration is the ordinary leaf recipe — `registerBlockKind` (no container group), `registerBlockOpener`, `registerBlockComponent`.

## Presentation modes

**The contract: every plugin tier can learn the editor's current presentation mode and render for it.** The editor is not permanently the marker-always source view — a consumer can put it in `reading`, `preview-block`, `preview-inline`, or `live` mode today — so a plugin that assumes source mode renders wrong the day its host flips the prop. `PresentationMode` is `'source' | 'reading' | 'preview-block' | 'preview-inline' | 'live'`; every read below reports the **effective** mode, and with every rung built the effective mode equals the requested one. The union **grows by addition**, so handle it non-exhaustively: read the one property your rendering depends on — does this mode paint markers, does it write bytes — and default the rest, or the next rung renders your kind wrong the day it lands.

How each tier reads it:

| Tier                       | Mode read                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin instance logic      | `editor.presentationMode` on your `EditorContext` (live getter); subscribe to the `presentationModeChange` event for flips                                                                                                                                                                                                                                                              |
| Editable leaf              | `leaf.getPresentationMode()` on the `createEditableLeaf` surface                                                                                                                                                                                                                                                                                                                        |
| Container block (factory)  | `container.getPresentationMode()` on the `createContainerBlock` surface — the live effective mode, mirroring the leaf getter; the preferred path when the factory is in hand                                                                                                                                                                                                            |
| Inline widget (rendering)  | The `getPresentationMode` prop your component is mounted with — a **live getter** beside the frozen `{ inline, source }` snapshot                                                                                                                                                                                                                                                       |
| Inline widget (editing)    | `ctx.presentationMode` on the `InlineWidgetEditingContext` your `onSelectedKey` receives                                                                                                                                                                                                                                                                                                |
| Block component (DOM tier) | The `data-presentation` attribute on the editor root (`el.closest('[data-presentation]')`); **absent means `'source'`**. The fallback for a component holding only a DOM handle (no factory). A **point-in-time** read — correct in a gesture handler or at initial render, but not reactive: a live flip does not re-render a mounted block through it (see the reactivity note below) |

What the platform already does for you in `reading` mode — so most plugins need no mode code at all: your editable-leaf never reveals and never commits; chord dispatch (block commands, global commands, keymaps) dead-keys at the dispatcher; the container factory's whole-block Enter/Backspace/reorder gate; and marker spans hide by CSS. You read the mode yourself when your component owns an edit affordance of its own — a toolbar button, a click-to-edit swap, an interactive widget — which must go inert (the bundled mermaid block's Edit button and the details disclosure are the worked examples), or when your rendering should genuinely differ between a source view and a reading view.

`preview-block` is different: it is a **live editing** mode, so none of those reading gates fire — you type, edit, and command in it exactly as in source. What it changes is that every block except the focused one hides its markers. A **render-primary** plugin block (a diagram, a chart — the [render-primary recipe](#recipe-a-render-primary-block)) gets this for free: it already renders its picture when unfocused and reveals its source only on caret entry, in every non-reading mode, which _is_ block-granular preview. A plugin block that instead renders always-visible source chrome should hide that chrome when it is not the focused block; the built-in prose kinds do this by CSS, and the reveal-on-focus render-primary pattern is the supported way for a plugin to match it. A reactive "am I the focused block" block-tier signal is a later rung.

`preview-inline` narrows the reveal to inline granularity inside the focused block — the construct under the caret shows its syntax; everything else stays rendered. For plugin inline kinds nothing changes at the API level, and what happens to each follows from how it renders:

- **A registered inline widget** (component or `buildWidget`) keeps its editing policy exactly as in every other live mode — `revealSource` opens the source on caret entry, selection/delete semantics are untouched. The caret-proximity marker reveal covers the built-in marker-wrapped kinds (emphasis, strong, strikethrough, inline code, links, image alt syntax), not widgets — a widget already has its own reveal or select behavior.
- **A recognized but unwidgeted inline kind** renders as its raw source text with no marker spans, so preview-inline neither hides nor reveals anything for it — it looks the same as in source mode. If you want rendered-until-touched behavior for your inline kind, register it as a widget with `revealSource`.

`live` hides every marker standing over content and reveals nothing at all, while staying fully editable: render for it as you render for `preview-block` — hide your own source chrome — and edit in it as you edit in source.

Reactivity is **per tier, not universal** — the honesty this section exists to state:

- **Which reads are live.** The `EditorContext.presentationMode` getter (paired with the `presentationModeChange` event), the editable-leaf `getPresentationMode()`, the container-factory `getPresentationMode()`, and the inline-widget `getPresentationMode` prop are re-read by the render pass and the event dispatch, so those tiers track a flip on their own. The **block-component DOM read is point-in-time**: `closest()` learns the mode when your code runs, but a live flip does **not** re-render a mounted block through it. If your block's _rendering_ must change with the mode, react explicitly — subscribe to `presentationModeChange` on your `EditorContext`'s `events` (from `onEditor`) and update from the handler, or re-read the mode at each gesture. The built-in mermaid diagram gates its edit affordance the gesture-read way, calling the container factory's `getPresentationMode()` at click time; the built-in details block reads the mode per render instead, because its reading-mode disclosure changes what RENDERS (see below), not just what a click does. Reactive block-tier rendering is a later rung; today the block tier is point-in-time by design.
- **The theme rides exactly where the mode rides.** `EditorContext.theme` (paired with the `themeChange` event), the container and leaf factories' `getTheme()`, and the inline-widget `getTheme` prop are the same four doors with the same liveness. Reach for them only when your content's colors are PAINTED by an engine and so cannot be reached by CSS; token-styled chrome rethemes itself through the cascade and should read none of this.
- **Reading mode writes no bytes, which is not the same as "nothing happens".** An affordance whose flip is view-only may stay live there — the built-in `<details>` disclosure does, so a reader can open a collapsed section. The pattern is worth copying exactly: keep the transient state in a module with **no commit door in its dependencies** and choose the handler by mode, so the reading path cannot commit rather than declining to; feed the EFFECTIVE state to the container factory's `isCollapsed` dep, so the window clamp mounts what the view claims is open; and reset the transient state when the mode leaves reading, or a view state outlives the mode whose bytes agreed with it. An affordance whose flip would rewrite the document (a task checkbox) stays inert — that is the line, not "interactive vs not".
- **Never snapshot a live tier, and check the mode you handle.** A value captured at mount from a live getter is stale by construction — read it each time. And gate on the specific mode you render for (`=== 'reading'` for a reading affordance), never a `'source'` check you invert — `preview-block` is a live editing mode, so a reading-style inertness gate must not fire in it, and a future rung degrades to your default rendering instead of disappearing.

## Recipe: a render-primary block

Some blocks are not text: a diagram, a chart, an embed — content that renders as a picture and is edited through its own UI, not through the editor's caret. The Mermaid reference plugin is the worked example; the shape generalizes:

```
fence claim ──▶ opaque container, NO children ──▶ component renders the diagram
                  code lives in metadata            edit UI is plugin-owned
                  rebuildRaw re-emits the fence     commits ride updateOwnMetadata
```

- **Claim your grammar, decline everything else.** The opener accepts exactly the fences the built-in `fencedCode` would, gated on the info string's first word, and must price **ahead** of `fencedCode` (see [opener priority](#opener-priority)). Declining returns the fence to `fencedCode`, which is also your uninstall story: without the plugin the same bytes parse as a plain code block and round-trip byte-identically. Pin both states with round-trip tests. Match the fence with `matchFenceOpen` / `matchFenceClose` — never carry your own copy of the CommonMark fence rules.
- **Code in metadata, an empty container around it.** Register the kind with `container: { contract: 'opaque', rebuildRaw }` and give nodes `children: []`. The source text and every fence byte the rebuild needs (indent, marker, info string, closer shape) go into typed plugin metadata — primitive values only — and `rebuildRaw` re-emits the exact bytes from them. Build the parsed node's `raw` by calling your own rebuild, so opener and rebuild agree by construction.
- **Edit mode commits through `updateOwnMetadata`.** The component swaps its body to a plugin-owned `<textarea>` seeded from metadata; commit (Ctrl+Enter, blur) writes the new code with the container factory's `updateOwnMetadata` — one undoable entry, your `rebuildRaw` re-emitting the fence so `getSource()` reflects the edit byte-exactly. Escape cancels without touching the tree.
- **Inject the renderer, memoize it, own its CSS.** The engine is the consumer's dependency: take it as a plugin option (`mermaidPlugin({ renderer })`) and pass it by module to the component. Wrap it in `createBoundedMemo` so re-renders of unchanged code do zero engine work — an async renderer stores the render promise as the cached value (in-flight work is shared, a failure is cached like a success), and a renderer whose result holds a live DOM node passes a `cloneOnRead` so each caller gets its own copy. Resolve failures to a legible inline error, never a throw, and render a static code fallback with a note when no renderer is configured. The engine's stylesheet travels with the renderer module — import it there so no route can forget it: a KaTeX-based renderer needs `katex/dist/katex.min.css`, or its MathML accessibility tree lays out unclipped and every equation paints twice.
- **If the engine paints its own colors, the theme is a render input.** An engine that emits markup carrying color literals (a diagram SVG) cannot be rethemed by a stylesheet after the fact — the diagram has to be redrawn. So the theme belongs in three places at once, and any one of them alone leaves a broken half: **the renderer's parameters** (so it can draw for the theme), **the memo key** (so a flip misses and a flip back is still a hit — never a cache reset, which throws away work you will want again), and **the component's render read** (`getTheme()` off the container or leaf factory), because THAT read is what subscribes the block to the flip. Mermaid keys `theme\0code`; its engine adapter maps the editor theme name to a mermaid theme and re-initializes when it changes, serializing renders because that config is process-global. An engine styled by CSS variables needs none of this.
- **Interior interactivity stays inside your DOM.** Pan/zoom, buttons, overlays — anything draggable must `stopPropagation()` on pointerdown, or the drag starts a cross-block selection. A focus view is just a fixed-position overlay in the component's own tree: mount it in place, focus it on open, close on Escape.
- **View-state commands reach the component through `ctx.hooks`** — see [block commands](#block-commands).

**What you give up with the textarea.** The code text is not editor-native: no cross-block selection through it, the textarea's caret and IME are the browser's, not the editor's, and so is its undo — a chord raised inside your surface reaches the browser, not the editor's history, so the draft has its own undo stack and the editor's chords resume once focus leaves. Because the container has no children, a caret cannot land _inside_ it — so opt into **whole-block focus**: declare `blockFocus: 'whole-block'` on the kind and hand the factory a `getFocusEl` getter returning the element that **declares** the block's focus surface: the one a pointer lands on. DOM focus itself goes to a hidden editing host the factory mounts in your chrome box, because AltGr productions and IME composition arrive only through an editing host and your surface is not one; a click or Tab onto your declared element is passed on to it. So assert containment, not identity, if you test for focus — and give your box `position: relative`, or the host resolves against whatever ancestor is positioned. The host is also the block's tab stop, so a declared element carrying its own `tabindex="0"` adds a second one, and a backward tab out of the block parks on it instead of leaving; leave the declared element out of the tab order unless it is genuinely interactive. The one declared surface that keeps focus for itself is an editable one (your edit `<textarea>`), which owns its caret and IME already. Arrows then stop on the block (the bundled mermaid diagram is the shipped reference), a caret-adjacent Backspace/Delete focuses it before a second press deletes, Enter inserts a paragraph below, undo/redo run from the block itself, and Alt+arrows reorder it. Keyboard and click share the one focus state, and keys inside your own editing surface never trigger a block delete.

**What you owe it, first: an arrow that runs off your surface has to leave it.** A textarea swallows every arrow at its own boundaries, so a caret that walks in is stuck — worst when your surface is the block's only view and the caret lands in it on creation, which leaves the mouse as the only way out. Call the factory's `moveFocusOut(event)` when the caret sits at the edge the key points at: first line for ArrowUp, last line for ArrowDown, offset 0 for ArrowLeft, the end for ArrowRight. It declines a modified or non-arrow key and moves nothing when it declines, so gate your own `preventDefault` on its return value and a Shift-extend or a mid-text arrow stays native. Logical lines — the newlines around the caret — are enough: a plugin surface owes an exit, not sticky-column parity. And an exit is a blur, so a surface that commits on `focusout` already commits through it; do not add a second commit path for the arrow.

**And what you owe it next: your draft is a copy, so keep it fresh.** A draft seeded once at open goes stale the moment the document changes underneath — a host undo, a structural replace, a collaborative write — and the commit on blur then writes bytes the tree has already moved past, silently reverting the change. Derive the code from the node, watch that derivation while your surface is open, and re-seed the draft when it changes to something you did not just commit; discarding an in-flight draft is the cheap loss, reverting a committed change is the expensive one. The editable leaf does this for you (both modes mirror external raw changes into the source); a plugin-owned surface owes it itself, and the bundled mermaid block is the worked example.

Supply a focus element for **every steady state** — error, loading, and static fallbacks included — so a broken render stays keyboard-reachable. If the getter returns null anyway, the editor degrades to focusing your chrome box and warns in dev.

Want a source view with a native caret instead? That is the [editable-leaf tier](#the-editable-leaf), and rebuilding a render-primary block on `createEditableLeaf` (block math's shape) is this recipe's upgrade path.

## Recipe: reading the document above your block

A block component gets its own node — but a table-of-contents block needs the headings above it, and a cross-reference needs an id defined elsewhere. `BlockComponentProps.document` delivers the read-only root document to every component, at any nesting depth:

```svelte
<script lang="ts">
	import { getContentRange, type DocumentView } from '@voithos-labs/aragonite/plugin';

	// A component receives its own node too; this block needs only the document.
	let { document }: { document?: DocumentView } = $props();

	// A $derived over the prop subscribes to the CST proxy, so editing a heading
	// above re-runs this and the list updates live.
	const headings = $derived(
		(document?.children ?? [])
			.filter((b) => b.kind === 'heading' || b.kind === 'setextHeading')
			.map((b) => {
				const { start, end } = getContentRange(b); // drop the `#` / underline markers
				return b.raw.slice(start, end);
			})
	);
</script>

<nav>
	{#each headings as text}<div>{text}</div>{/each}
</nav>
```

`document` is a **`DocumentView`** — read-only by type ([Views](#views)); deriving from it is the whole point, and mutation stays a commit-ceremony concern.

A block that needs to _navigate_ to what it read — a table-of-contents entry jumping to its heading — receives the owning instance's rect surface as **`BlockComponentProps.rects`**, the same object `EditorContext.rects` hands your per-instance callback. So `rects.navigateTo(path)` works from inside a block without reaching for an editor context a component does not have, and the navigation shares the editor's one reveal-and-place seam rather than a second copy of the rule. `navigateTo` lands the caret at the target as well as scrolling to it: an affordance that only scrolled would leave focus on its own button, where the editor's chords do not reach and an undo typed right after the jump does nothing. Use `scrollTo(path)` where the viewport should move but the selection should not. Navigation mutates no bytes, so it stays legal in reading mode, which simply has no editable target to focus; the bundled **toc** plugin is this recipe end to end.

## What an opener returns

`tryOpen` returns `null` to decline, or a `BlockOpenerResult`: the node it built plus `consumed`, the number of lines it claimed starting at `ctx.index`. It is a count, not a position. A single-line block returns `consumed: 1`; an opener that scanned forward to a closing line at `closeIdx` returns `closeIdx + 1 - ctx.index`.

`consumed` must be at least 1. Claiming nothing is the one return that could spin the parse loop, so the parser declines it in every build and warns in dev ([misuse outcomes](#misuse-outcomes)).

Scanners hand back positions rather than deltas, because their result is a slice bound: `blockquoteExtent` returns a `nextIndex`, and the opener subtracts once at its own return.

> **Migrating from `nextIndex` (pre-1.0 breaking change).** An opener used to return the absolute index to resume at. Return the delta instead: `{ node, nextIndex: ctx.index + 1 }` becomes `{ node, consumed: 1 }`.

## Opener priority

An opener's `priority` decides dispatch order — **lower runs first**. `OPENER_PRIORITIES` is the authoritative built-in ladder (a readonly map, the same constant the built-ins register with):

| Priority | Built-in kind             |
| -------: | ------------------------- |
|       10 | `fencedCode`              |
|       20 | `heading`                 |
|       30 | `thematicBreak`           |
|       40 | `blockquote`              |
|       50 | `list`                    |
|       60 | `indentedCode`            |
|       70 | `htmlBlock`               |
|       80 | `linkReferenceDefinition` |

Two rules place a plugin opener on it:

1. **Price _below_ a built-in whose matcher is a superset of yours.** `fencedCode` accepts every fence, ` ```mermaid ` included, so the Mermaid opener must win first: `OPENER_PRIORITIES.fencedCode - 5`. If a built-in would also match your syntax, you sit ahead of it or it claims the block.
2. **Otherwise slot into a gap between built-ins.** `<details>` is only ever an `htmlBlock`, so it prices into the gap just below: `OPENER_PRIORITIES.htmlBlock - 5`. Express the number as an offset from the built-in you reason about, never a bare literal.

Ties break by kind name, deterministically — dispatch never depends on registration order — but a shared priority is a smell, and the dev build warns on it. Price into a gap instead.

The opt-in `:::name` directive grammar registers its container opener at 45, between `blockquote` and `list`.

## Openers and document position

`OpenContext.isDocumentParse` tells an opener whether the parse it is dispatching in was handed a whole document or one block's bytes. It is `true` for `parse(source)` (the default scope) and for the editor's load of the `source` prop; it is `false` for every reparse the editor runs while you type, which pass `{ scope: 'fragment' }` (the scope union is exported as `ParseScope`): the content commit, split and merge, the clipboard parse, a container body. Nothing else on the context answers the question, and one field reads like it does: `index === 0` says only that the block is first in the parse window, and a window starting mid-document has a first block too. A kind scoped to a document position gates on the composition rather than the flag alone.

```ts
tryOpen(ctx) {
	if (!ctx.isDocumentParse || ctx.index !== 0 || ctx.depth !== 0 || ctx.leadingTrivia !== '')
		return null;
	// ... your syntax
}
```

The flag stays constant through nested container recursion, so `depth` is what tells you a blockquote or list body is not the document top. `parseContainerBody` takes the scope as a required argument for the same reason `parse` accepts one: a body is a new parse entry and nothing in it can recover the scope. An opener reparsing a body that stays inside the dispatching parse passes its own (`ctx.isDocumentParse ? 'document' : 'fragment'`, plus `depth: ctx.depth + 1`); one that re-enters with a body it assembled itself passes `'fragment'`. Declare `interruptsParagraph: false`: a line that interrupts a paragraph has a paragraph before it, so it is not at line 0 by construction. Pair the opener with a paste transform. Pasted text reaches `parse` as a fragment, so your opener declines it, and the transform is where you decide what pasted front matter should become (a fenced block, say) instead of leaving the syntax live mid-document.

The residual, stated plainly. A fragment edit that should dissolve the kind does dissolve it: break the closing fence and the block becomes the constituent blocks its bytes now warrant. Restoring those bytes does not put the kind back in the live tree, because nothing reparses across a block boundary after a commit. `getSource()` returns the correct bytes and a reload restores the block. That limit is not specific to position-scoped kinds (it is the general case of two blocks whose bytes jointly reparse as one), and it has a sibling: typing the syntax at the document top also needs a reload before the kind appears, since the commit reparse sees one block's bytes and declines by design.

## Typing a multi-line construct into existence

An opener recognizes syntax that is already there. A grammar whose lines must be **adjacent** — a table's header over its delimiter, a `$$` fence over its closer — can never get there by typing, because Enter splits a paragraph into a blank-line-separated pair and two adjacent prose lines would just re-parse as one paragraph. `registerBlockCompleter` closes that: your completer reads the one line the user typed and answers the canonical lines that complete it.

```ts
registerBlockCompleter(myKind, {
	tryComplete: (line) =>
		line.trim() === '$$'
			? { lines: ['$$', '', '$$'], caret: { path: [], line: 1, column: 0 } }
			: null
});
```

What the editor guarantees before your `tryComplete` is called: the block is a single line of prose whose every byte is content, and the caret sits at its end. So the line you receive is the whole typed line and never a kind's own markers. Return `null` to decline; the press then splits as usual. Claims are consulted in kind-name order, so which completer wins never depends on registration order.

Answer `lines` **without** line endings — the seam attaches the editing block's own, so a CRLF document stays CRLF. Answer the caret as a `path` (child indices inside the minted block, empty for the block itself) plus a `line` and `column` inside that node, never a byte offset: the seam picks the line ending after your claim, so only it can count bytes. The claim lands as one block replacement and one undo entry; one undo restores the typed line with the caret back at its end, and pressing Enter there completes again.

Two bounds worth knowing. Your lines are re-parsed by the ordinary parser, so a completer can only mint what a reload of those bytes would produce — register the opener that recognizes them first. And a completer sees a line, never a position, so a grammar that is only legal at one place in the document is not a completion candidate.

## Inline kinds

An inline kind is minted with `declarePluginInlineKind`, recognized by hooking the scanner on a trigger character (`registerInlineSyntax`), and rendered as a live atomic widget (`registerInlineWidgetKind`). A widget renders through one of two paths, and the descriptor rejects declaring both:

- **A `component` (recommended).** Supply a Svelte component; the editor wraps it in the atomic island — stamping the marker attributes the cursor and selection machinery need — and mounts it with frozen `{ inline, source }` props. A keyed reuse pool keeps one live instance per `(kind, source)` across the editor's rebuild-everything-per-keystroke render: typing next to a widget adopts its instance rather than remounting it, and the instance is remounted only when its source text changes.
- **A hand-built `buildWidget`.** Return the island DOM yourself when you need DOM-level control. Start from `mintWidgetShell`, which stamps the marker and source-span attributes the offset walk reads, then add the body. This is the lower-level path the image and emoji widgets use.

**Three live getters ride beside the frozen props**, and they are getters for the reason the pool exists: an instance survives a mode flip and an edit elsewhere, so a captured value goes stale where a getter stays current. `getPresentationMode` is the effective mode, `getDocument` the read-only root document, and `getContentVersion` a number that changes whenever the document's bytes change and is stable otherwise. If your widget derives from the whole document, read the version inside the same `$derived` and use it as your memo key. The document itself is not a usable key: the editor mutates it in place, so its identity never changes and an identity-keyed memo hits forever on a stale answer. Reading the version inside the derived is also what subscribes your widget to edits anywhere, so N widgets sharing one memoized walk stay as live as N widgets each walking the document.

**A bare trigger must be a character no built-in scanner claims.** Registering a bare recognizer on a reserved trigger (`` ` ``, `&`, `<`, `*`, `_`, `~`, `[`, `]`, `!`, `\`, or newline) throws: built-in dispatch runs first, so a bare recognizer there would never fire, and a silent no-op is the one failure a public API must not have.

The bundled **emoji** plugin (`@voithos-labs/aragonite/plugins/emoji`) is this bare-rung recipe end to end and the worked reference for an inline kind on an unreserved trigger: `:shortcode:` recognizes on the bare `:` trigger, renders as an atomic glyph widget through `buildWidget` + `mintWidgetShell`, and carries the `{ deleteGranularity: 'atomic', onEdge: 'step-over' }` edge policy so a caret-adjacent Backspace removes the whole `:name:` in one press and a plain arrow steps over it. It shares the `:` trigger with the directive text tier — disjoint grammars coexist on one trigger, so a table-lookup miss declines and falls through byte for byte. The literal `:name:` bytes stay in the raw, so an uninstalled document round-trips as ordinary prose.

**To claim syntax that begins on a reserved trigger, register a prefix rung.** A GFM `[^label]` footnote reference starts on `[`, which the link scanner owns. Pass a `prefix` that begins with the trigger and a `priority` below `INLINE_PRIORITIES.builtin`, the inline mirror of an opener pricing below a built-in:

```ts
registerInlineSyntax('[', recognizeFootnote, {
	prefix: '[^',
	priority: INLINE_PRIORITIES.prefixOverride
});
```

The scanner consults the rung ahead of the built-in `[` case, but only when `[^` matches at the cursor, so a plain `[` that opens a link is untouched. Your recognizer claims `[^label]` by returning a node, or declines with `null`. A `[^` that never closes declines and falls back to the built-in link reading byte for byte, so an unterminated reference is never a hang and never a byte change. Rungs on one trigger coexist and dispatch by priority ascending, then longer prefixes first, then lexicographic, independent of registration order (the `OPENER_PRIORITIES` model, one layer down). Reach for a replace decoration (see Decorations below) only to annotate bytes you do **not** own; syntax that is genuinely your kind's belongs in a prefix rung.

**`!` takes a prefix rung; `]` still rejects one.** Both sit outside the scanner's fast-bail character set, because they only matter inside a `[`-bearing range — so a rung on either fires only if the bail is taught to visit the character. `!` is taught on demand: registering a prefix rung on it turns on a per-character probe for as long as the registration lives, which is what lets an Obsidian-style `![[embed]]` be a real inline kind instead of a decoration painted over bytes the tree never sees. Prose exclamation marks keep the plain fast path while nothing is registered. `]` has no such route, and a prefix rung on it still throws rather than accept a silent no-op.

A rung on `!` is consulted ahead of the built-in `!` case, so it outranks the image grammar wherever its prefix matches — and the two grammars do overlap: an image whose alt text opens with `[` starts on `![[` as well, so `![[a.png]]` carrying a parenthesized destination after it is a built-in image with the alt text `[a.png]`, not an embed. Deciding that overlap is your recognizer's job. Decline it (return `null`) and the built-in image reads the bytes unchanged. **Getting it wrong fails silently.** An ungated `![[` recognizer swallows the image with no throw and no dev-warn, and since the raw bytes are untouched the document still round-trips byte for byte — so no round-trip check and no conformance cell in your own suite will see it. The first report comes from a reader whose picture stopped rendering.

**Bound the decline, not just the claim.** Your recognizer is consulted at every occurrence of its trigger, so a decline that searches to the end of the block costs one block scan per trigger — quadratic on a large paragraph, and the trigger is often ordinary prose (`$HOME $PATH …` for `$`). Stop at the first character your grammar cannot contain, the way the emoji recognizer stops at the first non-shortcode byte; where the grammar has no such character, index the candidate positions once per block with `createScanIndex` (hand it your position collector, get back a "first candidate at or after this offset" lookup), the way the bundled math and footnote recognizers index their closers.

The bundled **footnotes** plugin (`@voithos-labs/aragonite/plugins/footnotes`) is this recipe end to end and the worked reference to read against your own inline kind: `[^label]` recognizes through a `[^`-prefix rung at `INLINE_PRIORITIES.prefixOverride`, renders as a superscript widget whose number derives reactively from the whole document (a `DocumentView` walk memoized on `getContentVersion`, so the number re-derives when a reference is added elsewhere while every mounted widget in a flush shares one walk), and reveals its source to edit. The literal `[^label]` bytes stay in the block's raw, so an uninstalled document round-trips as ordinary GFM.

**If your rung mints a built-in kind, it owns writing those bytes back.** A rung may return a node of a kind the editor already has — an `![[cat.png|300]]` that is a real `image`, so the widget renders it, the caret addresses it, and the resize handles appear. Every _read_ path then treats it as an image, which is the point. The _write_ paths cannot: the editor's inverse for a built-in kind emits that kind's built-in grammar, so re-serializing your node's fields brings `![[cat.png|300]]` back as a GFM image — bracketed alt, parenthesized destination — and your syntax is gone. Supply a `rewriteImage` hook and the edit comes back to you instead:

```ts
registerInlineSyntax('!', recognizeEmbed, {
	prefix: '![[',
	priority: INLINE_PRIORITIES.prefixOverride,
	rewriteImage: (source, fields) => {
		if (!source.startsWith('![[')) return null; // bytes this rung did not shape
		// Decline what this grammar cannot store rather than dropping it silently: it
		// holds a target and an optional width and nothing else. The alt line is THIS
		// recognizer's version of that rule — it fills alt and url from the one target,
		// so an alt that no longer matches is an edit with no form here. Write yours
		// against however your own recognizer fills the node.
		if (fields.title !== undefined || fields.label !== undefined) return null;
		if (fields.alt !== fields.url) return null;
		return `![[${fields.url}${fields.width !== undefined ? `|${fields.width}` : ''}]]`;
	}
});
```

`source` is the node's current bytes; return their replacement in your grammar. Return **`null` when the edit has no form in your syntax** — an embed has nowhere to put a title — and the editor declines the edit rather than writing something you did not author. **A rung with no hook declines every such edit**, which is the safe default: the affordance is live and visibly does nothing, and a dev build logs which rung declined and why. Nothing is silently rewritten either way, and images the built-in scanner read are untouched — bytes your rung _declines_, including the overlap above where the alt text merely begins with `[`, stay the editor's to resize as always.

Three edges the snippet above is shaped by, and each one bites if you drop it:

- **Read every field, or decline it.** A hook that ignores a field the user edited returns byte-identical bytes, and byte-identical bytes are dropped by the commit's equality guard — **silently, with no dev warn**, because your hook returned bytes rather than `null`. The properties popover's Alt row then simply does nothing, with no diagnostic anywhere. Declining is what makes the limit visible; ignoring is what makes it a mystery.
- **Guard every optional field you interpolate.** `fields.width` is absent on an embed that never carried one, and an unguarded template writes the literal `|undefined` into the document.
- **Bound the hook to bytes you shaped.** The claim reaches _descendants_ of the node your recognizer returned, so a rung that mints its own kind wrapping a built-in `image` gets called with the **inner** node's slice, not the whole construct. Checking `source` before rewriting is what keeps that from nesting your syntax inside itself.

**Errors in a component widget are half yours.** A **synchronous mount-time throw** is caught — the widget falls back to its raw source and an `error` event fires — but the component mounts as its own effect root, so nothing catches its post-mount runtime errors. Render a legible error for bad input instead of throwing (the KaTeX widget shows an inline message). A render engine's stylesheet is likewise yours: import it in the module that owns the renderer so no route can forget it.

**The inline tier is not the block surface in miniature.** An inline kind gets recognition, rendering, atomic caret addressing at its edges, and an editing policy on its widget registration. The policy has four fields, all optional: `revealSource` (open the `$…$` source for editing on entry — inline math's model), `onSelectedKey` (a handler for keys while the widget is selected — image resize), and the two caret-edge vocabulary fields — `onEdge: 'select' | 'step-over'` (select the whole widget at an edge press, or step transparently over it) and `deleteGranularity: 'atomic' | 'select-then-delete'` (delete the whole widget on one press, or select-then-delete over two). Both are live: the built-in decoded-entity widget (`&copy;` → ©) ships `{ deleteGranularity: 'atomic', onEdge: 'step-over' }`, so a caret-adjacent Backspace removes it whole and a plain arrow walks the caret across it like a character — the caret-edge dispatch reads both off the widget registration. The inline tier gets **no keymap, no minted commands, and no per-node metadata** — `InlineNode` has no metadata field, so unlike a block kind it stores nothing on the node.

## Decorations

Everything so far teaches the editor content you **own** — a kind, its grammar, its component. A decoration annotates content you **don't own**: highlight every occurrence of a word, ghost-complete a sentence, fold a range, badge a heading. Decorations are view-only — they never enter the document tree, never change `getSource()`, and never touch undo.

You register a **source** on each editor instance, from `onEditor`:

```ts
setup(ctx) {
	ctx.onEditor((editor) => {
		const handle = editor.decorations.addSource({
			name: 'my-highlights', // unique per instance; a duplicate throws
			provide: (doc) => scanForMarks(doc) // pure: document in, decorations out
		});
		return () => handle.dispose();
	});
}
```

`provide` receives the document as a `DocumentView` ([Views](#views)) and is **pure over it plus your own state** — the editor re-runs it after every document edit, and the render layer applies whatever it returns. There is no decoration set to map forward through changes: positions are `(path, offset)` addresses into the current tree, recomputed each run. When your _own_ state changes instead (an option toggled, the selection moved, an async result arrived), call `handle.invalidate()` to re-run just your source.

**Two contracts to build against:**

- **`invalidate()` is synchronous.** Your new decorations are applied before the call returns — so an event handler can invalidate and immediately trust the view.
- **Widget identity is untracked.** The renderer compares decorations by position and class, not by widget object — swapping in a new `component` or `buildDom` at the same position with the same class re-renders nothing. Vary `class` when the widget's content changes.

### The four decoration types

| Type      | Shape                                                    | Renders as                                                                     |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `mark`    | `{ type: 'mark', path, start, end, class }`              | A positioned overlay span over the inline range — style it via the class       |
| `widget`  | `{ type: 'widget', path, offset, widget }`               | A zero-width atomic island at the offset (ghost text's shape)                  |
| `replace` | `{ type: 'replace', path, start, end, widget?, class? }` | An atomic island covering the range; the hidden bytes stay in the document     |
| `block`   | `{ type: 'block', path, class?, attrs?, badge? }`        | A class/attrs treatment on the whole block host, plus an optional badge widget |

Offsets are **raw offsets** into the target block — dimmed markers included, the same coordinate space `getContentRange` describes. A `widget`, `replace` widget, or `badge` takes a `DecorationWidgetSpec`: a Svelte `component` (receives the decoration as its prop) or a hand-built `buildDom`. An interactive mark takes `interactive: { onClick }`, not a top-level `onClick`; interactive DOM inside an island is native — wire your own listeners in `buildDom`.

Islands (`widget` / `replace`) render in prose blocks and in table cells, applied through the same seam in both; `mark` and `block` decorations serve cells too. Island caret behavior is defined and pinned: arrows step over, destructive keys treat a widget island as transparent and select-then-delete a replace island whole, so the hidden bytes are never silently corrupted.

### Recipe: memoize the scan on `editEpoch`

`provide` runs on every document change, so an expensive scan wants a memo. Do **not** key it on `doc.children` identity — routine typing mutates the tree in place. The second `provide` argument carries `editEpoch`, a counter that bumps once per document change (an edit, or a whole-document `source` replacement) and **never** on `invalidate()`, which is exactly the split a memo needs: epoch miss → the document changed, rescan; epoch hit → only your own state changed, remap the cached scan.

```ts
let lastEpoch = -1;
let index = new Map<string, MarkDecoration[]>(); // word → its occurrence marks
let caret: EditorSelection | null = null;

const handle = editor.decorations.addSource({
	name: 'occurrences',
	provide: (doc, { editEpoch }) => {
		if (editEpoch !== lastEpoch) {
			lastEpoch = editEpoch;
			index = buildWordIndex(doc); // one whole-document walk per edit
		}
		const word = wordUnderCaret(doc, caret);
		return word ? (index.get(word) ?? []) : []; // one map read per invalidate()
	}
});

editor.events.on('selectionChange', (sel) => {
	caret = sel; // the source's own state — read on the next invalidate
	handle.invalidate();
});
```

Keying the cache on an index (word → marks) rather than a flat list makes the per-invalidate step a map read, not a re-filter of every mark. The bundled `highlight-occurrences` plugin (`@voithos-labs/aragonite/plugins/highlight-occurrences`) is this recipe end to end, plus one capability gate: it indexes only inline-prose leaves (`isProseKind` — the descriptor's `supportsInline`), so a fenced code block's bytes are neither scanned nor a valid anchor.

A source that throws is contained: the editor emits an `error` event attributed to your source name and keeps the previous decorations on screen — a throw never blanks the view. Pair a source with `editor.rects` when you need geometry (anchor a popup to a decorated range, say): `rects.rangeRects(path, start, end)` returns viewport-space rects for any measurable range, one per visual line.

## Block commands

`registerBlockCommand` mints a `(kind, name)` command and returns its id, which a keymap binding then targets. The name is process-wide, but the registry key is `(kind, name)` and dispatch is kind-scoped — so you may reuse one command name across several of your own kinds (one `note.toggle` on every callout variant). A name already taken by a **different** plugin is rejected.

A minted command dispatches on the two tiers that can hand it a `BlockCommandContext` (the focused node plus a metadata-commit route):

- the **editable-leaf tier** — a `createEditableLeaf` block, resolved from the focused leaf's keymap;
- the **container-bubble tier** — a container-factory block, resolved as a chord bubbles up from an inner leaf.

Bind commands to your own plugin kinds. A command bound on a built-in kind's leaf (paragraph, code, table cell) does **not** dispatch — those surfaces supply no context and dead-key it.

The consumer door `editor.runCommand(id)` reaches neither of those tiers: it resolves the focused surface without a command context, so a **block**-minted id finds no handler and dev-warns that the command reached no handler on this dispatch path. Bind a chord, or expose an API of your own, for a block affordance a host must invoke without a keystroke. A **global** command is not so limited: its name resolves ahead of the block tiers, so `editor.runCommand('wordCount.log')` runs it and `canRunCommand` answers `true` for it (below).

**View state rides `ctx.hooks`.** Because the context is built by the surface that owns the mounted component, it also carries the component's own view-state handles, supplied through the factory's `commandHooks` getter. A view-state command — open an editor, open a focus overlay — therefore drives the component directly, with no node-keyed side map. Hand `createContainerBlock` a `commandHooks: () => ({ openEdit, openFocusView })` getter (read live at dispatch, so an undo that replaces the node still hits the current handlers). The platform keeps `hooks` opaque (`unknown`): cast it to your own type in the handler, and decline when it is `undefined` — kind registered, no instance mounted.

A handler that throws is contained at the dispatch seam: the gesture no-ops and the failure surfaces on `getEvents()` as an `error` of origin `command`, attributed to the kind, command id, and owning plugin. Never an uncaught error.

**Global commands** are the editor-wide sibling. `registerGlobalCommand(name, handler, { chord })` mints a process-wide command whose handler receives the dispatching instance's `EditorContext` — not a block — so it runs regardless of which block holds focus, for editor-scope actions like opening a panel. Call it from `setup`:

```ts
setup(ctx) {
	registerGlobalCommand(
		'wordCount.log',
		(editor) => {
			// The mint is not generic-bound: the handler gets EditorContext<unknown>,
			// so narrow options here (onEditor's callback is where they read typed).
			const opts = editor.options as WordCountOptions | undefined;
			console.log(`[${editor.editorId}]`, countByEditor.get(editor.editorId), opts);
			return true; // handled
		},
		{ chord: 'Mod+Shift+L' }
	);
	ctx.onEditor(/* … */);
}
```

The chord binds in the **plugin-global tier**, which resolves _last_ — after every `keybindings` override, built-in kind chord, and built-in global chord (undo/redo). So a plugin chord never shadows a built-in, and the reverse shadow is by design: a built-in kind's own chord beats your plugin chord **on that kind, not elsewhere**. Built-in chords and the reserved search chords (`Mod+F` / `Mod+H`) are unstealable — a collision **throws before the mint**, leaving no half-registered command. A handler throw is contained identically, surfacing as an `error` of origin `command` attributed to the owning plugin.

Chord strings follow the consumer guide's chord model — fixed-order `Mod` / `Alt` / `Shift` plus the key's own value. Shifted-symbol chords are not modeled, so bind plain digits and letters.

## Paste transforms

`registerPasteTransform` records a **content-keyed, pre-parse** rewrite of pasted plain text. Each transform is a `{ name, transform(text) }` unit: `transform` returns a replacement string, or `null` to decline ("not mine"). Transforms run at every paste site before the clipboard text is parsed, in **install order** — each sees the previous transform's output — so a plugin keys off the _content_ it recognizes rather than the block it lands in. The name is unique (register-once; a duplicate throws, naming the owning plugin) and scopes the transform for attribution.

Two habits keep a transform sound:

- **Decline cheaply, then convert precisely.** Probe the text for your marker first and return `null` when it is absent — the pipeline runs on every paste, so a fast reject keeps the common case free.
- **Scope through the parser, not a naive text scan.** A line-level scanner rewrites marker-shaped lines that happen to sit inside a pasted code fence; a converter that parses first and rewrites only the blocks it means to is fence-safe. Keep the transform **idempotent** — re-running it on its own output must decline or reproduce it. A dev warning fires otherwise, catching paste feedback loops.

The admonitions plugin is the worked example. It renders `> [!NOTE]` GitHub alerts as a native container kind with their bytes untouched, so the paste transform is **opt-in** (`admonitionsPlugin({ convertAlertsOnPaste: true })`, default off): when enabled it probes for an alert blockquote and converts only the top-level ones to `:::name` directive source through a parse-scoped converter, so an alert-shaped line inside a pasted fence survives literally. The transform serves pastes; a host button running the same converter over `getSource()` serves already-loaded documents whichever way the transform is set.

## Recipe: a kind created only from consumer UI

Some kinds should not be typeable — a chart card, a survey embed, a citation block whose author picks it from a menu rather than remembering syntax. The move is **not** to register a kind with no grammar, and this is the anti-pattern worth naming: raw Markdown is the source of truth, so a kind whose bytes no opener can recognize survives exactly until the document is saved and reloaded. On the way back in, the parser sees prose. A kind with no grammar cannot round-trip, so it cannot exist.

Own a `:::name` directive instead. The grammar is real, so the bytes reload as your kind, and the syntax is implausible to arrive at by typing: it needs three colons, a name, a body and a `:::` terminator, and nothing along the way paints a half-formed block. That is as close to "not typeable" as a raw-is-truth editor can honestly get, and it costs nothing — the [directive walkthrough](#walkthrough-a-directive-container-end-to-end) is the same registration you would write anyway.

Creation then comes from the host's own UI. The consumer's `editor.insertMarkdown(md)` inserts your kind's canonical bytes at the caret exactly as pasting them would, so a menu entry is:

```ts
editor.insertMarkdown(':::chart\ntype: bar\n:::\n');
```

Bytes are the whole API, so shipping a new kind adds no method for the host to adopt — the snippet is the integration. Two notes for the recipe:

- **Document your canonical snippet** beside the kind. The host pastes bytes; give it the exact bytes your `rebuildRaw` would produce, so the first insertion is already canonical.
- **The insertion is a paste**, so it carries the strategy pick, the undo entry and the caret landing a paste carries. A multi-line directive splices structurally, which is what a block kind wants.

## What a plugin may and may not do

A plugin **may**:

- Register kinds, components, and openers — once; a duplicate throws.
- Declare a `rebuildRaw` and have the editor invoke it when the document changes.
- Build containers and chrome through the factories.
- Store primitive per-node metadata, and commit metadata through the sanctioned update path.
- Contribute per-kind keymaps over the command vocabulary.
- Render as an unknown kind and degrade to a visible raw fallback.
- Transform pasted plain text before it is parsed ([paste transforms](#paste-transforms)).

A plugin **may not**:

- Treat its DOM as authoritative, or mutate the tree from the view layer — boundary events flow up, and the tree always wins. Type-enforced since the readonly views: every plugin-visible node type is deep-readonly on its bytes ([Views](#views)).
- Write bytes through a node reference captured before an edit — after any change, read the node back from the tree; the old reference is stale.
- Pass reactive tree state by value across a module boundary — hand it through a live read (a getter, or a `() =>` thunk as the frozen factory deps take).
- Invent merge-role, unwrap, or container-contract values — those are closed sets.
- Silently override a built-in or another plugin's registration.
- Intercept loading or typing, or rewrite the whole document from a paste. The paste hook is **paste-scoped and pre-parse only**: it sees the clipboard text, never the load path or keystrokes. A whole-document migration belongs at the document level — read `getSource()`, transform the Markdown, and write the editor's `source` prop, which replaces the document in one step.

Most of that boundary is enforced by **shape**: the factories never hand you a raw context key or a mutation handle, so the disallowed move is simply unavailable. The rest is enforced by **dev-mode checks that are stripped from a production build** — so a plugin developed against a production build gets no signal at all. **Develop against a dev build.**

### Misuse outcomes

Why the dev build is where plugin development belongs — what each mistake does in each build:

| Misuse                                    | Dev build                                                           | Production build                                    |
| ----------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| `rebuildRaw` writes the wrong bytes       | Warns at edit time, naming the kind                                 | Silent until the bytes surface in a round-trip      |
| A component throws while rendering        | Contained as a failed-block fallback plus an `error` event, by path | Same containment (the boundary ships in production) |
| An opener claims no line (`consumed < 1`) | Warns, naming the kind, and declines the opener                     | Declines the same way, silently — no hang           |
| An opener's `raw` ≠ the lines it consumed | Parse warns, naming the kind                                        | Silent round-trip break                             |
| An opener throws                          | Propagates uncaught (parse runs at init and on every edit)          | Same — uncaught                                     |

## Verifying your plugin

**Round-trip is the contract.** The headless form needs no editor — `parse` and `serialize` both ship on `@voithos-labs/aragonite/plugin`:

```
import { parse, serialize } from '@voithos-labs/aragonite/plugin';

expect(serialize(parse(MY_SOURCE))).toBe(MY_SOURCE);
```

Then read the live document back with `editor.getSource()` and confirm it equals what you authored. Then test the case that matters most for a plugin platform: author a document using your directive **with your plugin not registered** — the generic fallback must return it byte-for-byte, so uninstalling a plugin never corrupts a saved document.

**Dev-mode warnings are your guard channel.** The shape checks above only fire in a dev build. Run `vite dev` while developing and watch the console: a `rebuildRaw` byte mismatch, an opener that disagrees with the lines it consumed, or a collapse probe that contradicts the descriptor all warn there and are silent in production. A clean dev-console round-trip is the signal your plugin is sound.

### Testing your plugin

The platform is register-once: a plugin's setup writes into process-global registries that throw on a duplicate and never unregister. A test runner reuses one process across cases, so a plugin installed in a second `beforeEach` would collide with the first. The `@voithos-labs/aragonite/testing` subpath exists for exactly this:

```
import { resetPluginPlatformForTests } from '@voithos-labs/aragonite/testing';

beforeEach(() => {
	resetPluginPlatformForTests(); // empty the registries
	registerMyPlugin(); // your plugin's setup — the one the `plugins` prop runs
});
```

Reset **then** re-install — the reset only empties the registries. It clears every non-built-in schema registration (kinds, components, openers, commands, installed plugins), the inline syntax and widget registries, the paste surface and transform pipelines, and the `:::` directive registry. Built-in registrations survive, exactly as in production.

Two things it does not restore. It wipes **all** paste surfaces, built-ins included, so a case that pastes into a built-in block after a reset must re-register or skip the reset (parse and round-trip cases are unaffected). And it touches no runtime state — the undo stack, the selection, and the live document are yours to set up. `resetPluginPlatformForTests` is test-only and throws if called outside a detected test environment; detection is Vitest-specific, so a suite on another runner opts in first with `configureEditorEnv({ isTest: true })`.

The rest of the subpath, at a glance:

| Export                                                       | Role                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `installEditorDomStubsForTests`                              | Install the browser APIs a mounted editor calls and jsdom lacks               |
| `applyPasteTransforms`                                       | Run the registered paste pipeline over a string, exactly as a real paste does |
| `runKindConformance`                                         | The per-kind closure battery                                                  |
| `checkCopyIsRawByteSlice`                                    | That battery's clipboard executor, drivable directly against a kind           |
| `runContainerConformance`, `reversedAncestryLeavesRootStale` | The container harness, and the companion that proves its ancestry cell bites  |
| `runInlineKindConformance`                                   | The inline-rung battery                                                       |
| `configureEditorEnv`, `resetEditorEnv`                       | Declare a non-Vitest runner a test environment, and restore the defaults      |
| `setDevWarnSink`                                             | Route every editor dev warning to a callback of yours instead of the console  |

**Testing a paste transform.** `registerPasteTransform` writes into a registry nothing else on the public surface reads, so `applyPasteTransforms(text)` ships beside the reset. It is the very function every clipboard→parse route runs, which is what makes driving it proof that your transform is _wired_ rather than proof that your pure function works:

```
import { applyPasteTransforms, resetPluginPlatformForTests } from '@voithos-labs/aragonite/testing';

it('converts on paste', () => {
	registerMyPlugin();
	expect(applyPasteTransforms(CLIPBOARD_TEXT)).toBe(CONVERTED_TEXT);
});
```

**Mounting your component.** A component tier is only really verified mounted, and a jsdom mount is a supported way to do it. Two of the three things standing in the way are jsdom gaps rather than editor requirements, and the helper closes both:

```
// @vitest-environment jsdom
import { mount, flushSync } from 'svelte';
import { Editor } from '@voithos-labs/aragonite';
import { installEditorDomStubsForTests } from '@voithos-labs/aragonite/testing';

installEditorDomStubsForTests(); // ResizeObserver + scrollIntoView, installed only where absent

const target = document.body.appendChild(document.createElement('div'));
const editor = mount(Editor, { target, props: { source: MY_SOURCE, plugins, scrollMode: 'host' } });
flushSync(); // the first render has to land before you can assert on it
```

`scrollMode="host"` is the third: it drops the editor's own scrollport and the standalone chrome a jsdom box cannot size anyway. Windowing is gated on the height budget alone in either scroll mode, so keep the fixture short — a document tall enough to clear the budget windows here too, and unmounts the very block you are asserting on. From there `target.querySelector` reaches your component's own chrome and `editor.getSource()` is a byte-exact assertion surface.

**Failing on a dev warning.** The editor reports contract violations it can contain rather than throw through dev warnings, which reach the console under an `[aragonite:…]` head. A suite that wants those to fail rather than scroll past registers a sink:

```
import { setDevWarnSink } from '@voithos-labs/aragonite/testing';

const fires = [];
beforeEach(() => setDevWarnSink((entry) => fires.push(entry)));
afterEach(() => {
	setDevWarnSink(null);
	expect(fires.splice(0)).toEqual([]); // a guard fired and nobody claimed it
});
```

`setDevWarnSink` returns the sink it replaced, so a nested harness can restore rather than clear. A registered sink takes reporting over: nothing reaches the console while yours is installed, and each entry carries the guard's `tag`, its `message`, and any `details`.

One prerequisite, or the gate is green because it is blind: warnings emit only while the editor env reads as a dev build outside a test runner it recognizes. Vitest is detected automatically; under any other runner, or a bundler that resolves no export conditions, call `configureEditorEnv({ isDev: true, isTest: false })` (same table, above) in your setup first and `resetEditorEnv()` in teardown.

### The conformance battery — registering a kind enrolls it

`runKindConformance(kind)` executes the headless half of your kind's `closure` block. It derives one cell per cross-cutting system from the block and your `conformanceFixture`, and runs the part that needs no browser now: it round-trips the fixture (and, for a container, checks `rebuildRaw` is deterministic), holds Backspace-merge eligibility to your `mergeRole`, confirms an `inherit-default` clipboard copies as a plain byte slice, checks one structural op is one undo entry, and asserts a `not-supported` search cell genuinely finds nothing. Cells whose mechanism only exists in the browser — focus, selection and search paint, reorder, the simulation oracle — are recorded `boundary`, run by the e2e sweep rather than stubbed green.

```
import { runKindConformance } from '@voithos-labs/aragonite/testing';

it('my kind conforms', async () => {
	await runKindConformance(declaredPluginKind(MY_KIND));
});
```

**The fixture contract**, because two executors depend on it and only a thrown assertion would otherwise teach it: your `conformanceFixture` must parse to your kind at **`children[0]`**, and the undo and clipboard cells build their document by **appending** a sentinel block after it. A fixture that puts your kind anywhere but first fails the clipboard cell, and a kind that can only appear somewhere other than the document top is not enrollable in those two cells as they stand.

It resolves with a per-cell report and throws naming every failed cell — so a `conformanceFixture` that stops parsing to your kind, or a closure cell that lies about a mechanism the runner can observe, fails the moment you register it. Where a cell claims a mechanism the runner cannot reach generically (a kind-specific copy, say), supply a check for it: `runKindConformance(kind, { cells: { clipboard: { check: async (ctx) => … } } })` — `ctx` hands you the parsed fixture and the kind's node.

The mounted-DOM cells — focus, selection paint, search paint — are executed for you: a browser conformance sweep enrolls every registered kind that declares a `conformanceFixture`, so the moment your kind registers with one it is driven headfully for caret walk-through, cross-block selection painting, and search-match painting.

### Conformance-testing a container

If your plugin registers a **container** kind, `@voithos-labs/aragonite/testing` also publishes the harness the built-in containers are held to — the same checks, pointed at your kind. It is the fastest way to find out whether your container behaves like a first-class one:

| Cell                  | What it holds you to                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localIndex`          | Children are addressed by their **local** index at each nesting level, not a global offset                                                                                                                                                                                                                    |
| `ancestry`            | An edit deep inside rebuilds raw inner→outer, so the root's `raw` reflects the leaf change                                                                                                                                                                                                                    |
| `multiScope`          | One logical multi-scope op pushes exactly **one** undo entry                                                                                                                                                                                                                                                  |
| `focusBubble`         | A boundary focus event bubbles to the root and terminates — no loop, no double-escape                                                                                                                                                                                                                         |
| `terminatorCollision` | A body line reproducing your container's own terminator stays inside it                                                                                                                                                                                                                                       |
| `declarations`        | Your `unwrapRole` names strategies that exist, `containerPaste` is shaped right, `rebuildRaw` runs — and, if you declare `contentStartSpace`, that it re-emits the marker's trailing space on a content line (the declaration consumes the user's space, so a rebuild that does not give it back eats a byte) |

`terminatorCollision` is new, and **required** — a profile written before it stops compiling until the cell is declared. Assert it and supply a `terminatorCollisionFixture` (body bytes carrying a line that reproduces your terminator), or declare it `exempt` with a reason if nothing a body can hold could ever reproduce your terminator; the paragraph below the example says which of those you are. The fixture's `bodyRaw` names the bytes a **user types**, not the bytes that reach the tree — the kit writes them through your `bodyWrite` rule, the same door a real commit uses.

You supply the fixtures, because the kit parses its way to your kind — so register the plugin first, then hand it Markdown that produces your container:

```
import { runContainerConformance } from '@voithos-labs/aragonite/testing';

it('my container conforms', async () => {
	await runContainerConformance(declaredPluginKind(MY_KIND), {
		// A nesting where your kind is an ancestor of a deep editable leaf.
		deepNesting: { source: OUTER_WRAPPING_INNER, leafPath: [0, 1, 1] },
		// The chain of container indices down to your kind, and which child to edit.
		localIndexFixture: { source: OUTER_WRAPPING_INNER, containerChain: [0, 1], targetChild: 2 },
		focusSource: ONE_OF_MY_CONTAINERS,
		// Body bytes carrying a line that reproduces your terminator.
		terminatorCollisionFixture: { source: ONE_OF_MY_CONTAINERS, bodyRaw: 'before\nMY_TERMINATOR\nafter\n' },
		localIndex: { mode: 'assert' },
		ancestry: { mode: 'assert' },
		multiScope: { mode: 'exempt', reason: 'my container owns no ≥2-scope op — its inner ops are single-scope' },
		focusBubble: { mode: 'assert' },
		terminatorCollision: { mode: 'assert' }
	});
});
```

Pick a **non-first** child at a **non-zero** chain position for `localIndexFixture`. At chain `[0, 0]` / child 0 a local path and a flat global offset are the same number, and the check proves nothing.

`terminatorCollision` is the one most container authors have not considered. If your container wraps body bytes between an opener and a terminator, a body line that reproduces that terminator closes it early, and everything below leaves the container the next time the document is parsed. Byte round-trip does not catch it: the bytes are re-emitted verbatim either way, and only the live tree disagrees with them.

Three repairs, by terminator shape. A **fence-shaped** terminator escalates — the `:::` containers lengthen their fence past the body's runs, which the editor does for you. A **strip** container is immune, because it prefixes every line it emits. A **fixed-token** terminator such as an HTML close tag can do neither, and repairs the collision with [`bodyWrite`](#making-body-bytes-legal-bodywrite) instead: it rewrites the offending bytes on the way IN, so the child's own `raw` carries the rewrite and nothing diverges. Declare the cell `exempt` only when nothing a body can hold could reproduce your terminator at all. A **childless** container whose body lives in metadata drives the same cell through the optional `TerminatorCollisionFixture.writeBody` instead of a last-child write, so the collision probe reaches a body no child carries.

Escaping at the **rebuild** is the one thing that does not work, and it is the tempting one: an opaque container's `raw` is checked against its live children, so rewriting a child on the way out reads as staleness. The write sink is early enough that no such gap exists.

Every cell is `assert`, `exempt`, or `boundary`. A cell you cannot assert is declared, not skipped: `exempt` means the invariant has nothing to bite on (no multi-scope op exists), `boundary` means asserting it would need something the harness cannot reach (a mounted component, a DOM). Both demand a substantive `reason` — a thin one fails the run, so an exemption stays visible instead of quietly hollowing the harness out. A profile must keep at least one asserting behavioral cell, or excuse itself whole through the optional `wholeProfileExemption` with the same documented-reason bar. The call resolves with a report of what was asserted and what was excused; it throws an `Error` naming every failed cell otherwise, so it drops straight into a test case under any runner.

One companion worth asserting alongside it: `reversedAncestryLeavesRootStale(profile)` must be `true` for a container whose `rebuildRaw` reads only its direct children. It rebuilds outer-first on purpose and checks the root went **stale** — that is what proves your `ancestry` cell is testing something rather than passing by construction.

#### Declaring the wrap: `bodyWrap`

A container whose opener parses its body through `parseContainerBody` declares the same wrap as `container.bodyWrap`. The parse peels the blank line against your opener into `innerPrefix`, so that line is the wrap's rather than an empty first row — and the editor's separator settle has to know it, or a delete that frees a blank line above your body head drops the line the peel eats and the head block disappears on the next load. Declare it and the two agree; the container conformance kit probes the parse and fails a declaration that does not match. A strip container whose body starts at its own first line (a blockquote shape) declares nothing, and must therefore carry no `innerPrefix` — the node-shape guard fails a wrap-less container that fills that slot.

#### Making body bytes legal: `bodyWrite`

A container kind declares `bodyWrite` when its body's bytes carry grammatical meaning it owns:

```
container: {
	contract: 'opaque',
	rebuildRaw: rebuildMyRaw,
	bodyWrite: {
		normalize: (raw) => /* raw, made legal as a child of this container */,
		mapOffset: (raw, offset) => /* where a caret at `offset` ends up after that */
	}
}
```

`normalize` is applied to every byte destined for the body, at the tree-op write sinks — **ahead of the reparse that decides the child's kind**, which is what makes it work where a rebuild-time rewrite cannot: the kind a write lands on is the kind its committed bytes describe. It must be **idempotent** (a re-commit of already-legal bytes changes nothing) and **line-local** (it may read the whole raw to decide _which_ lines to rewrite, but never moves bytes across a line boundary). `mapOffset` is its caret image, so a surface whose committed bytes differ from what the user typed still seats the caret on the bytes; the pair ships as one object because a rewrite without its caret image strands the caret.

Two rules of thumb from the bundled `details` container. Ask the **grammar**, not your own spelling: what breaks the container is everything the Markdown spec hands to raw-HTML passthrough — indented, upper-cased and trailing-space spellings included — which is looser than the canonical form your `rebuildRaw` emits, and `htmlBlockTagLineMatcher` from `@voithos-labs/aragonite/plugin` answers that question for a tag name. And rewrite the **minimum**: `details` escapes one `<` to `&lt;`, which renders as the literal tag both in the editor and on GitHub while matching no tag line, so the author sees what they typed.

### Conformance-testing an inline rung

If your plugin registers inline syntax, `runInlineKindConformance` is the same idea one layer down: register the rung, then point the kit at its trigger and prefix and it drives the behaviors a rung can break without moving a byte.

| Cell             | What it holds you to                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `claims`         | Every fixture you supply is actually claimed by **your** rung                                     |
| `roundTrip`      | Your fixtures and the kit's interleavings of them round-trip, and your claims tile the scan range |
| `overlapDecline` | Where your prefix also opens something the built-in scanner owns, you decline it                  |
| `widget`         | Your claimed bytes are one atomic unit, and your island carries the span the caret walk reads     |
| `editingPolicy`  | Your widget's editing declaration is in the vocabulary the caret-edge dispatch actually reads     |
| `imageClaim`     | A rung minting a built-in kind carries the `rewriteImage` hook the write paths need               |
| `registration`   | Your rung is actually registered where your profile says it is                                    |

```
import { runInlineKindConformance } from '@voithos-labs/aragonite/testing';

it('my rung conforms', () => {
	runInlineKindConformance({
		trigger: '!',
		prefix: '![[',
		kind: declaredPluginInlineKind(MY_KIND),
		fixtures: ['![[cat.png]]', 'see ![[cat.png|300]] here'],
		overlapFixtures: ['![[a]](https://x.dev)'],
		overlapDecline: { mode: 'assert' },
		widget: { mode: 'assert' },
		editingPolicy: { mode: 'assert' },
		imageClaim: { mode: 'exempt', reason: 'the rung mints only its own kind, which the scan leaves unstamped' }
	});
});
```

`fixtures` is required and non-empty, and a fixture your rung does not claim **fails** rather than being skipped: every cell below reads the node a fixture produces, so an unclaimed one would enroll your rung without testing it.

**`overlapDecline` is the cell most rung authors have not considered, and it is required.** Registering on a reserved trigger (`[`, `!`, `*`, `` ` ``, …) puts your recognizer _ahead_ of the built-in case, so wherever your prefix matches you are claiming those bytes whether or not they spell something the built-in owns. `![[a]](https://x.dev)` is a plain image whose alt text is `[a]`; a rung that claims every `![[…]]` takes it, and the document still round-trips — as a wiki embed nobody wrote. Supply the sources where your grammar and a built-in one collide; the kit consults your recognizer at every position the scanner would and requires a decline at each, which is exactly what leaves the built-in reading byte-identical bytes. A rung on a reserved trigger may not excuse this cell at all: the overlap exists by construction.

The other three cells you declare, because only you know whether they have anything to bite on — but an excuse the kit can falsify, it falsifies. Declaring `imageClaim` exempt while a fixture mints a stamped built-in fails, as does excusing `widget` for a kind that _is_ a registered live widget. A reason is a claim about your rung, not a waiver.

Two things worth knowing about `widget`. It asserts your claimed slice is **self-delimiting** — re-scanning it alone must re-form the same kind over the whole slice, because that slice is what `data-source-*` hands the clipboard and a source reveal. And where your kind builds its own island (`buildWidget`), it renders your fixture and measures the caret walk, which must equal the source length: a widget counts as its source span, never as what it draws, so an emoji showing one glyph for seven bytes still walks seven. A `component` kind's island is minted by the editor, not by you, so that half does not run and the cell reports `boundary` rather than claiming a pass.

Run it under a DOM (`// @vitest-environment jsdom` for Vitest). Without one the island half cannot run either, and the cell again reports `boundary` naming what you lost — the recognition and self-delimiting halves still execute.

`registration` is the thinnest cell and the one that caught a real bug. Most of what it checks — one rung per rung, a prefix long enough for a reserved trigger, a priority under the built-in boundary, a trigger the fast bail visits — `registerInlineSyntax` already refuses at registration, so those are cross-checks on the editor rather than things you can get wrong. What you _can_ get wrong is your rung not being there at all: a setup step that ran under the wrong guard, or an install order that let another plugin's registration on a shared trigger look like your own. That is what this cell reds on, and it is how the bundled directive tier's own recognizer was found missing.

## API reference

Every `@voithos-labs/aragonite/plugin` export, grouped by job. Values are the calls you make; the accompanying types describe their inputs and outputs.

**Plugin unit** _(pre-freeze / unstable)_

| Export               | Role                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `definePlugin`       | Validate a `{ name, setup }` unit at definition time and return it for the `plugins` prop                                                  |
| `definePluginBlock`  | The single-block plugin unit: one kind, one component, one register step — the common case                                                 |
| `isPluginInstalled`  | Idempotence probe for a named plugin's install                                                                                             |
| `EditorPlugin`       | The plugin unit's shape — `<Editor plugins>` and the main barrel's `installPlugins` take these                                             |
| `EditorPluginEntry`  | A `plugins` prop entry: a bare unit, or `{ plugin, options }` for per-instance options                                                     |
| `PluginSetupContext` | The `setup(ctx)` argument; its `onEditor(cb)` registers a per-instance callback (synchronous-only)                                         |
| `OnEditorCallback`   | An `onEditor` callback: receives the instance's `EditorContext`, may return a disposer run at unmount                                      |
| `EditorContext`      | The per-instance view a callback receives — `editorId`, live `document`, subscribe-only `events`, typed `options`, live `presentationMode` |
| `PresentationMode`   | The mode union every mode read reports — see [Presentation modes](#presentation-modes)                                                     |

**Kind declaration**

| Export                            | Role                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `declarePluginKind`               | Mint a block kind from a name; rejects collisions with built-ins and prior kinds |
| `declaredPluginKind`              | Recover an already-declared kind's brand in another module without a cast        |
| `PluginBlockKind`, `AnyBlockKind` | The branded kind type, and the union of built-in and plugin kinds a node carries |

**Block-kind descriptor**

| Export                                                                                                                         | Role                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockKind`                                                                                                            | Register a kind's descriptor — merge behavior, editability, container shape                                                                               |
| `augmentBlockKind`                                                                                                             | Merge extra fields into an already-registered descriptor                                                                                                  |
| `BlockKindRegistration`, `BlockKindDescriptor`, `BlockKindAugmentation`, `ContainerDescriptorGroup`, `MergeRole`, `UnwrapRole` | The descriptor's write shape, read shape, augmentation patch, its container-only group, and the closed role enums                                         |
| `ClosureBlock`, `ClosureColumn`, `ClosureCell`                                                                                 | The required closure matrix per kind — one `implemented`/`inherit-default`/`not-supported` cell per cross-cutting system                                  |
| `simpleLeafClosure`, `SimpleLeafClosureCells`                                                                                  | Preset for a simple leaf: bakes the five structurally-fixed columns, requires the four the component determines                                           |
| `containerClosure`, `ContainerClosureCells`                                                                                    | Preset for a strip container: bakes the four structural columns and `roundTrip: implemented`, requires `roundTripVia` + the four the container determines |

**Component registry**

| Export                                                                                  | Role                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockComponent`                                                                | Bind a kind to the component that renders it                                                                                                                                              |
| `defineBlockComponent`                                                                  | Wrap a Svelte component into the registry's entry shape                                                                                                                                   |
| `BlockComponentEntry`, `BlockComponent`, `BlockComponentExports`, `BlockComponentProps` | The registry entry, the component contract, the two shapes a component may publish it as (its own members, or a container's `containerApi`), and the props every block component receives |

**Parser opener** — placement rules in [Opener priority](#opener-priority)

| Export                                   | Role                                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockOpener`                    | Teach the parser to recognize a block's own Markdown syntax                                                                                                                                                   |
| `BlockOpener`, `OpenContext`             | The opener contract, and the line cursor it inspects to open a block                                                                                                                                          |
| `BlockOpenerResult`                      | What a claiming `tryOpen` returns: the node, plus the count of lines it consumed                                                                                                                              |
| `OPENER_PRIORITIES`                      | The built-in priority ladder your opener prices against _(pre-freeze / unstable)_                                                                                                                             |
| `lineStartsOuterBlock`, `OuterBlockScan` | Does a line start a block at the outer level? The shared end-of-extent test for a container opener scanning its own lines, and the flag saying whether a paragraph is open above it _(pre-freeze / unstable)_ |

**Enter completion** _(pre-freeze / unstable)_ — the recipe is in [Typing a multi-line construct into existence](#typing-a-multi-line-construct-into-existence)

| Export                   | Role                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `registerBlockCompleter` | Let one typed line complete into a grammar whose lines must be adjacent                        |
| `BlockCompleter`         | The completer contract: `tryComplete(line)` claims or declines                                 |
| `CompletionResult`       | A claim: the lines to mint (no endings) plus the caret's path, line and column inside the mint |

**Directive authoring** _(pre-freeze / unstable)_ — full semantics in the [directives guide](directives.md)

| Export                                                                                             | Role                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `activateDirectives`                                                                               | Turn the `:::name` grammar on; call once at startup, before the first parse                                            |
| `registerDirective`                                                                                | Map a `(tier, name)` to one of your kinds                                                                              |
| `isDirectiveRegistered`                                                                            | Idempotence probe for a directive registration                                                                         |
| `parseDirectiveAttributes`                                                                         | Opt-in reader pulling `[label]{attrs}` out of a directive's info string                                                |
| `serializeDirective`                                                                               | Serialize a fence back to bytes losslessly from a registered kind                                                      |
| `escalatedColonCount`                                                                              | The fence length a body needs, for an emitter building `:::name` text by hand rather than through `serializeDirective` |
| `createDirectiveRebuild`                                                                           | Build the `rebuildRaw` for a title-child-0 directive container — owns the CRLF-safe fence bytes                        |
| `DIRECTIVE_BODY_WRAP`                                                                              | The wrap every `:::` body parses with; declare it as your container kind's `bodyWrap`                                  |
| `DirectiveDefinition`, `ParsedDirective`, `DirectiveTier`, `DirectiveFence`, `DirectiveAttributes` | The registration definition, the parsed fence handed to your factory, and the supporting shapes                        |

**Inline authoring** _(pre-freeze / unstable)_ — the two render paths and the tier's limits are in [Inline kinds](#inline-kinds)

| Export                                                                                                                                                                        | Role                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `declarePluginInlineKind`                                                                                                                                                     | Mint an inline kind                                                                                                            |
| `declaredPluginInlineKind`                                                                                                                                                    | Recover a declared inline kind's brand in another module                                                                       |
| `isInlineKindDeclared`                                                                                                                                                        | Idempotence probe for an inline-kind declaration                                                                               |
| `registerInlineSyntax`                                                                                                                                                        | Hook the scanner on a trigger character with your recognizer (a bare trigger, or a reserved trigger via a prefix rung)         |
| `INLINE_PRIORITIES`                                                                                                                                                           | The inline priority ladder a prefix rung prices against — `prefixOverride` outranks a reserved trigger's built-in case         |
| `InlineSyntaxOptions`                                                                                                                                                         | The `{ prefix, priority, rewriteImage }` options bag for a rung                                                                |
| `registerInlineWidgetKind`                                                                                                                                                    | Register an inline kind as a live atomic widget — a `component` (recommended) or a hand-built `buildWidget`                    |
| `mintWidgetShell`                                                                                                                                                             | Mint the marked, source-stamped island span a `buildWidget` returns — the shell the offset walk reads                          |
| `PluginInlineKind`, `InlineNode`, `InlineSyntaxRecognizer`, `InlineWidgetDescriptor`, `InlineWidgetComponentProps`, `InlineWidgetEditingPolicy`, `InlineWidgetEditingContext` | The inline kind and node types, the recognizer contract, and the widget descriptor plus its component-props and editing shapes |
| `ImageSyntaxRewriter`, `ImageFields`                                                                                                                                          | The `rewriteImage` contract, and the image fields an edit hands it                                                             |

**Commands and keybindings** _(pre-freeze / unstable)_ — dispatch tiers in [Block commands](#block-commands)

| Export                                                                                                     | Role                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockCommand`                                                                                     | Mint a `(kind, name)` block command and get back its id                                                                                             |
| `registerGlobalCommand`                                                                                    | Mint a process-wide command run against the dispatching editor's `EditorContext`, optionally bound to a global chord                                |
| `CommandId`, `KeyBinding`, `BlockCommandContext`, `BlockCommandHandler`, `PluginCommandId`, `AnyCommandId` | A built-in command id, a per-kind chord binding, the context and signature of a command handler, a minted command's id, and the union spanning both |

**Container authoring and chrome** _(pre-freeze / unstable)_

| Export                                                                                                                        | Role                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createContainerBlock`                                                                                                        | Wire a nested-`BlockList` container so your block is as thin as the blockquote                                                                                            |
| `BlockList`                                                                                                                   | The child-list component your container renders with the factory's props                                                                                                  |
| `registerChromeLeaf`                                                                                                          | Register a container's title/summary leaf with a default keymap                                                                                                           |
| `chromeChild`                                                                                                                 | Mint the reserved child-0 node for that leaf — the title/summary text plus its trailing newline                                                                           |
| `isCollapsedContainer`                                                                                                        | Read a container's collapse state, so a component and the model layer agree                                                                                               |
| `ContainerBlock`, `ContainerBlockComponent`, `ContainerBlockDeps`, `ContainerBlockListProps`, `RefSlots`, `ChromeLeafOptions` | The container API, the component surface it returns, the deps it takes, the child-list props, the child-ref slot accessors those props carry, and the chrome-leaf options |

**Editable-leaf authoring** _(pre-freeze / unstable)_

| Export                                                                                                        | Role                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `createEditableLeaf`                                                                                          | Wire a text-editing leaf surface — plain or render-primary — with native caret/IME/undo/cross-block-selection parity            |
| `EditableLeaf`, `EditableLeafSurfaceProps`, `EditableLeafRenderProps`, `EditableLeafDeps`, `EditableLeafMode` | The leaf API your component re-exports, its two one-spread surfaces (source and folded view), its thunk deps, and the two modes |
| `StickyColumnDirection`                                                                                       | The vertical-entry direction `focusAtColumn` receives when the caret traverses into your block                                  |

**Parse / serialize helpers** _(pre-freeze / unstable)_

| Export                                    | Role                                                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse`                                   | Parse a body of Markdown into a document you can lift children from                                                                                                               |
| `ParseScope`                              | The scope both parse entries take: whole document, or one block's bytes                                                                                                           |
| `parseContainerBody`, `ContainerBodyWrap` | Parse a container body that sits between chrome lines of your own, keeping their blank separators out of the children — declare the same wrap as your kind's `container.bodyWrap` |
| `serialize`                               | Serialize a whole document back to its exact source bytes                                                                                                                         |
| `serializeChildren`                       | Join child nodes back into their exact source bytes                                                                                                                               |
| `trimTrailingLineEnding`                  | Read a child's display text without dropping a trailing line ending                                                                                                               |
| `normalizeLineEndings`                    | Normalize external text (a plugin-owned input surface) to LF                                                                                                                      |
| `isBlankLine`                             | GFM §2.1's blank-line test — spaces and tabs only, never `trim()`                                                                                                                 |
| `splitLines`                              | Split source into the parsed lines every line-scoped seam consumes                                                                                                                |
| `Document`, `ParsedLine`                  | The parsed-document shape, and a single parsed source line                                                                                                                        |

**Renderer utilities** _(pre-freeze / unstable)_

| Export               | Role                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createBoundedMemo`  | A bounded LRU memo for per-source work — a renderer's render, a recognizer's scan index — sync (with an optional `cloneOnRead`) or async (the render promise is the cached value) |
| `BoundedMemoOptions` | The memo's options — the entry `cap` and the optional `cloneOnRead`                                                                                                               |

**Recognizer scan index** _(pre-freeze / unstable)_

| Export            | Role                                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createScanIndex` | Turn a per-block position collector into a memoized "first candidate at or after this offset" lookup (-1 when none), so a decline costs one block scan instead of one per trigger |

**Fence grammar** _(pre-freeze / unstable)_

| Export                 | Role                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matchFenceOpen`       | Recognize a CommonMark fence-opener line, verbatim indent/info bytes included                                                                                                                   |
| `matchFenceClose`      | Test a line as the closer for a matched opener (marker + minimum run length)                                                                                                                    |
| `escalatedFenceLength` | The fence run a body needs so no line inside it reads as the closer — a floor, never a shorter fence. A kind that rebuilds its own raw around a body owes it, and must grow the CLOSER to match |
| `FenceOpen`            | The matched opener's shape: marker, run length, trimmed `info`, verbatim `indent` + `infoRaw`                                                                                                   |

**HTML tag-line grammar** _(pre-freeze / unstable)_

| Export                    | Role                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `htmlBlockTagLineMatcher` | Build a recognizer for one tag name's CommonMark type-6 line, open or close — every spelling the spec hands to raw-HTML passthrough, not just the canonical one |

**Blockquote grammar** _(pre-freeze / unstable)_

| Export             | Role                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockquoteExtent` | Scan a blockquote's extent (CommonMark §5.1 lazy continuation) from a start line, returning its `raw` plus the `nextIndex` past it (a slice bound, not an opener's `consumed` delta) — no child decomposition |

**CST node access and metadata** _(pre-freeze / unstable beyond the stable metadata pair)_

| Export                                   | Role                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setPluginMetadata`, `getPluginMetadata` | Store and read your kind's own typed per-node metadata without casting                                                                                 |
| `getContentRange`, `ContentRange`        | The content span within a block's raw, syntax markers excluded (heading `#`, setext underline)                                                         |
| `headingLevel`                           | A heading's level (ATX or setext), null otherwise — the outline reader for a table-of-contents plugin                                                  |
| `computeInlineContent`, `isProseKind`    | Inline-parse a prose leaf (uncached, reactive-safe) and gate the walk — for document-wide state derived from inline structure, e.g. footnote numbering |
| `CstNode`                                | The tree-node shape your factory builds and your `rebuildRaw` mutates                                                                                  |
| `NodeView`, `DocumentView`               | The bytes-readonly views every read surface hands you ([Views](#views))                                                                                |

**Idempotence probes**

| Export                                                                                                         | Role                                                         |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `isBlockKindDeclared`                                                                                          | Probe a kind declaration, where both declaration seams throw |
| `isBlockKindRegistered`, `isBlockComponentRegistered`, `isBlockOpenerRegistered`, `isBlockCompleterRegistered` | Guard each register-once call so re-import is safe           |
| `isPasteTransformRegistered`                                                                                   | The same guard for a paste transform's name                  |

**Paste transforms** _(pre-freeze / unstable)_ — the recipe is in [Paste transforms](#paste-transforms)

| Export                   | Role                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `registerPasteTransform` | Register a content-keyed pre-parse clipboard rewrite (paste-scoped, install-order) |
| `PasteTransform`         | The transform's shape — a unique name and a `transform(text) → string \| null`     |

**Decorations** _(pre-freeze / unstable)_ — the recipe and the two authoring contracts are in [Decorations](#decorations)

View-only annotations layered over the rendered document — never part of the CST. Register a pure per-instance source through `editor.decorations` (your `onEditor` context).

| Export                                                                       | Role                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DecorationRegistry`                                                         | The `editor.decorations` surface — `addSource` registers a source and returns a handle                      |
| `DecorationSource`                                                           | A named, pure source: `provide(document, ctx)` returns the decorations to render                            |
| `DecorationSourceHandle`                                                     | The registration handle — `invalidate()` re-runs one source, `dispose()` removes it                         |
| `ProvideContext`                                                             | The second `provide` argument — carries the monotonic `editEpoch` a cached source keys its rescan on        |
| `Decoration`                                                                 | The union of the four decoration kinds a source may return                                                  |
| `MarkDecoration`, `WidgetDecoration`, `ReplaceDecoration`, `BlockDecoration` | The four kinds — an inline mark span, a positioned widget, a range replacement, and a whole-block treatment |
| `DecorationWidgetSpec`                                                       | A widget's render spec — a Svelte `component` or a hand-built `buildDom`                                    |

**Rects** _(pre-freeze / unstable)_

Viewport-space geometry over the rendered document, reached through `editor.rects` (your `onEditor` context).

| Export        | Role                                                                                                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditorRects` | The `editor.rects` surface — a block's box, an inline range's rects, the native caret, a reveal that mounts a windowed-out block, a scrollTo that mounts then scrolls the viewport to a block, and a navigateTo that also lands the caret there |

**Selection geometry** _(pre-freeze / unstable)_

The selection shapes a decoration source or rect consumer reads.

| Export                              | Role                                                                                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditorSelection`, `SelectionPoint` | The `selectionChange` payload — an anchor/focus pair — and its endpoint: a `{ path, offset }` union discriminated by `cellCoordinate` (`true` ⇒ `offset` is a table cell index; narrow on the flag before reading it as a char offset) |
| `SELECTION_END`, `SelectionEnd`     | The importable sentinel `rangeRects` accepts as `end` ("through the block's last measurable position")                                                                                                                                 |
