/**
 * Footnote references as `inline()` widgets on `depends`, for the e2e suite that drives an inline
 * widget's key service in a real browser: each `[^label]` draws as the order its label first
 * appears in the document. A `#tag` beside them is styled text that follows a click, recording the
 * tag on `window.__followedTags`, and a `[[see name]]` box's link follows as the editor says,
 * recording the name on `window.__followedSees`. Dev and e2e harness only.
 */
import { definePlugin, inline, lineBlock, type Block, type WidgetProps } from '#lib/plugin.js';

// `[^a]` is a reference; `[^a]:` starts the note itself.
const REFERENCES = /\[\^([^\]\s]+)\](?!:)/g;

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
	// The guide's matcher: a note's own `[^a]:` is no reference, and null leaves it to the editor.
	match: (text, at, end) => {
		let i = at + 2;
		while (i < end && text[i] !== ']' && !/\s/.test(text[i])) i++;
		if (i === at + 2 || i >= end || text[i] !== ']') return -1;
		return text[i + 1] === ':' && i + 1 < end ? i + 2 : i + 1;
	},
	read: (claim) => (claim.endsWith(':') ? null : { label: claim.slice(2, claim.indexOf(']')) }),
	sample: 'a note[^a] here',
	widget: { delete: 'whole', arrows: 'over', click: 'none' },
	depends: referencesIn,
	draw(target, props) {
		target.classList.add('note-ref-widget');
		show(target, props);
		return { update: (next) => show(target, next) };
	}
});

export const followedTag = inline({
	name: 'tag',
	label: 'Tag',
	prefix: '#',
	match: /#[a-z]+/,
	read: (m) => ({ tag: m[0].slice(1) }),
	sample: 'filed under #work',
	class: 'note-refs-tag',
	follow: ({ tag }) =>
		void ((window as { __followedTags?: string[] }).__followedTags ??= []).push(tag)
});

// A `[[see name]]` line drawn as a link of the drawing's own, which asks the editor whether a click
// or a key follows it.
export const seeAlso = lineBlock({
	name: 'see',
	label: 'See also',
	match: /^\[\[see (?<text>[a-z]+)\]\]$/,
	sample: '[[see notes]]',
	insert: { none: 'a test block type' },
	edit: 'box',
	draw(block, ctx) {
		const dom = document.createElement('div');
		const link = document.createElement('a');
		link.className = 'see-link';
		link.href = '#';
		link.textContent = `See ${block.body}`;
		const follow = (event: MouseEvent | KeyboardEvent) => {
			if (!ctx.follows(event)) return;
			event.preventDefault();
			((window as { __followedSees?: string[] }).__followedSees ??= []).push(block.body);
		};
		// The link goes nowhere on its own: what follows is the drawing's to say.
		link.addEventListener('click', (event) => {
			follow(event);
			event.preventDefault();
		});
		link.addEventListener('keydown', follow);
		dom.append(link);
		return { dom, keep: (event) => event.target === link };
	}
});

export const noteRefsPlugin = definePlugin({
	name: 'note-refs',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ inlines: [noteRef, followedTag], blocks: [seeAlso] })
});
