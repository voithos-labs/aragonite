/**
 * Footnote references as `inline()` widgets on `depends`, for the e2e suite that drives an inline
 * widget's key service in a real browser: each `[^label]` draws as the order its label first
 * appears in the document. Dev and e2e harness only.
 */
import { definePlugin, inline, type Block, type WidgetProps } from '#lib/plugin.js';

// `[^a]` is a reference; `[^a]:` starts the note itself.
const REFERENCE = /\[\^([^\]\s]+)\](?!:)/;
const REFERENCES = new RegExp(REFERENCE.source, 'g');

/** The labels this block references, in order, one a line. */
function referencesIn(block: Block): string {
	if (!block.text.includes('[^')) return '';
	let labels = '';
	for (const inside of block.walk()) {
		if (inside.prose)
			for (const [, label] of inside.text.matchAll(REFERENCES)) labels += `${label}\n`;
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

function show(target: HTMLElement, props: WidgetProps<{ label: string }>): void {
	target.textContent = String(numbering(props.depends).get(props.data.label) ?? '?');
}

export const noteRef = inline({
	name: 'ref',
	label: 'Footnote reference',
	prefix: '[^',
	match: REFERENCE,
	read: (match) => ({ label: match[1] }),
	sample: 'a note[^a] here',
	widget: { delete: 'whole', arrows: 'over', click: 'none' },
	depends: referencesIn,
	draw(target, props) {
		target.classList.add('note-ref-widget');
		show(target, props);
		return { update: (next) => show(target, next) };
	}
});

export const noteRefsPlugin = definePlugin({
	name: 'note-refs',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ inlines: [noteRef] })
});
