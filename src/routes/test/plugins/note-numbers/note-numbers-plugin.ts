/**
 * Footnote numbers as a paint on `paintDepends`, for the e2e suite that drives the paint's key
 * service in a real browser: each `[^label]` reference gets a `note-ref` mark whose `data-note` is
 * the order its label first appears in the document. The guide's recipe, but for the editor range.
 * Dev and e2e harness only.
 */
import { definePlugin, type Block } from '#lib/plugin.js';

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
		for (const label of depends.join('').match(/.+/g) ?? []) {
			if (!numbers.has(label)) numbers.set(label, numbers.size + 1);
		}
		numberings.set(depends, numbers);
	}
	return numbers;
}

export const noteNumbersPlugin = definePlugin({
	name: 'note-numbers',
	version: '1.0.0',
	editor: '*',
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
