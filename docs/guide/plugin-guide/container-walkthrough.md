# Walkthrough: a `:::conspiracy` container end to end

Part of the [plugin guide](../plugin-guide.md). It assumes you've built the parrot in [the quickstart](../plugin-guide.md#the-first-fifteen-minutes), since this is the same four moves on a block that holds other blocks.

Enough preamble. This builds a `:::conspiracy` box: a titled, editable container whose title is a real editable line carrying the theory, and whose body holds the evidence as ordinary Markdown blocks. One kind answers to two directive names, `:::conspiracy` and `:::debunked` (somebody checked), and reads which one it is from its metadata, so the verdict is a one-field edit rather than a second block kind. It runs unchanged in a fresh SvelteKit app.

It reuses the `:::name` directive grammar rather than a hand-written opener. The grammar itself is the [directives guide](../directives.md)'s job; this walkthrough covers the descriptor and the component.

## The registration module

One file declares the kinds, describes them, maps the directive names, binds the component, and returns the whole thing as a `conspiracyPlugin()` unit.

```ts
// conspiracy-kind.ts
import {
	activateDirectives,
	chromeChild,
	createDirectiveRebuild,
	declarePluginKind,
	declaredPluginKind,
	definePluginBlock,
	DIRECTIVE_BODY_WRAP,
	isDirectiveRegistered,
	registerBlockKind,
	registerBlockCommand,
	registerChromeLeaf,
	registerDirective,
	setPluginMetadata,
	trimWhitespace,
	type CstNode,
	type EditorPlugin,
	type ParsedDirective
} from '@voithos-labs/aragonite/plugin';
import ConspiracyBlock from './ConspiracyBlock.svelte'; // the component built in the next section

const CONSPIRACY = 'conspiracy';
const CONSPIRACY_TITLE = 'conspiracy-title';

export interface ConspiracyMetadata {
	name: string; // 'conspiracy' or 'debunked'; re-emitted into raw so the verdict survives
	colonCount: number;
	closerColonCount: number;
	closerNewline: boolean;
	lineEnding: string; // captured at parse; createDirectiveRebuild re-emits it (CRLF-safe)
}

// Build the node from a parsed :::conspiracy fence. Child 0 is the title (the theory,
// from the opener line); children 1+ are the parsed evidence. The fence bytes go to
// metadata so the raw can be rebuilt after an edit.
function conspiracyFromDirective(parsed: ParsedDirective): CstNode {
	const theory = trimWhitespace(parsed.fence.info);
	const node: CstNode = {
		kind: declaredPluginKind(CONSPIRACY),
		leadingTrivia: parsed.leadingTrivia,
		raw: parsed.raw,
		innerPrefix: parsed.body?.prefix ?? '',
		children: [
			chromeChild(declaredPluginKind(CONSPIRACY_TITLE), theory),
			...(parsed.body?.children ?? [])
		],
		innerSuffix: parsed.body?.suffix ?? ''
	};
	setPluginMetadata<ConspiracyMetadata>(node, {
		name: parsed.fence.name,
		colonCount: parsed.fence.colonCount,
		closerColonCount: parsed.closerColonCount,
		closerNewline: parsed.closerNewline,
		lineEnding: parsed.lineEnding
	});
	return node;
}

// Re-emit raw from the children after any structural edit. createDirectiveRebuild owns
// the title-to-opener line, the body serialization, and the authored line ending (the
// byte a hand-written copy silently drops); you supply only the verdict-name resolver.
const rebuildConspiracyRaw = createDirectiveRebuild<ConspiracyMetadata>(
	(meta) => meta?.name ?? CONSPIRACY
);

function registerConspiracy(): void {
	activateDirectives(); // idempotent; the shared grammar must be live before the first parse

	const conspiracy = declarePluginKind(CONSPIRACY);
	const conspiracyTitle = declarePluginKind(CONSPIRACY_TITLE);

	// Two names, one kind: :::conspiracy and :::debunked both resolve here, the kind
	// reading its verdict back from metadata; any other name falls through to the
	// generic directive fallback. The guard is habit: nothing bundled claims these
	// names, but note and tip are claimed by the bundled admonitions plugin, and
	// that is where an unguarded claim throws for real.
	for (const name of [CONSPIRACY, 'debunked']) {
		if (!isDirectiveRegistered('container', name)) {
			registerDirective('container', name, {
				kind: conspiracy,
				fromDirective: conspiracyFromDirective
			});
		}
	}

	// A block command that flips the verdict. updateMetadata is the supported
	// commit path: it merges the patch, runs rebuildRaw, and makes one undoable edit;
	// because the name flows into raw, the verdict survives a round-trip.
	const setVerdict = registerBlockCommand(conspiracy, 'conspiracy.setVerdict', (ctx) => {
		if (typeof ctx.arg !== 'string') return false;
		ctx.updateMetadata({ name: ctx.arg });
		return true;
	});

	registerBlockKind(conspiracy, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		// Fences leave no textual way out at either edge, so both take the gap caret. Without
		// this, two adjacent conspiracies give the user nowhere to type a paragraph between them.
		gapEdges: 'both',
		container: {
			// The title lives in the opener line, so raw is not a strip of the children:
			// 'opaque' marks raw authoritative.
			contract: 'opaque',
			rebuildRaw: rebuildConspiracyRaw,
			// Every `:::` body parses against this wrap. Skip it and a filled innerPrefix
			// trips a dev assertion the moment someone edits a conspiracy with a blank first line.
			bodyWrap: DIRECTIVE_BODY_WRAP,
			reservedChrome: { kind: conspiracyTitle },
			// Child 0 is the title, and Backspace at its start never lifts it out, so you only
			// say what Backspace does between body children. A container whose child 0 is body
			// also picks a first-child strategy: `'lift-first-child-keep-container'`,
			// `'lift-first-child-drop-opener'` for a quote shape, or `'list-item-cascade'`.
			unwrapRole: { middleChildBackspace: 'default-merge' }
			// Declare `reorderChildren` here if the body's blocks should reorder among
			// themselves (drag, or Alt+ArrowUp/ArrowDown). Without it, an opaque
			// container like this one declines the move.
		},
		// The Markdown the conformance kits parse: a top-level conspiracy with a title and a body.
		conformanceFixture: ':::conspiracy Birds are drones\nthey never land near me\n:::\n',
		keymap: [
			{ chord: 'Mod+7', command: setVerdict, arg: 'conspiracy' }, // allege
			{ chord: 'Mod+8', command: setVerdict, arg: 'debunked' } // debunk
		],
		// Required: how this kind behaves under every cross-cutting editor system. A missing
		// cell or column is a compile error, and a dev build warns on four more rules when an
		// editor mounts. See the guide's "The closure block" section for all of them.
		closure: {
			roundTrip: { mode: 'implemented', via: 'container contract=opaque, rebuildConspiracyRaw' },
			focus: { mode: 'implemented', via: 'focus walks to the title chrome / first body child' },
			mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
			selectionPaint: { mode: 'implemented', via: 'body child blocks paint; container cover' },
			searchPaint: {
				mode: 'implemented',
				via: 'children are real blocks; search descends and paints'
			},
			reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
			undo: {
				mode: 'implemented',
				via: 'updateMetadata; the verdict flip commits as one undo entry'
			},
			// reservedChrome means the default byte slice is wrong for this kind, so the
			// clipboard cell has to name what a slice touching the title actually does.
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a slice touching the title re-emits the conspiracy around the collected body'
			},
			// The honest answer unless your kind has simulation tests of its own.
			simOracle: { mode: 'inherit-default' }
		}
	});

	// The label is what a screen reader and the block menu call the title row.
	registerChromeLeaf(conspiracyTitle, { label: 'Theory', blockClass: 'conspiracy-title' });
}

// definePluginBlock wraps definePlugin around the register step and the component
// binding, so you write neither the setup-then-register order nor the
// registerBlockComponent(declaredPluginKind(...), defineBlockComponent(...)) double-wrap.
export function conspiracyPlugin(): EditorPlugin {
	return definePluginBlock({
		name: 'conspiracy',
		kind: CONSPIRACY,
		component: ConspiracyBlock,
		register: registerConspiracy
	});
}
```

`registerDirective`'s `(tier, name)` mapping, the `ParsedDirective` shape, and the per-tier factory rules live in the [directives guide](../directives.md). This module supplies the container factory (`fromDirective`, required for the container tier) and the descriptor. Here's what `conspiracyFromDirective` actually receives for the seed document [Wire it into a page](#wire-it-into-a-page) uses, and what it hands back:

```ts
// parsed, for ':::conspiracy Birds are government drones\nThe quickstart parrot has danced since section one and never once eaten.\n:::\n'
{
	fence: { tier: 'container', colonCount: 3, name: 'conspiracy', info: ' Birds are government drones' },
	body: {
		kind: 'document',
		prefix: '',
		children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'The quickstart parrot has danced since section one and never once eaten.\n' }],
		suffix: ''
	},
	leadingTrivia: '',
	raw: ':::conspiracy Birds are government drones\nThe quickstart parrot has danced since section one and never once eaten.\n:::\n',
	closerColonCount: 3,
	closerNewline: true,
	lineEnding: '\n'
}

// the node it builds
chromeChild(conspiracyTitle, 'Birds are government drones'); // { kind: 'conspiracy-title', leadingTrivia: '', raw: 'Birds are government drones\n' }
node.children.map((child) => child.kind); // ['conspiracy-title', 'paragraph']
getPluginMetadata<ConspiracyMetadata>(node); // { name: 'conspiracy', colonCount: 3, closerColonCount: 3, closerNewline: true, lineEnding: '\n' }
```

That nine-column `closure` literal gets its own section, [The closure block](#the-closure-block), right after this walkthrough.

## The component

Your component supplies only its own chrome: the border, the title styling, an icon if you like. Chrome may read the node it dresses: the verdict comes off the metadata through `getPluginMetadata`, and the stamp follows it. `createContainerBlock` handles everything else, the child list and its windowing (the editor only mounts the blocks in view) included. Pass `node`, `index`, and `path` as **thunks**, meaning `getNode` / `getIndex` / `getPath` functions the factory calls to read the live value each time; a captured value would be a stale snapshot, and the type won't accept one.

```svelte
<!-- ConspiracyBlock.svelte -->
<script lang="ts">
	import {
		BlockList,
		createContainerBlock,
		getPluginMetadata,
		type NodeView
	} from '@voithos-labs/aragonite/plugin';
	import type { ConspiracyMetadata } from './conspiracy-kind';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();
	let boxEl: HTMLElement | undefined = $state();

	const { blockListProps, containerApi, handleKeydown } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl
	});

	// The verdict is read off the node, so the stamp lands the moment the command commits.
	const debunked = $derived(getPluginMetadata<ConspiracyMetadata>(node)?.name === 'debunked');

	export { containerApi };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="conspiracy-block" class:debunked bind:this={boxEl} onkeydown={handleKeydown}>
	<BlockList {...blockListProps} />
</div>

<style>
	.conspiracy-block {
		/* the corkboard, with one piece of red string */
		position: relative;
		border: 1px solid var(--color-ui-muted, #93938d);
		border-left: 3px solid var(--color-error, #ff5f57);
		border-radius: 6px;
		padding: 8px 12px;
	}
	.conspiracy-block :global(.conspiracy-title) {
		font-weight: 600;
	}
	/* debunked: the string comes down, the theory gets crossed out, the stamp lands */
	.debunked {
		border-left-color: var(--color-ui-muted, #93938d);
	}
	.debunked :global(.conspiracy-title) {
		text-decoration: line-through;
	}
	.debunked::after {
		content: 'DEBUNKED';
		position: absolute;
		top: 6px;
		right: 12px;
		transform: rotate(-12deg);
		font: 600 0.75em monospace;
		letter-spacing: 0.12em;
		color: var(--color-error, #ff5f57);
		border: 2px solid currentColor;
		border-radius: 3px;
		padding: 1px 6px;
	}
</style>
```

Three rules for that file, each earned the hard way:

- **`export { containerApi }` is the whole publication.** It's how the editor talks to your container (a caret walking in descends through it, for one), and the name is fixed. Leave it out and your typecheck (svelte-check, or `tsc` on a plain-TypeScript plugin) fails at the call that registers the component (`definePluginBlock` here). The factory's `containerApi` is always complete; a hand-rolled one can annotate itself `satisfies ContainerBlockComponent` to get a missing member reported at the definition instead.
- **`BlockList` stays a _direct_ child of your box**, so the container's windowing finds it. Other chrome (an icon, a toggle button) may sit beside it.
- **Chrome CSS reads the editor's theme tokens**, with an inline fallback on every read (`var(--color-ui-muted, #93938d)`), so the block still renders outside the editor's own style scope. Match the fallback to the token's dark value; dark is the base theme. The stable token set by role is the [consumer guide's theme-token manifest](../consumer-guide.md#theme-tokens).

The factory returns more than the walkthrough destructures:

| Return                  | When you reach for it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updateOwnMetadata`     | Your component writes its own node's metadata (a collapse toggle, an edited setting). The supported commit path; in reading mode, which writes no bytes, it declines as a no-op and dev builds warn. If the edit should move the caret (a collapse hiding the child it sat in), pass `{ caret: { path, offset } }` and the commit puts it there once it renders. `path` is child indices from your block (`[]` for the block itself, `[0]` for its first child), and `offset` is a character offset into that child's text, or `CURSOR_END` for its end. Don't focus anything yourself afterwards |
| `moveFocusOut`          | A plugin-owned editing surface whose caret ran off its own edge; hands the caret to whatever a plain arrow would have landed on                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `getPresentationMode`   | Your rendering or a gesture needs the live presentation mode ([Presentation modes](presentation-modes.md#presentation-modes))                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `getTheme`              | Your content's colors are painted by an engine rather than styled by CSS; token-styled chrome needs neither this nor `getPresentationMode`, it rethemes through the cascade                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `getOptions`            | This editor's options for the plugin that owns your kind, your `defaults` included, typed `unknown` (it's shorthand for `getEditor()?.options`). It's how a value differs per editor, which a factory argument can't do ([the options recipe](per-editor.md#recipe-per-instance-options-and-the-factory-closure-trap))                                                                                                                                                                                                                                                                            |
| `getEditor`             | This editor's `EditorContext` for the plugin that owns your kind, undefined only in a bare test harness. Its `computeInlineContent` reads the syntax this editor draws. If your helper's reader defaults to the free `computeInlineContent`, pass it `getEditor()?.computeInlineContent` and it still parses in a bare harness (the bundled toc and footnotes do exactly this)                                                                                                                                                                                                                    |
| `captureScrollPosition` | Your component is about to swap its view for one of a different height (a tall diagram for its short source card) and the reader is scrolled right at it. Call it before the swap, await what it hands back after, and the page stays where the reader left it instead of clamping to the shorter layout in between                                                                                                                                                                                                                                                                               |
| `openDraft`             | Your component holds an edit outside the document, like a textarea's text. It's `EditorContext.openDraft`, passed through so a component needs no context ([What your own editing surface has to do](render-primary.md#what-your-own-editing-surface-has-to-do))                                                                                                                                                                                                                                                                                                                                  |

```ts
const { updateOwnMetadata, getPresentationMode, getTheme, getOptions, captureScrollPosition } =
	createContainerBlock(deps);
updateOwnMetadata({ name: 'debunked' }); // one undo entry; rebuildRaw re-emits the opener line as :::debunked
updateOwnMetadata({ open: false }, { caret: { path: [0], offset: 0 } }); // ...and the caret lands on child 0's start
getPresentationMode(); // 'source'
getTheme(); // 'dark'
getOptions(); // your defaults with this editor's { plugin, options } entry merged over them
const restore = captureScrollPosition(); // before the swap...
editing = true;
await restore(); // ...and after; a no-op when nothing moved
```

One more dep, for a container whose first line starts with a marker the way a list item's `- ` does (a footnote definition's `[^label]: `, say): **`getAmbientPrefix`**. Its first child paints that prefix as a dimmed, read-only run before its own bytes, and the caret skips it the way it skips a list marker.

- Return a string, read live, so a marker derived from metadata re-renders after an edit.
- Or return `{ text, interactive }` to make ranges of it clickable. Each range gets its own span, class and click handler (that's how a footnote definition's `[^label]` takes the click back to its reference).
- A range can also carry a role, a `label`, and a tab stop (`focusable`), together with the `onActivate` that Enter and Space run. Decide `focusable` by mode: a tab stop inside an editable block gets in the caret's way, so the footnote marker only takes one in reading mode.

## Wire it into a page

Pass the plugin to the editor's `plugins` prop. It installs before the seed parses, so `:::conspiracy` resolves to your kind:

```svelte
<script module lang="ts">
	import { conspiracyPlugin } from './conspiracy-kind';

	const plugins = [conspiracyPlugin()];
</script>

<script lang="ts">
	import { Editor } from '@voithos-labs/aragonite';
	import '@voithos-labs/aragonite/styles/editor-theme.css';

	const SEED =
		':::conspiracy Birds are government drones\nThe quickstart parrot has danced since section one and never once eaten.\n:::\n';
	let editor = $state();
</script>

<div class="aragonite-editor-theme" data-editor-theme="light">
	<Editor bind:this={editor} source={SEED} {plugins} theme="light" />
</div>
```

The chords are live (a **chord** is a key combination, written `Mod+7` where `Mod` is Ctrl, or Cmd on a Mac). Focus the box, press `Mod+8` to debunk the theory (the string comes down and the stamp lands) and `Mod+7` to allege it again, then read `editor.getSource()` back and watch the opener line flip between the two names:

```ts
editor.getSource();
// ':::conspiracy Birds are government drones\nThe quickstart parrot has danced since section one and never once eaten.\n:::\n'
// ...press Mod+8...
editor.getSource();
// ':::debunked Birds are government drones\nThe quickstart parrot has danced since section one and never once eaten.\n:::\n'
```

The flip is one undoable edit, so undo un-debunks it, which is how conspiracies work anyway. And because the verdict lives in the bytes, a debunked conspiracy stays debunked across a reload.

The wrapper and the two `light`s are there because the editor paints no background of its own. A fresh app's page is white, so the built-in chrome (the wrapper's attribute) and the editor's own surfaces (the prop) both have to say so; on a dark page, both say `dark`, or nothing. [consumer-guide.md](../consumer-guide.md)'s theming section explains the two tiers.

Want a collapse toggle? Give `reservedChrome` an `isCollapsed` probe over the node, and every focus walk, merge, and windowing decision (a collapsed body stays unmounted) reads that one declaration. Add `expandPatch` beside it, returning the metadata patch that opens the node, and a reveal into the collapsed body (a table-of-contents entry, a search match) opens the container first and commits it as one undoable edit. Without it, such a reveal has nowhere to land and reports that it didn't.

![A conspiracy, debunked on camera](./conspiracy.gif)

## The closure block

`closure` is a required field on every registration: the kind's written answer to each cross-cutting editor system, so a new kind can't ship silently broken under a subsystem nobody asked about. Each of the nine `ClosureColumn`s (`roundTrip`, `focus`, `mergeBackspace`, `selectionPaint`, `searchPaint`, `reorder`, `undo`, `clipboard`, `simOracle`) takes a `ClosureCell`:

- `{ mode: 'implemented', via }`: a real mechanism you can name (a `rebuildRaw`, a keymap command, `measurePartialRects`).
- `{ mode: 'inherit-default' }`: the generic editor behaviour, nothing kind-specific.
- `{ mode: 'not-supported', reason }`: the subsystem is structurally absent, so name the degradation.

The type does the nagging: a missing column or a missing block is a compile error. Four coherence rules are checked too, by a dev-build warning when an editor mounts. Nothing throws, and a production build or a headless test (no editor mounted) never checks them:

1. A container can't declare `roundTrip: inherit-default`; its `rebuildRaw` is the mechanism.
2. A `not-mergeable` kind can't declare `mergeBackspace: inherit-default`; it has no default merge to inherit.
3. A cell claiming the focus-then-delete model (a `focus` or `mergeBackspace` `via` saying `focus-then-delete` or `a second press deletes`) must be backed by `blockFocus: 'whole-block'`.
4. A kind declaring `reservedChrome` can't leave `clipboard: inherit-default`; the chrome bytes live in the container's own raw, so the default byte slice is wrong for it.

**Name a mechanism your own kind carries.** `implemented` needs a `via` you can point at: your component, your `rebuildRaw`, your test. Never an internal editor mechanism you don't own. A cell you can't name honestly is `inherit-default` or `not-supported`, never an invented capability.

**Simple leaves: `simpleLeafClosure`.** A not-mergeable, childless, source-editable leaf built on `createEditableLeaf` answers five columns the same way every such leaf does: its round-trip inherits the default serialize, its `not-mergeable` merge is a focus move, its selection paints through `measurePartialRects`, it reorders by whole-block drag, and its clipboard is a byte slice. `simpleLeafClosure` bakes those five and asks only for the four your component actually determines, which are `focus`, `searchPaint`, `undo`, `simOracle`:

```ts
closure: simpleLeafClosure({
	focus: { mode: 'implemented', via: 'createEditableLeaf render-primary reveal' },
	searchPaint: {
		mode: 'implemented',
		via: 'source raw scanned; the rendered view carries no measurable text, so a match is counted but not painted'
	},
	undo: { mode: 'implemented', via: 'render-primary: the reveal, edit, blur cycle commits one undo entry' },
	simOracle: { mode: 'implemented', via: 'my-kind e2e' }
});
```

Omitting one of the four is a compile error, and a baked column stays overridable (a render-primary leaf scoping its `selectionPaint` to the revealed state, say). What the preset fills in for you:

```ts
simpleLeafClosure({ focus, searchPaint, undo, simOracle });
// returns those four plus the five baked cells:
//   roundTrip: { mode: 'inherit-default' }
//   mergeBackspace: implemented (not-mergeable: Backspace at the edge moves focus, never concatenates)
//   selectionPaint: implemented (measurePartialRects, raw offsets)
//   reorder: implemented (whole-block drag reorder through the parent BlockList)
//   clipboard: { mode: 'inherit-default' }
```

**`simOracle` is the cell most authors hesitate over**, because it's about aragonite's own simulation suite (a repo script that drives the editor through random edits and checks the document never goes wrong), not a kit you run. The question is still about your **mechanism**. The example above is `implemented` because that kind has its own end-to-end tests driving it under those checks. A plugin with no simulation machinery of its own writes `inherit-default`, the honest answer for most plugins: it claims no coverage, just that your kind meets the simulation the way the generic behaviour does.

**Containers with real children: `containerClosure`.** A container of real child blocks answers four columns the same structural way (its children are the paint and search surfaces, it reorders whole-block through the parent `BlockList`, and it holds no clipboard anchor of its own), and its `roundTrip` is always `implemented`, because its `rebuildRaw` is the mechanism. `containerClosure` bakes those, asking for the `roundTripVia` string plus the four the container determines: `focus`, `mergeBackspace`, `undo`, `simOracle`. Here's the walkthrough's closure rewritten on it:

```ts
closure: containerClosure({
	roundTripVia: 'container contract=opaque, rebuildConspiracyRaw',
	focus: { mode: 'implemented', via: 'focus walks to the title chrome / first body child' },
	mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
	undo: {
		mode: 'implemented',
		via: 'updateMetadata; the verdict flip commits as one undo entry'
	},
	// The conspiracy declares reservedChrome, so coherence rule four warns about the baked
	// clipboard cell; a container without reserved chrome just leaves this out.
	clipboard: {
		mode: 'implemented',
		via: 'byte-slice copy; a slice touching the title re-emits the conspiracy around the collected body'
	},
	simOracle: { mode: 'inherit-default' }
});
```

A container that synthesizes content on copy overrides the baked `clipboard` cell the same way; one that adds an indent gesture overrides the baked `reorder` cell. Whole-block-focus opaque leaves and any novel tier still hand-write the full nine, since no preset knows what they do.
