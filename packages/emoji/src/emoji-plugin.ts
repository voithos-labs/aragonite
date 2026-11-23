/**
 * GitHub `:shortcode:` emoji drawn as their glyphs. The `:smile:` bytes stay in the document, so an
 * editor without the plugin reads ordinary prose; the glyph is only what the widget draws and what
 * a reader reads (`block.textContent`).
 */

import { definePlugin, inline } from '@voithos-labs/aragonite/plugin';
import { EMOJI_TABLE } from './emoji-table';

// The gemoji alphabet: uppercase is excluded to match GitHub, and excluding the
// newline is what keeps a shortcode from spanning a line.
function isShortcodeChar(code: number): boolean {
	return (
		(code >= 0x61 && code <= 0x7a) || // a-z
		(code >= 0x30 && code <= 0x39) || // 0-9
		code === 0x5f || // _
		code === 0x2b || // +
		code === 0x2d // -
	);
}

// Past the closing colon of the name at `at`, or -1; the table is asked once, by `read`.
function shortcodeEnd(text: string, at: number, end: number): number {
	let i = at + 1;
	while (i < end && text.charCodeAt(i) !== 0x3a) {
		if (!isShortcodeChar(text.charCodeAt(i))) return -1;
		i++;
	}
	return i >= end || i === at + 1 ? -1 : i + 1;
}

const shortcode = inline<string>({
	name: 'emoji',
	label: 'Emoji',
	prefix: ':',
	sample: [':smile:', 'ship it :rocket: now'],
	match: shortcodeEnd,
	read: (claim) => EMOJI_TABLE.get(claim.slice(1, -1)) ?? null,
	widget: { delete: 'whole', arrows: 'over', click: 'none' },
	// `user-select: none` keeps the caret out of the glyph; set inline, since a widget drawn as
	// plain DOM has no scoped stylesheet.
	draw(target, { data }) {
		target.classList.add('md-emoji-widget');
		target.textContent = data;
		target.style.userSelect = 'none';
		return { update: (next) => void (target.textContent = next.data) };
	},
	textContent: (glyph) => glyph
});

/** Emoji shortcodes: list `emoji` in an editor's plugins. */
export const emoji = definePlugin({
	name: 'emoji',
	version: '0.11.5',
	editor: '0.11.5',
	contributes: () => ({ inlines: [shortcode] })
});
