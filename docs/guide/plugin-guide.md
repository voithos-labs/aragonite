# Plugin Author Guide

This guide is for teaching the editor your own block or inline content. All of the authoring API comes from one import, `@voithos-labs/aragonite/plugin`. The package root, `@voithos-labs/aragonite`, is the embedding side, what a host app mounts the editor with (you'll borrow its `installPlugins` once or twice), and your test suite imports from `@voithos-labs/aragonite/testing`.

Four neighbouring docs carry what this one doesn't:

- [directives.md](directives.md): the `:::name` directive grammar the [container walkthrough](plugin-guide/container-walkthrough.md) builds on.
- [consumer-guide.md](consumer-guide.md): embedding, theming, and events, the host app's side.
- [plugin-api.md](plugin-api.md): a catalog of every export named anywhere below, for checking a name is real.
- [plugin-testing.md](plugin-testing.md): testing what you build.

This page is the first read: [a working plugin in fifteen minutes](#the-first-fifteen-minutes), then [what a plugin is](#what-a-plugin-is), [views](#views-what-you-read-what-you-own), and [what a plugin may and may not do](#what-a-plugin-may-and-may-not-do). The recipes live on pages of their own, one job each, so open whichever matches what you're building:

| Page                                                                                         | Reach for it when                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [One process, many editors](plugin-guide/per-editor.md)                                      | Your plugin keeps state per editor, listens for edits, or takes options that differ between two editors on one page                                  |
| [Walkthrough: a `:::conspiracy` container end to end](plugin-guide/container-walkthrough.md) | Your block holds other blocks (a callout, a box with a title), or you're filling in a descriptor's `closure` cells. It's the biggest worked example  |
| [Teaching the parser](plugin-guide/parser.md)                                                | Your syntax needs an opener of its own: its place among the built-ins, a construct that spans lines, one that only counts at the top of the document |
| [Editable-content tiers](plugin-guide/editable-content.md)                                   | You're picking how your block hosts editable content, or building a text block on `createEditableLeaf` (block math's shape)                          |
| [Recipe: a render-primary block](plugin-guide/render-primary.md)                             | Your block is a picture (a diagram, a chart) that's edited through your own UI                                                                       |
| [Presentation modes](plugin-guide/presentation-modes.md)                                     | Your block has to render right in reading, preview, or live mode, or owns a button that should go inert there                                        |
| [Recipe: reading the document above your block](plugin-guide/reading-the-document.md)        | Your block is built from the rest of the document, like a table of contents                                                                          |
| [Inline kinds](plugin-guide/inline-kinds.md)                                                 | Your syntax lives mid-paragraph (`:shortcode:`, `[^1]`, `$x$`)                                                                                       |
| [Decorations](plugin-guide/decorations.md)                                                   | You want to paint over content you don't own: highlights, ghost text, badges                                                                         |
| [Block commands](plugin-guide/commands.md)                                                   | Your block (or the whole editor) needs keyboard shortcuts, commands, or rows in the right-click menu                                                 |
| [Paste transforms](plugin-guide/paste-transforms.md)                                         | Pasted text should turn into something else before it parses                                                                                         |
| [Recipe: a kind only a menu creates](plugin-guide/menu-only-kinds.md)                        | A block should come from a menu instead of being typed, and still survive a reload                                                                   |

## The first fifteen minutes

All three import paths come with `@voithos-labs/aragonite` itself, so there's nothing else to install.

The plugin we're about to build is an homage to `curl parrot.live`: a line that starts with `%%parrot` renders as an animated ASCII party parrot, and any text after the marker becomes the parrot's caption.

Before the code, two terms everything below leans on.

A **kind** is aragonite's word for a block type. Paragraph is a kind, fenced code is a kind, the parrot is about to be one.

A block's **raw** is its exact source bytes, markers included. The editor saves a document by joining raws (plus the blank lines kept between blocks) and nothing else, so whatever your plugin writes into that field is exactly what lands in the user's file.

**Declare and describe.** Registering a kind is four calls. The rest of the guide keeps coming back to them, and so will you. Here's each one properly:

- **`declarePluginKind(name)`** creates a new kind and returns it (a name that's already taken throws). Every other call here takes that return value, and the type system won't accept the bare string in its place. A module that didn't create the kind recovers it with `declaredPluginKind(name)`, which throws for an undeclared name (a typo, say) rather than registering against a kind that doesn't exist.
- **`registerBlockKind(kind, descriptor)`** describes how the kind behaves: does it merge, is it editable, does it host inline content, where can a caret sit beside it, and how it answers every cross-cutting editor system (the `closure` field). A leaf needs only what the sample below fills.
- **`registerBlockOpener(kind, opener)`** teaches the parser to recognize the syntax. An **opener** is the part of the parser that spots the line a block starts with: you give it a `priority` (its place in the dispatch order), an `interruptsParagraph` predicate (or `false`, for never), and a `tryOpen` that claims lines or declines. [Teaching the parser](plugin-guide/parser.md#teaching-the-parser) is its full story.
- **`definePluginBlock({ name, kind, component, register })`** packages the lot as one installable unit: it runs your `register` step, then binds the component to the kind. It's the one-kind shortcut over the general `definePlugin` ([The plugin unit](#the-plugin-unit)), and takes the same optional `defaults` and `parseOptions`. Its `register` gets no setup context, though, so a plugin that needs per-editor work (`onEditor`) uses `definePlugin`.

The first one in action (a kind is a plain string underneath, with a type brand on top):

```ts
const parrot = declarePluginKind('parrot'); // 'parrot', branded as a kind
declaredPluginKind('parrot') === parrot; // true, same brand
declaredPluginKind('parot'); // throws: "parot" has not been declared
declarePluginKind('paragraph'); // throws: "paragraph" is a built-in BlockKind
```

And all four together, which is the whole plugin minus its component:

```ts
// parrot-plugin.ts
import {
	caretOffsetAtPoint,
	declarePluginKind,
	definePluginBlock,
	registerBlockKind,
	registerBlockOpener,
	simpleLeafClosure,
	type CaretTarget,
	type EditorPlugin
} from '@voithos-labs/aragonite/plugin';
import ParrotBlock from './ParrotBlock.svelte';

export const PARROT = 'parrot';

/** Where a click in the block puts the caret. The caption says where it starts in the source,
 *  so an offset in it sits that far along; the shown source is the source itself. */
function parrotCaretAtPoint(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): CaretTarget | null {
	const source = blockEl.querySelector<HTMLElement>('.parrot-source');
	const view = source ?? blockEl.querySelector<HTMLElement>('.parrot-caption');
	if (!view) return null;
	const offset = caretOffsetAtPoint(view, clientX, clientY) ?? 0;
	return { path: [], offset: source ? offset : offset + Number(view.dataset.captionStart) };
}

function registerParrotBlock(): void {
	const parrot = declarePluginKind(PARROT);

	registerBlockKind(parrot, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		conformanceFixture: '%%parrot party responsibly\n',
		caretTargetAtPoint: parrotCaretAtPoint,
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'createEditableLeaf render-primary reveal' },
			searchPaint: { mode: 'implemented', via: 'source raw scanned, matches painted as marks' },
			undo: { mode: 'implemented', via: 'render-primary: one commit when the caret leaves' },
			simOracle: { mode: 'inherit-default' }
		})
	});

	registerBlockOpener(parrot, {
		priority: 25,
		interruptsParagraph: (text) => text.startsWith('%%parrot'),
		tryOpen(ctx) {
			if (!ctx.line.text.startsWith('%%parrot')) return null;
			const node = { kind: parrot, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw };
			return { node, consumed: 1 };
		}
	});
}

export function parrotPlugin(): EditorPlugin {
	return definePluginBlock({
		name: 'parrot',
		kind: PARROT,
		component: ParrotBlock,
		register: registerParrotBlock
	});
}
```

The object you handed `registerBlockKind` is the kind's **descriptor**. Most of its fields read as they sound. Five don't:

- `gapEdges` is required so a caret can always reach the space beside your block ([Editable-content tiers](plugin-guide/editable-content.md#editable-content-tiers) has the full story).
- `closure` is required so every cross-cutting editor system (undo, search, selection, and the rest) gets a written answer from your kind. [The closure block](plugin-guide/container-walkthrough.md#the-closure-block) explains every cell.
- `conformanceFixture` is optional, but the conformance kits ([plugin-testing.md](plugin-testing.md)) need it: it's the Markdown their headless checks parse and round-trip. Without one, the kind checkup reports those cells `boundary` (unchecked), and the container checkup fails outright.
- `pageRole` is optional, and it's how your block reads on the page. Say `'prose'` if it reads as part of the text around it, the way a quote or a note does. A prose block gets no drag handle, and right-clicking its text gives the clipboard rows. Leave it out and your block is an object someone picks up whole, with its own handle and menu, which is what the parrot is. (If your block's text would make a silly label on the drag ghost, a formula's source say, give it a `dragLabel` too.)
- `caretTargetAtPoint` is optional too: where a click inside your block puts the caret. Leave it out and a click anywhere on the parrot shows the source with the caret on its first byte, which is a letdown when you clicked halfway into the caption.

The parrot's answer is two steps. The caption and the source line are different strings, and `caretOffsetAtPoint` does the pixel half: hand it one of your own elements and the click, and it gives back the character offset nearest that point, clamped into the element's box, so a click on the bird above the caption still lands on the character under it. The arithmetic between the two strings is yours. The parrot's caption is its line minus the marker and the whitespace around the text, so the component works out where the caption starts in the source, puts that on the caption element as `data-caption-start`, and the hook adds it to the offset. (Hardcoding `'%%parrot '.length` works right up until someone types two spaces.)

On the opener, `priority` decides where you sit in the built-in openers' dispatch order ([Opener priority](plugin-guide/parser.md#opener-priority)) and `consumed` is the number of lines you claimed ([What an opener returns](plugin-guide/parser.md#what-an-opener-returns)).

**Render.** The parrot is a **leaf**, a block with no child blocks (a container holds other blocks; [the walkthrough](plugin-guide/container-walkthrough.md) builds one). `createEditableLeaf` hands a leaf a native caret, IME composition (typing through an input method, the way Chinese or Japanese is typed), undo, selection, and clipboard. The parrot asks for it in `render-primary` mode, where the caption is what you see at rest and the source line only shows while the caret is in the block. The bird itself is ordinary **chrome** (a block's furniture, as opposed to its content): every frame stacked in one `<pre>` that CSS scrolls a frame at a time.

```svelte
<!-- ParrotBlock.svelte -->
<script lang="ts">
	import { createEditableLeaf, trimWhitespace, type NodeView } from '@voithos-labs/aragonite/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();
	let sourceEl: HTMLDivElement | undefined = $state();
	let revealed = $state(false);

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => sourceEl ?? null,
		mode: 'render-primary',
		singleLine: true,
		isRevealed: () => revealed,
		setRevealed: (next) => (revealed = next)
	});

	// Frames 0 and 5 of the canonical ten. The full dance is in ./plugin-guide/parrot-frames.md;
	// this is a guide, not an aviary.
	const FRAMES = [
		String.raw`
                         .cccc;;cc;';c.
                      .,:dkdc:;;:c:,:d:.
                     .loc'.,cc::c:::,..;:.
                   .cl;....;dkdccc::,...c;
                  .c:,';:'..ckc',;::;....;c.
                .c:'.,dkkoc:ok:;llllc,,c,';:.
               .;c,';okkkkkkkk:;lllll,:kd;.;:,.
               co..:kkkkkkkkkk:;llllc':kkc..oNc
             .cl;.,oxkkkkkkkkkc,:cll;,okkc'.cO;
             ;k:..ckkkkkkkkkkkl..,;,.;xkko:',l'
            .,...';dkkkkkkkkkkd;.....ckkkl'.cO;
         .,,:,.;oo:ckkkkkkkkkkkdoc;;cdkkkc..cd,
      .cclo;,ccdkkl;llccdkkkkkkkkkkkkkkkd,.c;
     .lol:;;okkkkkxooc::coodkkkkkkkkkkkko'.oc
   .c:'..lkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkd,.oc
  .lo;,:cdkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkd,.c;
,dx:..;lllllllllllllllllllllllllllllllllc'...
cNO;........................................
`,
		String.raw`

           .,,,,,,,,,.
         .ckKxodooxOOdcc.
      .cclooc'....';;cool.
     .loc;;;;clllllc;;;;;:;,.
   .c:'.,okd;;cdo:::::cl,..oc
  .:o;';okkx;';;,';::;'....,:,.
  co..ckkkkkddkc,cclll;.,c:,:o:.
  co..ckkkkkkkk:,cllll;.:kkd,.':c.
.,:;.,okkkkkkkk:,cclll;.ckkkdl;;o:.
cNo..ckkkkkkkkko,.;loc,.ckkkkkc..oc
,dd;.:kkkkkkkkkx;..;:,.'lkkkkko,.:,
  ;:.ckkkkkkkkkkc.....;ldkkkkkk:.,'
,dc..'okkkkkkkkkxoc;;cxkkkkkkkkc..,;,.
kNo..':lllllldkkkkkkkkkkkkkkkkkdcc,.;l.
KOc,c;''''''';lldkkkkkkkkkkkkkkkkkc..;lc.
xx:':;;;;,.,,...,;;cllllllllllllllc;'.;od,
cNo.....................................oc
`
	];
	// One strip the CSS scrolls a frame at a time. The closing newline matters: a `pre`
	// drops a trailing blank line, and a strip a row short steps a fraction off every frame.
	const REEL = FRAMES.join('\n') + '\n';
	// The clip window's height, which is why every frame has to be the same number of rows.
	const FRAME_ROWS = FRAMES[0].split('\n').length;

	// The caption is the rest of the marker line, trimmed, and `start` is where it sits in the
	// source: `parrotCaretAtPoint` reads it off the element to map a press back to a byte.
	function parrotCaption(raw: string): { text: string; start: number } {
		const rest = raw.slice('%%parrot'.length);
		const text = trimWhitespace(rest);
		return { text, start: '%%parrot'.length + rest.indexOf(text) };
	}

	const caption = $derived(parrotCaption(node.raw));

	export const blockApi = leaf.blockApi;
</script>

<div
	class="parrot-block"
	{...leaf.renderProps}
	style:--parrot-rows={FRAME_ROWS}
	style:--parrot-frames={FRAMES.length}
>
	<div class="parrot" aria-hidden="true"><pre class="parrot-reel">{REEL}</pre></div>
	{#if revealed}
		<div
			bind:this={sourceEl}
			{...leaf.surfaceProps}
			class="parrot-source"
			aria-label="Party parrot source"
		></div>
	{:else}
		<div
			class="parrot-caption"
			data-caption-start={caption.start}
			role="button"
			tabindex="-1"
			aria-label="Party parrot caption (click to edit)"
		>
			{caption.text}
		</div>
	{/if}
</div>

<style>
	.parrot {
		/* a terminal cell is about twice as tall as it is wide; prose line-height stretches the bird */
		font-size: 1.1em;
		line-height: 1.1;
		letter-spacing: 0.05em;
		/* one frame tall, in the reel's own rows so a step lands on the next frame exactly; the
		   em line is the same height for engines without lh (Safari before 16.4) */
		height: calc(var(--parrot-rows) * 1.1em);
		height: calc(var(--parrot-rows) * 1lh);
		/* wider than a phone column, and the editor root pans if it isn't contained; the bar
		   would sit across the bird, which is decoration rather than a pane to scroll */
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		/* decoration, not content: every frame is in the DOM and none of them belong in a copy */
		user-select: none;
		animation: parrot-hue 0.49s step-end infinite;
	}
	.parrot-reel {
		/* type and rhythm come from the box above, so its `lh` is this reel's row exactly */
		margin: 0;
		animation-name: parrot-reel;
		animation-duration: calc(var(--parrot-frames) * 70ms);
		animation-timing-function: steps(var(--parrot-frames));
		animation-iteration-count: infinite;
	}
	@keyframes parrot-reel {
		to {
			transform: translateY(-100%);
		}
	}
	/* parrot.live's seven, stepped rather than blended so every run of the dance looks the same */
	@keyframes parrot-hue {
		0% {
			color: #ff5f5f;
		}
		14.286% {
			color: #ffc83d;
		}
		28.571% {
			color: #3fd97a;
		}
		42.857% {
			color: #5aa9ff;
		}
		57.143% {
			color: #ff6ad5;
		}
		71.429% {
			color: #3fd3d3;
		}
		85.714% {
			color: var(--color-text-primary, currentColor);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.parrot,
		.parrot-reel {
			animation: none;
		}
	}
	.parrot-caption {
		margin: 0.25em 0 0;
		font-weight: 700;
		cursor: text;
	}
	.parrot-source {
		/* the bytes, dimmed the way the editor dims a marker */
		opacity: 0.55;
		font-family: monospace;
		font-size: 0.9em;
		outline: none;
	}
</style>
```

The component has an editing half and a parrot half, and the parrot half never touches the editor.

The editing half is the factory call, the `revealed` flag, two spreads, and one export:

- `revealed` is yours. The factory flips it through `setRevealed` (on when a click or an arrow lands in the block, off when the caret leaves), and the `{#if}` swaps the two views on it.
- `surfaceProps` goes on the source line. `renderProps` goes on the block wrapper, so a click anywhere in the block reveals, bird included, and lands where `caretTargetAtPoint` said. Spread both; a folded view that takes the click but not the keys swallows undo while it holds focus.
- `blockApi` is everything the editor calls on your block (focus, the caret reads, and so on). Forget the export and the component doesn't typecheck where it's registered.
- The commit happens when the caret leaves, not per keystroke. Reveal, type, arrow out: one undo entry, and the caption follows the new raw.
- `singleLine: true` says the bytes are one line (the opener claims exactly one), so Enter ends the block instead of typing a newline nothing could show you: whatever sits after the caret becomes a paragraph below, and the caret goes with it, same as in a heading. A leaf whose bytes can span lines leaves the flag off and gives its source element `white-space: pre-wrap` instead, for a reason [The editable leaf](plugin-guide/editable-content.md#the-editable-leaf) explains.

The parrot half is the `<pre>`, its CSS, and the caption reading straight off `node.raw`. No script runs per frame, and `prefers-reduced-motion` parks the bird on its first frame for free. It does have to do one thing, like every block wider than the text column: scroll inside your own box (`overflow-x: auto`, same as a code block or a table). The editor root scrolls, so an uncontained block pans the whole page sideways and takes the prose with it.

And the full ten-frame dance? Go see [parrot-frames.md](plugin-guide/parrot-frames.md) for the actual frames; not gonna put them all here.

**Install.** Pass the unit to the editor's `plugins` prop: build the array once at module scope, then `<Editor {source} {plugins} />` ([The plugin unit](#the-plugin-unit) shows the wiring and why module scope matters). This exact parrot also ships in the package, as `@voithos-labs/aragonite/plugins/parrot`, so if you're building your own, rename it before the two meet. A `%%parrot` line now parses to your kind (`parse` is on the plugin path too, if you want to see it outside the editor):

```ts
parse('%%parrot party responsibly\n').children[0];
// { kind: 'parrot', leadingTrivia: '', raw: '%%parrot party responsibly\n' }
```

It dances through your component.

![The parrot block, mid-party](./plugin-guide/parrot.gif)

**Verify.** Registering a kind enrolls it in the conformance kit, which parses your fixture, round-trips it (parse, serialize, compare the bytes), and checks the closure cells it can reach without a browser against what you claimed.

```ts
import { installPlugins } from '@voithos-labs/aragonite';
import { declaredPluginKind } from '@voithos-labs/aragonite/plugin';
import { resetPluginPlatformForTests, runKindConformance } from '@voithos-labs/aragonite/testing';
import { PARROT, parrotPlugin } from './parrot-plugin';

it('parrot conforms', async () => {
	resetPluginPlatformForTests();
	installPlugins([parrotPlugin()]);
	await runKindConformance(declaredPluginKind(PARROT));
});
```

That's the loop: describe the kind, render it, install it, verify the bytes. Everything after this is the same four moves at more interesting shapes.

## What a plugin is

A plugin teaches the editor a new kind, one that parses, renders, and saves alongside the built-ins. You declare the kind, then wire up to three things:

```
declare a kind ──┬─▶ descriptor   how it merges, its container shape, its keymap
                 ├─▶ component    how it renders and hosts any editable content
                 └─▶ grammar      how source becomes the kind:
                                    a block opener  │  a :::name directive  │  an inline recognizer
```

Each part has a defined absence, which is prob the easiest way to remember what each one is for:

| Part       | It makes the kind       | Leave it out and                                                                                                                                                                           |
| ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| descriptor | behave                  | the kind errors at first use; this one is never optional                                                                                                                                   |
| component  | visible                 | the kind renders as a visible raw-text fallback                                                                                                                                            |
| grammar    | parseable from Markdown | nothing ever parses to the kind, so it doesn't survive a reload ([the menu recipe](plugin-guide/menu-only-kinds.md#recipe-a-kind-only-a-menu-creates) is the route to a kind nobody types) |

### Registration is global, and register-once

A kind is a definition every editor on the page shares, and it's defined exactly once. Registering the same kind, component, or opener twice **throws**, never silently overrides, whether you collided with a built-in or with another plugin. There's no unregister, and the one way to change a kind you registered is `augmentBlockKind`, which merges extra descriptor fields in. (If you've met the browser's `customElements.define`, it's the same model: one definition for the whole page, not one per document.)

Who guarantees a registration runs only once depends on where it runs:

- **Inside a plugin unit** (the installable package the next section defines), `setup` runs at most once per process. Write each `register*` call straight; the unit owns the guarantee.
- **At module scope**, meaning register calls that run when a file is imported, nothing owns the run for you. Guard each call on its probe, the matching is-it-there check: `isBlockKindDeclared`, `isBlockKindRegistered`, `isBlockComponentRegistered`, `isBlockOpenerRegistered`, `isBlockCompleterRegistered`, `isPasteTransformRegistered`, `isLanguageRegistered`, `isDirectiveRegistered`, and `isInlineKindDeclared` for the inline tier.

```ts
isBlockKindDeclared('parrot'); // false on a fresh page
if (!isBlockKindDeclared(PARROT)) registerParrotBlock();
isBlockKindDeclared('parrot'); // true, so a second import of this module skips the register
```

Guard on the probe, never on a module-level `registered` flag: the flag survives `resetPluginPlatformForTests()` and then silently skips the re-registration your next test case needed, which is a fun half hour to spend.

One dev-time softening. Under a dev server a duplicate registration replaces the earlier one with a warning, so hot reload picks up a changed definition (editing a plugin unit's own `definePlugin` still needs a page reload). Production builds and test runs keep the throw.

### The plugin unit

A **plugin unit** is the installable package: a name plus a `setup` that runs your `register*` calls.

**`definePlugin({ name, setup, version?, defaults?, parseOptions? })`**

Validates the unit at definition time (the name is a lowercase first letter followed by letters, digits, and hyphens, and `setup` has to be a function) and returns an `EditorPlugin`. `version` is only a label, printed by the warning when two units share a name. The other two optional fields are for options that can differ per editor: `defaults` is where every editor's options start, and `parseOptions` checks what an editor passes ([the options recipe](plugin-guide/per-editor.md#recipe-per-instance-options-and-the-factory-closure-trap) has both).

By convention you export a **factory**, meaning `export function myPlugin(deps?)` returns the unit. The factory's argument is where a **process-global dependency** comes in (a render engine, say, which is the same for every editor), and it can fill your `defaults` too. What it can't do is give two editors different values; that takes a different path ([One process, many editors](plugin-guide/per-editor.md#one-process-many-editors)).

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

Install by passing units to the editor's **`plugins` prop**, set once at mount, before the first parse:

```svelte
<script module lang="ts">
	import { myPlugin } from './my-plugin';

	// Build the array once at module scope, not inline in the markup: an inline
	// `plugins={[myPlugin()]}` builds a fresh unit for every editor that mounts, and each
	// one after the first trips a harmless first-wins dev warning.
	const plugins = [myPlugin()];
</script>

<Editor {source} {plugins} />
```

**A plugin installs once per process, keyed by name.** The consequences, one per line:

- Passing the same unit again no-ops.
- Passing a _different_ unit under a name already installed keeps the first and warns in a dev build, naming the loser as `name@version` when it carries one.
- Units install in array order.
- A `setup` that throws stays failed. The throw comes out of the install (so out of the editor's mount), the units after it in the array don't install, and a later attempt rethrows and tells you to reload, because a partial setup can't re-run against the register-once registries.
- Two editors passing the same plugin share one registration, but their _configuration_ isn't shared: an editor may pass `{ plugin, options }` and the plugin reads its own `options` off each instance ([the options recipe](plugin-guide/per-editor.md#recipe-per-instance-options-and-the-factory-closure-trap)).
- **The prop is also the enablement set.** Registration is process-wide, but an editor only runs the plugins its own array lists. A plugin another editor on the page installed but this one left out does nothing here: its syntax reads as the plain Markdown it is, and its `onEditor` hooks, global commands, completers and paste transforms never run. An editor with no `plugins` prop at all (or an empty array) is the exception: it activates everything installed.

Two smaller routes. For an editor-less `parse()` pipeline that needs the grammar live without mounting `<Editor>`, call `installPlugins(units)` from `@voithos-labs/aragonite`, with the same once-per-process semantics. And `isPluginInstalled(name)` probes an install, for the rare setup that has to branch on it; the prop and `installPlugins` are already safe to call twice, and most people never reach for it.

```ts
import { installPlugins } from '@voithos-labs/aragonite';
import { isPluginInstalled } from '@voithos-labs/aragonite/plugin';

const parrot = parrotPlugin();
isPluginInstalled('parrot'); // false
installPlugins([parrot]);
isPluginInstalled('parrot'); // true
installPlugins([parrot]); // no-op (a fresh parrotPlugin() here would no-op too, with a dev warning)
```

### What is stable, what is not

The API is going to freeze, and you deserve to know which half of it has settled already.

- **The registration base, settled.** Kind declaration, descriptor/component/opener registration, typed per-node metadata, and the probes above. The model won't change: which calls exist, that each registers once, what a kind is. The exact shapes those calls take (a descriptor field, what an opener returns) can still change before the freeze, and freeze with everything else at the public release.
- **Pre-freeze, still moving.** Everything else: the plugin unit itself, the authoring tiers (container, editable leaf, inline, directive), the grammar hooks, paste transforms, and the view surfaces (decorations, rects, selection geometry). The [API reference](plugin-api.md) labels each such section _(pre-freeze / unstable)_, and they all freeze at the public release.

After the freeze the version number carries the promise: a breaking change to a frozen surface rides a **major** version, and additive needs ship as **minors**.

## Views: what you read, what you own

Every surface that hands your plugin a node to **read** types it as a view: `NodeView` for a block node, `DocumentView` for the root document. A view is deep-readonly on the serialized bytes: a byte write through one is a compile error. "Never mutate the tree from the view layer" isn't a rule you have to remember.

The readonly covers `raw`, `kind`, `metadata` (the typed per-node data a plugin stores beside the bytes), trivia (the preserved blank-line bytes around a block, the `leadingTrivia` your parrot opener copied), and the children structure.

`CstNode` and `Document` are the shapes a plugin **constructs and owns**: an opener or directive factory builds a `CstNode`, and `rebuildRaw` receives one to write. A document you parsed yourself is mutable, and feeds every view-typed parameter with no conversion.

Mutating the **live** tree goes through the supported commit paths: `updateOwnMetadata` (defined in the walkthrough), `rebuildRaw` (just below), and [Block commands](plugin-guide/commands.md#block-commands). A **commit** is an edit the editor records as one undoable step. Never write through a view, and don't cast a view back to `CstNode` either: undo snapshots share nodes with the live tree, so a stray write through a cast corrupts history.

### `rebuildRaw`, the write hook

You'll meet it again and again in this guide, so here's the fuller treatment.

**`rebuildRaw(node, changed?)`**

The hook a container kind declares so the editor can recompute the container's raw from its children and metadata after an edit. It receives the **owned** `CstNode` and writes the recomputed bytes onto it. Ignoring the second argument and re-deriving the whole raw is always correct, and it's what most rebuilders should do (it's also what every rebuilder does when the argument is absent).

```ts
// A fence around its children, nothing else in the raw. serializeChildren joins each
// child's leadingTrivia + raw, the same join a save runs.
function rebuildBoxRaw(node: CstNode): void {
	node.raw = `:::box\n${serializeChildren(node.children ?? [])}:::\n`;
}
// the editor calls it after a child edit; node.raw now reads ':::box\nedited line\n:::\n'
```

A directive container with a title line doesn't hand-write this at all: `createDirectiveRebuild` in the walkthrough does the same job with the fence bytes, the line ending and the title handled for you.

The optional `changed` argument (`ChildRawChange`, shaped `{ index, previousRaw }`) is a performance opt-in for a container big enough that re-reading every child on every keystroke costs real time (the built-in list and quote use it). It names the one child whose raw just changed and the bytes it held before, so you can re-emit that child's region alone. If you take it:

- Your kind has to know exactly where each child's bytes sit inside its raw.
- Keep those offsets in `node.childSpans` (a start and an end offset per child). It's the one cache the editor clears for you when its own edits move a sibling's bytes, and a span that no longer matches falls back to the full rebuild. Offsets you cache anywhere else are yours to invalidate.
- The conformance kit compares the two paths for your kind, so a fast path that drifts from the full rebuild fails your tests.

## What a plugin may and may not do

**An editor plugin isn't an app plugin.** If you're extending an app that embeds aragonite, that app almost certainly has a plugin layer of its own, and the two own different halves:

| Layer                           | Owns                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **aragonite plugins**           | Anything touching the document or the editing surface: kinds, grammar, decorations, commands over the document, presentation |
| **The embedding app's plugins** | Anything touching the app: ribbon, sidebar, status bar, settings tabs, modals, the command palette UI, the vault, sync       |

Vault-wide indexing sits on the app's side of that line: aragonite hands you the raw material (`getEvents()` and `parse()`) and never the index. It's not simply "editor = view", though. Derived state over the _one_ document you're editing (a table of contents, footnote numbering, the tasks in this note) is an editor plugin's to build, which is why a block component is handed its document ([the document recipe](plugin-guide/reading-the-document.md#recipe-reading-the-document-above-your-block)).

Everything the sections above show is fair game. A plugin **may not**:

- Treat its DOM as authoritative, or mutate the tree from its component. The tree always wins, and the types enforce it: every node a plugin is handed is read-only on its bytes ([Views](#views-what-you-read-what-you-own)).
- Write bytes through a node reference captured before an edit. After any change, read the node back from the tree; the old reference is stale.
- Pass reactive tree state by value across a module boundary. Hand it through a live read instead (a getter, or a `() =>` thunk as the factory deps take).
- Invent merge-role, unwrap, or container-contract values. Those are closed sets.
- Silently override a built-in or another plugin's registration.
- Intercept loading or typing, or rewrite the whole document from a paste. The paste hook sees the clipboard text, never the load path or keystrokes. A whole-document migration goes through the document instead: read `getSource()`, transform the Markdown, and write the editor's `source` prop.

Most of that is enforced by **shape**: the factories never hand you a way to make the disallowed move. The rest is enforced by **dev-mode checks that are stripped from a production build**, so a plugin developed against a production build gets no signal whatsoever. **Develop against a dev build.**

### Misuse outcomes

What each mistake does in each build:

| Misuse                                    | Dev build                                                           | Production build                                    |
| ----------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| `rebuildRaw` writes the wrong bytes       | Warns at edit time, naming the kind                                 | Silent until the bytes surface in a round-trip      |
| A component throws while rendering        | Contained as a failed-block fallback plus an `error` event, by path | Same containment (the boundary ships in production) |
| An opener claims no line (`consumed < 1`) | Warns, naming the kind, and declines the opener                     | Declines the same way, silently; no hang            |
| An opener's `raw` ≠ the lines it consumed | Parse warns, naming the kind                                        | Silent round-trip break                             |
| An opener throws                          | Propagates uncaught (parse runs at init and on every edit)          | Same; uncaught                                      |
