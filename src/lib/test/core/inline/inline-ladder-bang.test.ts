import { afterEach, describe, expect, it } from 'vitest';
import type { InlineNode } from '../../../core/nodes';
import { parseInline } from '../../../core/inline';
import {
	__resetInlineSyntaxForTests,
	registerInlineSyntax,
	type InlineSyntaxRecognizer
} from '../../../core/inline/scan/plugin-syntax';
import {
	assertConstructCoverage,
	assertTotalCoverage,
	scanClean,
	textNode
} from './scan/scan-test-helpers';

afterEach(() => __resetInlineSyntaxForTests());

// `![[target]]` through the closing pair, image extensions only — a minimal
// stand-in for an Obsidian-style embed plugin. The extension gate is the point:
// `![[a]](u)` is a *built-in* image whose alt text is `[a]`, so the two grammars
// overlap and the recognizer, consulted first, has to decline that one itself.
const recognizeEmbed: InlineSyntaxRecognizer = (raw, pos, end) => {
	if (!raw.startsWith('![[', pos)) return null;
	const close = raw.indexOf(']]', pos + 3);
	if (close < 0 || close + 2 > end) return null;
	const target = raw.slice(pos + 3, close);
	if (!/\.(png|jpg|svg)$/.test(target)) return null;
	return { kind: 'wikiEmbed' as InlineNode['kind'], start: pos, end: close + 2 };
};

function registerEmbed(): void {
	registerInlineSyntax('!', recognizeEmbed, { prefix: '![[', priority: 40 });
}

describe('inline ladder — a prefix rung on the `!` trigger', () => {
	it('is dormant until registered — `![[a.png]]` stays plain text', () => {
		const raw = '![[a.png]]';
		expect(parseInline(raw, 0, raw.length)).toEqual([textNode(0, 10, raw)]);
	});

	// The rung is consulted ahead of `handleBang`, which is the only position that
	// works: `handleBang` consumes `![` as one unit and advances past it, so a rung
	// waiting behind the switch would never see the trigger.
	it('claims `![[a.png]]` while a built-in image in the same document is untouched', () => {
		const raw = 'see ![[a.png]] and ![alt](u)';
		registerEmbed();
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.map((n) => n.kind)).toEqual(['text', 'wikiEmbed', 'text', 'image']);
		expect(nodes[1]).toEqual({ kind: 'wikiEmbed', start: 4, end: 14 });
		expect(nodes[3]).toMatchObject({ kind: 'image', start: 19, end: 28, alt: 'alt', url: 'u' });
	});

	// The overlap case. `![[a]](u)` is an image with alt `[a]`; the embed recognizer
	// declines it (no image extension), and a decline must leave the scan context
	// untouched so the built-in case reads byte-identical bytes.
	it('declines `![[a]](u)` and the built-in image reads it byte-identically', () => {
		const raw = '![[a]](u)';
		const clean = scanClean(raw);
		expect(clean).toEqual([
			{
				kind: 'image',
				start: 0,
				end: 9,
				children: [textNode(2, 5, '[a]')],
				alt: '[a]',
				url: 'u'
			}
		]);
		registerEmbed();
		expect(parseInline(raw, 0, raw.length)).toEqual(clean);
	});

	// `end` short of `raw.length` puts the closing `]]` outside the scan range, so
	// the recognizer's range check — not its search — is what declines that row.
	it.each([
		['a bare `!` at end of input', 'hi !', 4],
		['an unclosed `![`', 'a ![b', 5],
		['an unterminated `![[`', 'a ![[b.png', 10],
		['a `![[` whose close falls outside the scan range', 'x ![[b.png]]', 11]
	])('%s parses byte-identically with the rung registered', (_name, raw, end) => {
		const clean = scanClean(raw, end);
		registerEmbed();
		expect(parseInline(raw, 0, end)).toEqual(clean);
	});
});

// `!` is the only registerable trigger whose built-in handler pushes the bracket
// stack, so a rung that claims inside an open bracket is the one interaction `[^`
// cannot stand in for: the claimed node lands among the label's children while the
// enclosing construct still has to close over it.
describe('inline ladder — a claiming `!` rung inside an open bracket', () => {
	it.each([
		['a link label', '[see ![[b.png]] here](u)', 'link'],
		['an image alt', '![see ![[b.png]] here](u)', 'image']
	])('%s closes over the claimed node and tiles its range', (_name, raw, kind) => {
		registerEmbed();
		const nodes = parseInline(raw, 0, raw.length);
		assertTotalCoverage(nodes, 0, raw.length);
		assertConstructCoverage(nodes);
		expect(nodes).toHaveLength(1);
		expect(nodes[0].kind).toBe(kind);
		expect(nodes[0].children?.some((child) => child.kind === 'wikiEmbed')).toBe(true);
	});

	// The alt text is read back off the raw bytes, so a claimed embed inside it must
	// not rewrite what the built-in image reports.
	it('leaves the image alt reading its raw bytes', () => {
		const raw = '![see ![[b.png]] here](u)';
		registerEmbed();
		expect(parseInline(raw, 0, raw.length)[0]).toMatchObject({
			kind: 'image',
			alt: 'see ![[b.png]] here',
			url: 'u'
		});
	});
});
