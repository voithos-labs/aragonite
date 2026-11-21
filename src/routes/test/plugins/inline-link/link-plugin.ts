// `[[target|text]]` read as a built-in link in its own syntax: the link card, the live split and
// the format chords all meet a link whose bytes aren't GFM, and `write` keeps them its own.
import { definePlugin, inline } from '#lib/plugin.js';

const link = inline({
	name: 'link',
	label: 'Wiki link',
	prefix: '[[',
	match: /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/,
	read: ([, target, text]) => ({ target, text: text ?? target }),
	sample: '[[note|Shown]]',
	as: 'link',
	link: ({ target, text }) => ({ href: `https://example.org/${target}`, text, title: null }),
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
