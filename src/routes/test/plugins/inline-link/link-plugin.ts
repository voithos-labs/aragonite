// `[[target|text]]` read as a built-in link in its own syntax: the link card, the live split and
// the format chords all meet a link whose bytes aren't GFM, and `write` keeps them its own.
import { definePlugin, inline } from '#lib/plugin.js';

const link = inline({
	name: 'link',
	label: 'Wiki link',
	prefix: '[[',
	match: /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/,
	// `at` names the text's own bytes: a text can spell the start of its target too.
	read: ([, target, text]) => ({
		target,
		text: text ?? target,
		at: text === undefined ? 2 : target.length + 3
	}),
	sample: '[[note|Shown]]',
	as: 'link',
	link: ({ target, text, at }) => ({
		href: `https://example.org/${target}`,
		text,
		at,
		title: null
	}),
	write: ({ href, text }) =>
		href.startsWith('https://example.org/')
			? `[[${href.slice('https://example.org/'.length)}|${text}]]`
			: null
});

export const inlineLinkPlugin = definePlugin({
	name: 'inline-link',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ inlines: [link] })
});
