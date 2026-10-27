# React and Vue blocks

Part of the [plugin guide](../plugin-guide.md). It assumes you've met `registerBlockKind` in [the quickstart](../plugin-guide.md#the-first-fifteen-minutes), since this page only swaps out the part that draws the block.

If your app is React or Vue, you can draw a plugin block with your own components. The packages that give you the `<Aragonite>` component, `@voithos-labs/aragonite-react` and `@voithos-labs/aragonite-vue`, each carry a helper that turns a component into a block view: `reactBlockView` and `vueBlockView`. Under the hood they're `defineBlockView` with your component rendered into the element the editor makes for the block, so they run wherever the editor runs, the prebuilt copy a React or Vue app installs included. For the smaller things a plugin draws (an inline widget, a decoration, a menu row) there's `reactView` and `vueView`.

Sections: [a memo in React](#a-memo-in-react) · [what your component gets](#what-your-component-gets) · [a click-to-edit block](#a-click-to-edit-block) · [a block that holds blocks](#a-block-that-holds-blocks) · [a block with its own editing surface](#a-block-with-its-own-editing-surface) · [the same in Vue](#the-same-in-vue) · [widgets, decorations and menu rows](#widgets-decorations-and-menu-rows) · [providers and app context](#providers-and-app-context) · [what the helpers don't do](#what-the-helpers-dont-do)

## A memo in React

A memo here is a line starting `%% `, drawn with a little badge beside its text. The text is ordinary editable text: the editor owns the caret, IME, undo and the clipboard in it, and your component only says where it goes.

```tsx
// memo-view.tsx
import { LeafContent, reactBlockView, type BlockViewProps } from '@voithos-labs/aragonite-react';

function Memo(_: BlockViewProps<'leaf'>) {
	return (
		<>
			<span className="memo-badge">memo</span>
			<LeafContent className="memo-text" />
		</>
	);
}

export const memoView = reactBlockView(Memo, { surface: 'leaf', singleLine: true, className: 'memo' });
```

`memoView` goes in the `view` field of your `registerBlockKind` call, the same slot the quickstart filled with `svelteBlockView(ParrotBlock)`. Everything else in the registration (the opener, the descriptor, the closure) doesn't care what drew the block.

**`reactBlockView(Component, options)`** takes the component and the options `defineBlockView` takes, minus `mount`:

| Option                          | What it does                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface`                       | `'leaf'` (editable text, always shown), `'render-primary'` (a rendered view until a click opens the text) or `'container'` (child blocks)                         |
| `singleLine`                    | Leaf surfaces: the bytes are one line, so Enter ends the block instead of typing a newline                                                                        |
| `renderSource`, `reshapeSource` | Render-primary: draw the shown text as DOM, and put an edited text back in the shape your kind keeps ([the editable leaf](editable-content.md#the-editable-leaf)) |
| `watchDocument`                 | Re-render on every change to the document, not just to this block (a table of contents wants this)                                                                |
| `className`                     | Classes for the element the editor made for the block                                                                                                             |
| `afterInput(text, ctx)`         | Leaf surfaces: hears each change to the shown text once, never mid-composition; on a click-to-edit block that's before anything is committed                      |
| `wrap(block)`                   | Wraps your component, for providers ([below](#providers-and-app-context))                                                                                         |

`<LeafContent>` is the element the editor edits your text in. It renders empty, and it has to stay that way: the editor puts its own text node in there, so your badge, icon or whatever else goes beside it, never inside. It takes the usual HTML attributes plus `as` (`'div'` by default, or `'span'`, `'p'`, `'pre'`).

Two rules make a framework block behave:

- **Style the block's element with `className`, and keep your component's own root margin-free** (a fragment, like the memo, is easiest). The editor measures the element it made as the block, and a margin on a wrapper inside sits outside what the editor measures, so the selection highlight and the drag handle come out a little off.
- **Let `<LeafContent>` and `<BlockChildren>` stay mounted while they're shown.** Showing and hiding `<LeafContent>` is fine (that's how the click-to-edit block below works), but a fresh `key` per render, say, hands the element back and forth, and an element handed back to the editor comes back empty. `<BlockChildren>` stays for the block's whole life, since the editor has no way to take the children back.

## What your component gets

Three props: `state`, `ctx` and, for a click-to-edit block, `draft` ([below](#a-click-to-edit-block)).

`state` is the block as it is right now, and your component re-renders whenever one of these changes:

```ts
state.node; // { kind: 'memo', leadingTrivia: '', raw: '%% buy milk\n' }, read-only
state.path; // [2]: where the block sits in the document
state.presentationMode; // 'source'
state.theme; // 'dark'
state.revealed; // a render-primary block's text is showing; false on the other surfaces
```

On a plain leaf every keystroke commits, so `state.node.raw` changes, and the memo re-renders, once per key. Keep the render cheap.

`ctx` is the editor's side. `ctx.editor` is your plugin's `EditorContext` in the editor drawing the block (its options, its document, its events, the same object the [per-editor recipes](per-editor.md#one-process-many-editors) use). The rest depends on the surface:

| Surface            | `ctx` also has                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `'leaf'`           | `ctx.leaf.reveal(offset?)` to put the caret in the text, `ctx.leaf.commitSource(text)` to replace it as one undo step                                                                                  |
| `'render-primary'` | the same `ctx.leaf` calls                                                                                                                                                                              |
| `'container'`      | `ctx.container.updateOwnMetadata(patch)`, `moveFocusOut(event)`, `captureScrollPosition()` and `openDraft(spec)`, the container helpers the [walkthrough](container-walkthrough.md#the-component) uses |

## A click-to-edit block

A render-primary block shows something rendered (a caption, a formula, a chart) until you click it, then shows its source to edit. This one is a `@@ ` line that shows as a bold label:

```tsx
function Label({ state }: BlockViewProps<'render-primary'>) {
	if (state.revealed) return <LeafContent className="label-source" />;
	return <strong>{state.node.raw.slice('@@ '.length).trim()}</strong>;
}

export const labelView = reactBlockView(Label, {
	surface: 'render-primary',
	singleLine: true,
	className: 'label'
});
```

A click anywhere in the block flips `state.revealed` on, your component swaps in `<LeafContent>`, and the caret lands in the source (at the spot your kind's `caretTargetAtPoint` names, or the first byte without one). Typing edits the source without committing anything; moving the caret out of the block commits the whole edit as one undo step and flips `revealed` back off. So reveal, type, click away, Ctrl+Z, and the old label is back in one go.

Want a live preview while the source is open (block math's side-by-side layout)? That's `draft`: the source as it's typed, before anything commits, and your component re-renders with it on every key. It's null while the block is folded and before the first edit, so fall back to the node:

```tsx
function Label({ state, draft }: BlockViewProps<'render-primary'>) {
	const caption = (draft ?? state.node.raw).slice('@@ '.length).trim();
	if (!state.revealed) return <strong>{caption}</strong>;
	return (
		<>
			<LeafContent className="label-source" />
			<em>{caption}</em>
		</>
	);
}
```

## A block that holds blocks

A container's children are real document blocks: the editor mounts them, windows them, and runs selection, undo and everything else through them. You say where they go with `<BlockChildren>`:

```tsx
function Box(_: BlockViewProps<'container'>) {
	return (
		<>
			<span className="box-badge">box</span>
			<BlockChildren className="box-children" />
		</>
	);
}

export const boxView = reactBlockView(Box, { surface: 'container', className: 'box' });
```

`<BlockChildren>` renders empty, like `<LeafContent>`, and the children land in it, so your chrome goes beside it. The kind itself is the container from [the walkthrough](container-walkthrough.md#the-registration-module): its registration doesn't change, only its `view` does.

## A block with its own editing surface

Some blocks don't want the editor's text at all. The bundled diagram block shows a picture, and editing it means a `<textarea>` of its own. A block like that has no caret inside it, so the editor focuses it as a whole: arrows stop on it, Backspace next to it focuses it and a second press deletes it, Enter adds a paragraph below, and a character typed at it starts one. You declare that on the kind, `blockFocus: 'whole-block'`, with `container: { contract: 'opaque', rebuildRaw }` since the block keeps its text in metadata (the [render-primary recipe](render-primary.md#recipe-a-render-primary-block) walks through that registration). Then you draw it on the container surface and skip the children.

What your component hands over is the element that takes focus, through `ctx.container.attachFocus`, as a ref. A note shown as text until a double click opens a textarea:

```tsx
function Note({ state, ctx }: BlockViewProps<'container'>) {
	const text = getPluginMetadata<{ text: string }>(state.node)?.text ?? '';
	const [editing, setEditing] = useState(false);
	ctx.container.setCommandHooks({ openEdit: () => setEditing(true) });

	if (editing) {
		return (
			<textarea
				ref={ctx.container.attachFocus}
				autoFocus
				defaultValue={text}
				onBlur={(e) => {
					setEditing(false);
					const next = e.currentTarget.value;
					if (next !== text) void ctx.container.updateOwnMetadata({ text: next });
				}}
			/>
		);
	}
	return (
		<pre ref={ctx.container.attachFocus} tabIndex={-1} onDoubleClick={() => setEditing(true)}>
			{text}
		</pre>
	);
}

export const noteView = reactBlockView(Note, { surface: 'container', className: 'note' });
```

Arrow down onto the note and it's focused whole (a `.note:focus-within` border lights up), double-click and you're typing in the textarea, click away and the text commits as one undo step. A few things make it behave:

- **Attach a focus element for every state**, the textarea included. `attachFocus` keeps its identity for the mount, so passing it straight as a `ref` is fine, and so is React handing it `null` on the way out.
- **DOM focus goes to a hidden editing host**, not to your `<pre>`. The editor puts it in the block's element, next to what you render, since that's where AltGr and IME input arrive. So style focus with `:focus-within`, and give the block's element `position: relative`.
- **Keys in your textarea are the textarea's.** The kind's keymap stays out of it, and so do the editor's chords. To leave by arrow key on the first or last line, call `ctx.container.moveFocusOut(e.nativeEvent)` and `preventDefault` when it returns true.
- **A block command reaches your component through `setCommandHooks`.** Bind a `note.edit` command to `Mod+M` in the kind's keymap, have its handler call `ctx.hooks.openEdit()`, and the key opens the textarea ([commands](commands.md)).

In Vue it's the same component shape, with `:ref="ctx.container.attachFocus"` on the textarea and the `<pre>`.

A container with a marker before its first child's text (a footnote definition's `[^label]: `) gets one more option for that: `ambientPrefix(state, editor)`, beside `surface`, returning the marker ([the container walkthrough](container-walkthrough.md)).

## The same in Vue

`vueBlockView(component, options)` takes the same options, and the package has its own `LeafContent` and `BlockChildren`. The memo, as a single-file component:

```vue
<!-- Memo.vue -->
<script setup lang="ts">
import { LeafContent, type BlockViewProps } from '@voithos-labs/aragonite-vue';

defineProps<BlockViewProps<'leaf'>>();
</script>

<template>
	<span class="memo-badge">memo</span>
	<LeafContent class="memo-text" />
</template>
```

```ts
import { vueBlockView } from '@voithos-labs/aragonite-vue';
import Memo from './Memo.vue';

export const memoView = vueBlockView(Memo, { surface: 'leaf', singleLine: true, className: 'memo' });
```

The click-to-edit label is a `v-if` on `state.revealed`, and the box puts `<BlockChildren>` where its children go:

```vue
<template>
	<LeafContent v-if="state.revealed" class="label-source" />
	<strong v-else>{{ state.node.raw.slice('@@ '.length).trim() }}</strong>
</template>
```

## Widgets, decorations and menu rows

An inline widget, a decoration's widget or badge, and an inline menu row don't take a block view. They take a `PluginView`, the little `(target, props) => { update, destroy }` function from [inline kinds](inline-kinds.md#rendering-it-as-a-widget). `reactView(Component)` makes one from a component, which gets the slot's props as its own. Here's a chip for every `{{name}}` in the text:

```tsx
import { reactView } from '@voithos-labs/aragonite-react';
import type { InlineWidgetComponentProps } from '@voithos-labs/aragonite/plugin';

function Chip({ source }: InlineWidgetComponentProps) {
	return <span className="chip">{source.slice(2, -2)}</span>;
}

registerInlineWidgetKind(chip, {
	isWidget: () => true,
	view: reactView(Chip),
	editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
});
```

`a {{pebble}} chip` now reads as `a [pebble] chip`, with `pebble` drawn by `Chip`, and the caret steps over it as one character. (The `chip` kind and its trigger are the `:shortcode:` recipe from that page with `{` as the trigger.)

The component re-renders on every `update` with the slot's new props (typing before the chip moves its `inline.start`, say), and its root unmounts when the slot drops it. There's no per-prop tracking like `svelteView` has, so keep the render cheap.

Vue is `vueView(component)`, and it hands the component only the props it declares, so the slot's other props (a widget gets a handful of functions, too) don't land on your root element as attributes. A badge on the first block, as a single-file component:

```vue
<!-- Pin.vue -->
<script setup lang="ts">
import type { Decoration } from '@voithos-labs/aragonite/plugin';

defineProps<{ decoration: Decoration }>();
</script>

<template>
	<span class="pin">pinned</span>
</template>
```

```ts
const pin = vueView(Pin, { app });
editor.decorations.addSource({
	name: 'pins',
	provide: () => [{ type: 'block', path: [0], badge: { view: pin } }]
});
```

The first block gets a `pinned` badge. A changed decoration at the same spot keeps the badge and re-renders it with the new `decoration`.

## Providers and app context

Each block and view renders in a root of its own (a React root, or a Vue render tree outside your app), so a provider in your app (a theme, a store, i18n) doesn't reach it on its own. Each helper has one way to hand it over, the same on `reactView` and `vueView` as on the block helpers:

- **React: `wrap`.** It gets the block's element tree and returns it wrapped, so `wrap: (block) => <StoreProvider store={store}>{block}</StoreProvider>`. It runs on every render, so hand it something built once (a module-level store), not a fresh object per call.
- **Vue: `app`.** Pass your app and the block sees everything it set up: `provide`, global components, plugins like Pinia. That means building the view once the app exists, and your plugin from there:

```ts
const app = createApp(App);
app.use(pinia);
const memoView = vueBlockView(Memo, { surface: 'leaf', singleLine: true, app });
app.mount('#app');
```

## What the helpers don't do

- **A block you draw entirely yourself** (no editable text, no children, like an embed with its own buttons) publishes `focus` and friends from its view, which a component can't hand over. Use `defineBlockView({ surface: 'none' })` for that one ([Block views](../plugin-api.md#block-views)).
