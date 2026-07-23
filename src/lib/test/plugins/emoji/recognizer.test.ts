// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { InlineNode } from '$lib/core/nodes';
import { __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import { __resetInlineWidgetsForTests } from '$lib/core/inline/inline-widgets';
import { __clearDeclaredPluginInlineKindsForTests } from '$lib/schema/plugin-kind';
import { registerEmoji, EMOJI_KIND } from '$lib/plugins/emoji/emoji-recognizer';

function resetInline(): void {
	__resetInlineSyntaxForTests();
	__resetInlineWidgetsForTests();
	__clearDeclaredPluginInlineKindsForTests();
}
beforeEach(resetInline);
afterEach(resetInline);

const isEmoji = (n: InlineNode) => n.kind === EMOJI_KIND;
const scan = (raw: string) => parseInline(raw, 0, raw.length);
const emojiIn = (raw: string) => scan(raw).filter(isEmoji);

// With the plugin absent, `:smile:` is ordinary prose — a document authored with
// shortcodes opens byte-identically in an editor that never installed emoji.
describe('emoji shortcode is dormant until the plugin registers', () => {
	it('leaves :smile: to literal text with nothing registered', () => {
		const clean = scan('a :smile: b');
		registerEmoji();
		resetInline();
		expect(scan('a :smile: b')).toEqual(clean);
		expect(clean.some(isEmoji)).toBe(false);
	});
});

// The recognizer's `:` rung alone flips the scanner's trigger probe, with no
// directive tier present — the standalone coexistence half of the interfaces line.
describe('the emoji rung alone makes `:` scan-visible', () => {
	beforeEach(() => registerEmoji());

	it('claims :smile: with only the emoji plugin installed', () => {
		const [node] = emojiIn('say :smile: now');
		expect(node).toMatchObject({ kind: EMOJI_KIND, start: 4, end: 11, decoded: '😄' });
	});
});

describe('recognizer grammar', () => {
	beforeEach(() => registerEmoji());

	const claims: Array<[string, string, string]> = [
		['a plain shortcode', ':smile:', '😄'],
		['a `+`-bearing shortcode', ':+1:', '👍'],
		['an alias form', ':thumbsup:', '👍'],
		['an underscore shortcode', ':heart_eyes:', '😍']
	];
	for (const [name, raw, glyph] of claims) {
		it(`claims ${name} (${raw}) carrying its glyph`, () => {
			const [node] = emojiIn(raw);
			expect(node).toMatchObject({ kind: EMOJI_KIND, start: 0, end: raw.length, decoded: glyph });
		});
	}

	const declines: Array<[string, string]> = [
		['an unknown name', ':notaname:'],
		['whitespace after the colon', ': smile:'],
		['an unterminated shortcode', ':smile'],
		['an empty pair', '::']
	];
	for (const [name, raw] of declines) {
		it(`declines ${name} (${JSON.stringify(raw)}) and stays byte-identical`, () => {
			resetInline();
			const clean = scan(raw);
			registerEmoji();
			expect(scan(raw)).toEqual(clean);
			expect(emojiIn(raw)).toHaveLength(0);
		});
	}

	// The reference is atomic and closes at its own `:` — the trailing bytes rescan
	// as ordinary inline content, never swallowed into the claim.
	it('claims only through the closing colon, leaving a trailing colon literal', () => {
		const nodes = scan(':smile::');
		expect(nodes[0]).toMatchObject({ kind: EMOJI_KIND, start: 0, end: 7 });
		expect(nodes[nodes.length - 1]).toMatchObject({ kind: 'text', text: ':' });
	});
});

// A shortcode embedded in prose round-trips byte-for-byte (the raw is the source of
// truth — the widget never rewrites it) while parsing to an emoji node.
describe('a shortcode in prose is conformant', () => {
	beforeEach(() => registerEmoji());

	it('round-trips the source and yields the emoji node', () => {
		const source = 'Ship it :tada: today.\n';
		expect(serialize(parse(source))).toBe(source);
		const [node] = emojiIn('Ship it :tada: today.');
		expect(node).toMatchObject({ kind: EMOJI_KIND, decoded: '🎉' });
	});
});
