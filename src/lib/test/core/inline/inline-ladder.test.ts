import { afterEach, describe, expect, it } from 'vitest';
import type { InlineNode } from '../../../core/nodes';
import { parseInline } from '../../../core/inline';
import {
	INLINE_PRIORITIES,
	__resetInlineSyntaxForTests,
	getInlineRungs,
	registerInlineSyntax,
	type InlineSyntaxRecognizer
} from '../../../core/inline/scan/plugin-syntax';
import { textNode } from './scan/scan-test-helpers';

afterEach(() => __resetInlineSyntaxForTests());

const decline: InlineSyntaxRecognizer = () => null;

// `[^label]` through the closing bracket, or null when the reference never closes
// (the unterminated-fallback path the built-in `[` handler then reads).
const recognizeFootnote: InlineSyntaxRecognizer = (raw, pos, end) => {
	if (raw[pos] !== '[' || raw[pos + 1] !== '^') return null;
	const close = raw.indexOf(']', pos + 2);
	if (close < 0 || close >= end) return null;
	return { kind: 'footnoteReference' as InlineNode['kind'], start: pos, end: close + 1 };
};

// Two claiming rungs competing on `:`: the `::`-prefix rung claims a pair, the bare
// rung claims one colon. Distinct kinds so dispatch order is observable end-to-end.
const recognizeColonPair: InlineSyntaxRecognizer = (raw, pos) =>
	raw.startsWith('::', pos)
		? { kind: 'colonPair' as InlineNode['kind'], start: pos, end: pos + 2 }
		: null;
const recognizeColon: InlineSyntaxRecognizer = (_raw, pos) => ({
	kind: 'colon' as InlineNode['kind'],
	start: pos,
	end: pos + 1
});

// ── Deterministic dispatch order ────────────────────────────────────────────────

describe('inline ladder — deterministic order (registration order never matters)', () => {
	// priority asc, then prefix length desc, then prefix lexicographic asc. A bare
	// rung (no prefix) takes the trigger as its effective prefix.
	const rungs: Array<{ prefix?: string; priority: number }> = [
		{ priority: INLINE_PRIORITIES.plugin },
		{ prefix: '::', priority: INLINE_PRIORITIES.prefixOverride },
		{ prefix: ':x', priority: INLINE_PRIORITIES.prefixOverride }
	];
	const expectedOrder = ['::', ':x', ':'];

	it.each([
		['registration order', rungs],
		['reversed registration order', [...rungs].reverse()]
	])('the sorted rung list is stable under %s', (_name, order) => {
		for (const { prefix, priority } of order)
			registerInlineSyntax(':', decline, { prefix, priority });
		expect(getInlineRungs(':').map((r) => r.prefix)).toEqual(expectedOrder);
	});

	// The scanner-level pin: the lower-priority `::`@40 rung must claim ahead of the
	// bare `:`@100 rung. A reverse-iterating dispatch would let the bare rung claim a
	// single colon first — the array-order test above can't see that.
	function scanColons(reversed: boolean): InlineNode[] {
		const steps = [
			() => registerInlineSyntax(':', recognizeColonPair, { prefix: '::', priority: 40 }),
			() => registerInlineSyntax(':', recognizeColon)
		];
		for (const step of reversed ? steps.reverse() : steps) step();
		return parseInline('::x', 0, 3);
	}

	it.each([false, true])(
		'`::`@40 claims through the scanner ahead of `:`@100 (reversed=%s)',
		(reversed) => {
			expect(scanColons(reversed)).toEqual([
				{ kind: 'colonPair', start: 0, end: 2 },
				textNode(2, 3, 'x')
			]);
		}
	);
});

// ── Reserved-prefix dispatch (the pre-switch consultation) ───────────────────────

/** The empty-registry reading of `raw`, the byte-identity oracle a decline must match. */
function scanClean(raw: string, end = raw.length): InlineNode[] {
	__resetInlineSyntaxForTests();
	return parseInline(raw, 0, end);
}

describe('inline ladder — reserved-trigger prefix rungs', () => {
	it('a matching prefix rung claims ahead of the built-in `[` handler', () => {
		const raw = 'see [^x] here';
		registerInlineSyntax('[', recognizeFootnote, { prefix: '[^', priority: 40 });
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes).toEqual([
			textNode(0, 4, 'see '),
			{ kind: 'footnoteReference', start: 4, end: 8 },
			textNode(8, 13, ' here')
		]);
	});

	it('an unterminated `[^` declines and falls back to the built-in reading byte-identically', () => {
		const raw = 'a [^never closed';
		const clean = scanClean(raw);
		registerInlineSyntax('[', recognizeFootnote, { prefix: '[^', priority: 40 });
		expect(parseInline(raw, 0, raw.length)).toEqual(clean);
	});

	it('a plain link bracket never triggers the `[^` rung', () => {
		const raw = '[label](/url)';
		const clean = scanClean(raw);
		registerInlineSyntax('[', recognizeFootnote, { prefix: '[^', priority: 40 });
		expect(parseInline(raw, 0, raw.length)).toEqual(clean);
	});
});

// ── The `!` trigger (the image grammar's own opener) ─────────────────────────────

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

describe('inline ladder — a prefix rung on the `!` trigger', () => {
	function registerEmbed(): void {
		registerInlineSyntax('!', recognizeEmbed, { prefix: '![[', priority: 40 });
	}

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
