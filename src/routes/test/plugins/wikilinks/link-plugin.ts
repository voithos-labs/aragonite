/**
 * `[[note]]` links inside the text, limestone's integration reproduced here as an `inline()`
 * widget: it paints the note's name, shows its source when the caret arrows in, and the editor
 * runs `follow` on the click the host picked for links. The harness records each follow, so a
 * spec can check the click reached it and the editor left the widget mounted.
 */
import { definePlugin, inline, type Plugin } from '#lib/plugin.js';
import { svelteView } from '#lib/svelte.js';
import WikiLink from './WikiLink.svelte';

export const WIKILINK_KIND = 'harness-wikilinks/wikilink';

const wikilink = inline({
	name: 'wikilink',
	label: 'Wiki link',
	prefix: '[[',
	match: wikiLinkEnd,
	read: (claim) => ({ target: claim.slice(2, -2) }),
	sample: '[[note]]',
	widget: { delete: 'select-first', arrows: 'into', click: 'follow' },
	draw: svelteView(WikiLink),
	follow(data) {
		const probe = window as Window & { __linkActivations?: string[] };
		(probe.__linkActivations ??= []).push(data.target);
	}
});

export function wikiLinksPlugin(): Plugin {
	return definePlugin({
		name: 'harness-wikilinks',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ inlines: [wikilink] })
	});
}

// `[[name]]` on one line, with no `[` inside and a name that isn't blank: where it ends, or -1.
function wikiLinkEnd(text: string, at: number, end: number): number {
	for (let i = at + 2; i < end; i++) {
		const ch = text[i];
		if (ch === '\n' || ch === '[') return -1;
		if (ch === ']') {
			if (text[i + 1] !== ']' || i + 1 >= end) return -1;
			return text.slice(at + 2, i).trim() ? i + 2 : -1;
		}
	}
	return -1;
}
