// The guide's document recipe (`docs/guide/plugin-guide/reading-the-document.md`), copied as it
// reads there but for the editor range, so its rows run what an author copies.
import { builtin, definePlugin, lineBlock, type Block } from '#lib/plugin.js';

const EDITOR = '*';

const isHeading = (block: Block) =>
	block.is(builtin.blocks.heading) || block.is(builtin.blocks.setextHeading);

/** This block's headings, one `level text` line each. */
export function headingsIn(block: Block): string {
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
	editor: EDITOR,
	contributes: () => ({
		blocks: [
			lineBlock({
				name: 'toc',
				label: 'Contents',
				match: /^\[\[toc\]\]$/,
				sample: '[[toc]]',
				insert: { label: 'Contents', icon: 'list-tree', insert: '[[toc]]\n' },
				edit: 'box',
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
					show(ctx.depends); // empty here: the update right after brings the answers
					return { dom, depends: headingsIn, update: (_block, next) => show(next.depends) };
				}
			})
		]
	})
});

// `[^a]` is a reference; `[^a]:` starts the note itself.
const LABEL = /\[\^([^\]\s]+)\]:?/g;
const references = (text: string) =>
	[...text.matchAll(LABEL)].filter((match) => !match[0].endsWith(':'));

/** The labels this block references, in order, one a line. */
export function referencesIn(block: Block): string {
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
	editor: EDITOR,
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
