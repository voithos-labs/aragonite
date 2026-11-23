# React and Vue blocks

Part of the [plugin guide](../plugin-guide.md). It assumes you've built the parrot in [the quickstart](../plugin-guide.md#the-first-fifteen-minutes), since this page only swaps out the part that draws the block.

If your app is React or Vue, you can draw a plugin block with your own components. The packages that give you the `<Aragonite>` component, `@voithos-labs/aragonite-react` and `@voithos-labs/aragonite-vue`, each carry a helper that turns a component into a block type's `draw`: `reactBlock` and `vueBlock` (Svelte's is `svelteBlock`, from `@voithos-labs/aragonite/svelte`). Your component renders into the element the editor makes for the block, so it runs wherever the editor runs, the prebuilt copy a React or Vue app installs included. For the smaller things a plugin draws (an inline widget, a decoration, a menu row) there's `reactView` and `vueView`.

Sections: [a memo in React](#a-memo-in-react) · [what your component gets](#what-your-component-gets) · [a click-to-edit block](#a-click-to-edit-block) · [a block that holds blocks](#a-block-that-holds-blocks) · [a block with its own editing surface](#a-block-with-its-own-editing-surface) · [a block you draw whole](#a-block-you-draw-whole) · [the same in Vue](#the-same-in-vue) · [widgets, decorations and menu rows](#widgets-decorations-and-menu-rows) · [providers and app context](#providers-and-app-context)

## A memo in React

A memo here is a line starting `%% `, drawn with a little badge beside its text. The text is ordinary editable text: the editor owns the caret, IME, undo and the clipboard in it, and your component only says where it goes.

```tsx
// memo.tsx
import { reactBlock, type BlockProps } from '@voithos-labs/aragonite-react';
import { lineBlock, type TextDrawContext } from '@voithos-labs/aragonite/plugin';

function Memo({ Slot }: BlockProps<never, TextDrawContext>) {
	return (
		<>
			<span className="memo-badge">memo</span>
			<span className="memo-text">
				<Slot of="source" />
			</span>
		</>
	);
}

export const memo = lineBlock({
	name: 'memo',
	label: 'Memo',
	match: /^%% (?<text>.*)$/,
	sample: '%% buy milk',
	insert: { none: 'typed, never picked from a menu' },
	edit: 'text',
	draw: reactBlock(Memo, { className: 'memo' })
});
```

`memo` goes in your plugin's `contributes(...).blocks`, the way the quickstart lists `parrot`. `edit: 'text'` keeps the text showing all the time, and every keystroke commits, the way it does in a paragraph. Leave `edit` out and a block with a `draw` shows its text only while the caret is in it ([below](#a-click-to-edit-block)).

`<Slot of="source" />` is where the editor's element for the text goes. The editor fills it, so your badge, icon or whatever else goes beside it, never inside.

Two rules make a framework block behave:

- **Style the block's element with `className`, and keep your component's own root margin-free** (a fragment, like the memo, is easiest). The editor measures the element it made as the block, and a margin on a wrapper inside sits outside what the editor measures, so the selection highlight and the drag handle come out a little off.
- **Render each `<Slot>` every time, never behind a condition.** The editor shows and hides its own text, and it puts the caret in before your component hears the block has focus, so a slot that only mounts once the block is focused is one the caret never reaches. A fresh `key` per render is the same trouble in a different hat: the element moves, and text that moves drops its caret.

## What your component gets

Three props: `block`, `ctx` and `Slot`. Your component renders again whenever the block's bytes change, or its place in the document, the presentation mode, the theme, whether the caret is in it, or the text typed so far.

`block` is the block as it is right now:

```ts
block.text; // '%% buy milk\n': its bytes, line ending included
block.body; // 'buy milk': what the `text` group matched
block.from; // 120: where its bytes start in the document, read when you ask
block.to; // 132
```

On a memo every keystroke commits, so `block.text` changes, and the memo renders again, once per key. Keep the render cheap.

`ctx` is the editor's side, and what it carries depends on how the block edits:

| The block | `ctx` has |
| --- | --- |
| any | `ctx.editor` (your plugin's `EditorContext` in the editor drawing the block, the same object the [per-editor recipes](per-editor.md#one-process-many-editors) use), `ctx.mode`, `ctx.theme`, `ctx.focused` (the caret is in the block) |
| a line or fence with text | `ctx.source`, the element `<Slot of="source" />` places, and `ctx.typed`, the text inside its marker as typed and not yet written, while a click-to-edit block is open |
| a container | `ctx.children`, the element `<Slot of="children" />` places |
| a box (`edit: 'box'`) | `ctx.leave(edge, x?)`, to hand the caret to the block above or below, and `ctx.focusWhole()`, to focus the box whole again from a field of your own |

## A click-to-edit block

A click-to-edit block shows something rendered (a caption, a formula, a chart) until you click it, then shows its text to edit. That's what a block with a `draw` and no `edit` does. This one is a `@@ ` line that shows as a bold label:

```tsx
function Label({ block, ctx, Slot }: BlockProps<never, TextDrawContext>) {
	const caption = block.body;
	return (
		<>
			{!ctx.focused && <strong>{caption}</strong>}
			<span className="label-source">
				<Slot of="source" />
			</span>
		</>
	);
}

export const label = lineBlock({
	name: 'label',
	label: 'Label',
	match: /^@@ (?<text>.*)$/,
	sample: '@@ a label',
	insert: { none: 'typed, never picked from a menu' },
	draw: reactBlock(Label, { className: 'label' })
});
```

A click anywhere in the block puts the caret in its text, the editor shows the text, and `ctx.focused` turns true, so the caption steps aside. Typing edits the text without committing anything. Moving the caret out of the block commits the whole edit as one undo step and hides the text again. So click, type, click away, Ctrl+Z, and the old label is back in one go.

Want a live preview while the text is open (block math's side-by-side layout)? That's `ctx.typed`: the text as it's typed, its marker left out, before anything commits, and your component renders again with it on every key. It's null while the block is closed, so fall back to the block's `body`:

```tsx
function Label({ block, ctx, Slot }: BlockProps<never, TextDrawContext>) {
	const caption = (ctx.typed ?? block.body).trim();
	return (
		<>
			{!ctx.focused && <strong>{caption}</strong>}
			<span className="label-source">
				<Slot of="source" />
			</span>
			{ctx.focused && <em>{caption}</em>}
		</>
	);
}
```

A click lands at the start of the text unless you say otherwise, which is a letdown when you clicked the end of the caption. The caption's text is the block's text here, so hand the editor the caption with `useDrawn` and a click lands on the letter you clicked:

```tsx
import { useRef } from 'react';
import { reactBlock, useDrawn, type BlockProps } from '@voithos-labs/aragonite-react';

function Label({ block, ctx, Slot }: BlockProps<never, TextDrawContext>) {
	const shown = useRef<HTMLElement | null>(null);
	useDrawn(() => ({ caret: shown.current ?? undefined }));
	return (
		<>
			{!ctx.focused && <strong ref={shown}>{block.body}</strong>}
			<span className="label-source">
				<Slot of="source" />
			</span>
		</>
	);
}
```

`useDrawn` takes a function, and the editor calls it each time it needs an answer, so `shown.current` is there by the time anyone clicks. It answers three things, the same three a plain `draw` hands back beside its `dom`: `caret` (where a click on your picture of the text lands), `focus` ([below](#a-block-you-draw-whole)), and `keep`, for events the editor should leave to your component (a drag that pans a diagram).

## A block that holds blocks

A container's children are real document blocks: the editor mounts them, windows them, and runs selection, undo and everything else through them. You say where they go with `<Slot of="children" />`:

```tsx
import { container, type ContainerDrawContext } from '@voithos-labs/aragonite/plugin';

function Box({ Slot }: BlockProps<never, ContainerDrawContext>) {
	return (
		<>
			<span className="box-badge">box</span>
			<div className="box-children">
				<Slot of="children" />
			</div>
		</>
	);
}

export const box = container({
	name: 'box',
	label: 'Box',
	lines: { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true },
	sample: '%> inside the box',
	insert: { none: 'typed, never picked from a menu' },
	draw: reactBlock(Box, { className: 'box' })
});
```

`lines` says how a line inside the box is marked, the way a blockquote's lines start with `> `, and the editor writes those markers for you on every edit. The children land in the slot, so your chrome goes beside it.

## A block with its own editing surface

Some blocks don't want the editor's text at all. The bundled diagram block shows a picture, and editing it means a `<textarea>` of its own. A block like that has no caret inside it, so the editor focuses it as a whole: arrows stop on it, Backspace next to it focuses it and a second press deletes it, Enter adds a paragraph below, and a character typed at it starts one. That's `edit: 'box'`.

A note shown as text until a double click opens a textarea, kept in a ` ```note ` fence:

````tsx
import { useState } from 'react';
import { fencedBlock, type BoxDrawContext } from '@voithos-labs/aragonite/plugin';

function Note({ block, ctx }: BlockProps<never, BoxDrawContext>) {
	const [editing, setEditing] = useState(false);
	const save = (text: string) => {
		const fence = '```note\n' + text + '\n```\n';
		void ctx.editor.edit().replace({ from: block.from, to: block.to }, fence).commit();
	};
	if (editing) {
		return (
			<textarea
				autoFocus
				defaultValue={block.body.replace(/\n$/, '')}
				onBlur={(e) => {
					setEditing(false);
					if (e.currentTarget.value + '\n' !== block.body) save(e.currentTarget.value);
				}}
			/>
		);
	}
	return <pre onDoubleClick={() => setEditing(true)}>{block.body}</pre>;
}

export const note = fencedBlock({
	name: 'note',
	label: 'Note',
	fence: { info: 'note' },
	sample: '```note\nhello\n```',
	insert: { none: 'typed, never picked from a menu' },
	edit: 'box',
	draw: reactBlock(Note, { className: 'note' })
});
````

Arrow down onto the note and it's focused whole, double-click and you're typing in the textarea, click away and the text goes back into the fence as one undo step. A few things make it behave:

- **Write with `block.from` and `block.to`.** They're read when you ask, so they're right even after an edit above moved the note, which a value you saved at render time wouldn't be.
- **DOM focus goes to a hidden editing host**, not to your `<pre>`. The editor puts it in the block's element, next to what you render, since that's where AltGr and IME input arrive. So style focus with `:focus-within`.
- **Keys in your textarea are the textarea's.** The editor's chords still reach it (Ctrl+Z, say) unless your component's `keep` takes them. To leave by arrow key on the first or last line, call `ctx.leave('start')` or `ctx.leave('end')` and `preventDefault`. Escape hands the note back to the editor focused whole, and from there Enter opens a paragraph below it, which is the only way to get one between two boxes back to back. If you use Escape yourself (to drop the edit, say), call `preventDefault`, or the box takes whole focus too; `ctx.focusWhole()` gets you there from your own code.

## A block you draw whole

Some blocks have no text for the editor and no children either: an embed with its own buttons, a little widget, a die. A box like that still needs one thing from you, if it has a control of its own: where the caret goes when it arrives. You hand that over with `useDrawn`'s `focus`, and without it the editor focuses the block whole.

```tsx
import { useRef, useState, type KeyboardEvent } from 'react';
import { reactBlock, useDrawn, type BlockProps } from '@voithos-labs/aragonite-react';
import { lineBlock, type BoxDrawContext } from '@voithos-labs/aragonite/plugin';

function Dice({ ctx }: BlockProps<never, BoxDrawContext>) {
	const [rolled, setRolled] = useState(0);
	const button = useRef<HTMLButtonElement | null>(null);
	useDrawn(() => ({
		focus: {
			enter: () => button.current?.focus(),
			offset: () => (document.activeElement === button.current ? 0 : null)
		}
	}));
	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'ArrowUp') ctx.leave('start');
		else if (e.key === 'ArrowDown') ctx.leave('end');
		else return;
		e.preventDefault();
	}
	return (
		<button ref={button} onClick={() => setRolled((rolled % 6) + 1)} onKeyDown={onKeyDown}>
			d6: {rolled || 'roll me'}
		</button>
	);
}

export const dice = lineBlock({
	name: 'dice',
	label: 'Die',
	match: /^!! d6$/,
	sample: '!! d6',
	insert: { none: 'typed, never picked from a menu' },
	edit: 'box',
	draw: reactBlock(Dice, { className: 'dice' })
});
```

`enter` runs when an arrow brings the caret in (it's told which edge, and the column an up or down arrow keeps, if you want them), and `offset` says where the caret sits in your block, or null while it's elsewhere, which is what undo puts back. Plain keys in your button are its own. The die rolls with a click and hands the caret on with `ctx.leave` at ArrowUp and ArrowDown.

## The same in Vue

`vueBlock(component, options)` takes the same `className`, and the component gets the same `block`, `ctx` and `Slot` as props. The memo, as a single-file component:

```vue
<!-- Memo.vue -->
<script setup lang="ts">
import type { BlockProps } from '@voithos-labs/aragonite-vue';
import type { TextDrawContext } from '@voithos-labs/aragonite/plugin';

defineProps<BlockProps<never, TextDrawContext>>();
</script>

<template>
	<span class="memo-badge">memo</span>
	<span class="memo-text"><Slot of="source" /></span>
</template>
```

```ts
import { vueBlock } from '@voithos-labs/aragonite-vue';
import Memo from './Memo.vue';

export const memo = lineBlock({ /* the same spec as above */ draw: vueBlock(Memo, { className: 'memo' }) });
```

The click-to-edit label is a `v-if` on `ctx.focused`, and the box puts `<Slot of="children" />` where its children go. `useDrawn` is the package's own too, called in `setup`, with a template ref where React has `useRef`:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useDrawn, type BlockProps } from '@voithos-labs/aragonite-vue';
import type { TextDrawContext } from '@voithos-labs/aragonite/plugin';

defineProps<BlockProps<never, TextDrawContext>>();
const shown = ref<HTMLElement | null>(null);
useDrawn(() => ({ caret: shown.value ?? undefined }));
</script>

<template>
	<strong v-if="!ctx.focused" ref="shown">{{ block.body }}</strong>
	<span class="label-source"><Slot of="source" /></span>
</template>
```

Svelte's `svelteBlock(Component)` is the same deal: `block`, `ctx` and `Slot` as props, and `useDrawn` from `@voithos-labs/aragonite/svelte`, called while the component initialises.

## Widgets, decorations and menu rows

An inline widget, a decoration's widget or badge, and an inline menu row don't take a block view. They take a `PluginView`, the little `(target, props) => { update, destroy }` function from [inline kinds](inline-kinds.md#rendering-it-as-a-widget). `reactView(Component)` makes one from a component, which gets the slot's props as its own. Here's a chip for every `{{name}}` in the text:

```tsx
import { reactView } from '@voithos-labs/aragonite-react';
import { inline, type WidgetProps } from '@voithos-labs/aragonite/plugin';

function Chip({ data }: WidgetProps<{ name: string }>) {
	return <span className="chip">{data.name}</span>;
}

const chip = inline({
	name: 'chip',
	label: 'Chip',
	prefix: '{{',
	match: /\{\{(\w+)\}\}/,
	read: ([, name]) => ({ name }),
	sample: 'a {{pebble}} chip',
	widget: { delete: 'whole', arrows: 'over', click: 'none' },
	draw: reactView(Chip)
});
```

List `chip` in your plugin's `contributes(...).inlines`, and `a {{pebble}} chip` reads as `a [pebble] chip`, with `pebble` drawn by `Chip`, and the caret steps over it as one character.

The component re-renders on every `update` with the slot's new props (typing before the chip moves its `from`, say), and its root unmounts when the slot drops it. There's no per-prop tracking like `svelteView` has, so keep the render cheap.

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
const drawMemo = vueBlock(Memo, { className: 'memo', app });
app.mount('#app');
```
