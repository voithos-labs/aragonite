# Recipe: reading the rest of the document

Part of the [plugin guide](../plugin-guide.md).

A block gets its own text, which is fine right up until it isn't: a table of contents needs every heading, and a footnote reference needs to know it's the third one. Walking the whole document on every keystroke works until the document is long. So say what you read instead.

Your block type's `depends(block)`, beside its `draw`, answers one string per top-level block: what your drawing reads of it. The editor asks every top-level block once, for all your drawings together, then only the blocks a keystroke changed. `draw` and `update` get the answers as `ctx.depends`, one per block, in `editor.doc.blocks`' order. `update` runs when an answer that says something (anything but `''`) comes, goes, changes or moves to another block, so typing in a paragraph asks one block and redraws nothing.

## A table of contents

```ts
import { builtin, definePlugin, lineBlock, type Block } from '@voithos-labs/aragonite/plugin';

const isHeading = (block: Block) =>
	block.is(builtin.blocks.heading) || block.is(builtin.blocks.setextHeading);

/** This block's headings, one `level text` line each. */
function headingsIn(block: Block): string {
	// Most blocks hold no heading: skip the walk unless a `#` or an underline could start one.
	if (!/#|[=-][ \t]*\r?$/m.test(block.text)) return '';
	let lines = '';
	for (const inside of block.walk()) {
		if (!isHeading(inside)) continue;
		const atx = /^ {0,3}(#{1,6})/.exec(inside.text);
		const level = atx ? atx[1].length : inside.text.trimEnd().endsWith('=') ? 1 : 2;
		lines += `${level} ${inside.body}\n`;
	}
	return lines;
}

export const contents = definePlugin({
	name: 'contents',
	version: '1.0.0',
	editor: '^0.11.6',
	contributes: () => ({
		blocks: [
			lineBlock({
				name: 'toc',
				label: 'Contents',
				match: /^\[\[toc\]\]$/,
				sample: '[[toc]]',
				insert: { label: 'Contents', icon: 'list-tree', insert: '[[toc]]\n' },
				edit: 'box',
				depends: headingsIn,
				draw(_block, ctx) {
					const dom = document.createElement('nav');
					const show = (answers: readonly string[]) =>
						dom.replaceChildren(
							...answers
								.join('')
								.split('\n')
								.filter(Boolean)
								.map((line) => {
									const row = document.createElement('div');
									row.dataset.level = line.slice(0, line.indexOf(' '));
									row.textContent = line.slice(line.indexOf(' ') + 1);
									return row;
								})
						);
					show(ctx.depends);
					return { dom, update: (_block, next) => show(next.depends) };
				}
			})
		]
	})
});
```

The text check at the top is the part that keeps typing cheap. A block whose text can't hold a heading answers without walking. The check has to let every heading through, or one drops out of the list: `#` anywhere covers `# Title`, and a line ending in `=` or `-` covers an underlined heading, inside a quote or a plugin's container too.

**The limit.** A key inside a block re-asks that whole block. Typing in one list of 25,000 items walks the list on every key, about 45 to 50 ms, which is what walking the whole document cost before. A list that holds no `#` skips that walk.

## Footnote numbers

A paint can read the rest of the document the same way: `paintDepends(block)` answers per top-level block, and `paint(block, ctx)` gets the answers as `ctx.depends`. Here each block answers with the footnotes it references, in order, so a number is the order a label first appears in:

```ts
// `[^a]` is a reference; `[^a]:` starts the note itself.
const LABEL = /\[\^([^\]\s]+)\]:?/g;
const references = (text: string) =>
	[...text.matchAll(LABEL)].filter((match) => !match[0].endsWith(':'));

/** The labels this block references, in order, one a line. */
function referencesIn(block: Block): string {
	if (!block.text.includes('[^')) return '';
	let labels = '';
	for (const inside of block.walk()) {
		if (inside.prose) for (const [, label] of references(inside.text)) labels += `${label}\n`;
	}
	return labels;
}

// The answers never change once handed over, so they key a cache: one numbering per edit.
const numberings = new WeakMap<readonly string[], Map<string, number>>();
function numbering(depends: readonly string[]): Map<string, number> {
	let numbers = numberings.get(depends);
	if (!numbers) {
		numbers = new Map();
		for (const label of depends.join('').split('\n')) {
			if (label && !numbers.has(label)) numbers.set(label, numbers.size + 1);
		}
		numberings.set(depends, numbers);
	}
	return numbers;
}

export const noteNumbers = definePlugin({
	name: 'note-numbers',
	version: '1.0.0',
	editor: '^0.11.6',
	contributes: () => ({
		paintDepends: referencesIn,
		paint(block, ctx) {
			const numbers = numbering(ctx.depends);
			return references(block.text).map((match) => ({
				type: 'mark' as const,
				from: block.byteAt(match.index),
				to: block.byteAt(match.index + match[0].length - 1) + 1,
				class: 'note-ref',
				attrs: { 'data-note': String(numbers.get(match[1])) }
			}));
		}
	})
});
```

```css
.note-ref::after {
	content: attr(data-note);
	vertical-align: super;
	font-size: 0.75em;
}
```

A paint is asked only for blocks on screen, and kept while a block's bytes and the answers stand. When an answer changes or moves (a reference added above, a new line typed above one), the blocks on screen paint again; a key that changes no answer paints only the block it was typed in.

## In React or Vue

`depends` sits on the block type there too: `lineBlock({ ..., depends: headingsIn, draw: reactBlock(Toc) })`, and the component reads `ctx.depends`. Since an array handed over never changes, it keys a memo: `useMemo(() => outline(ctx.depends), [ctx.depends])` in React, a `computed` over `props.ctx.depends` in Vue.

## Getting there from what you read

A table-of-contents row that jumps to its heading wants the heading's place: `ctx.editor.doc.blocks[i]` is the top-level block answer `i` came from, its `walk()` finds the heading inside it, and `ctx.editor.select(heading.from)` puts the caret at its start, scrolled into view.
