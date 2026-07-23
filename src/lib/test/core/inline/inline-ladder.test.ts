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

// ── Registration rules ─────────────────────────────────────────────────────────

describe('inline ladder — registration rules', () => {
	it('exposes the priority ladder as a published const', () => {
		expect(INLINE_PRIORITIES).toEqual({ prefixOverride: 40, builtin: 50, plugin: 100 });
	});

	it('rule 1 — rejects a multi-character trigger', () => {
		expect(() => registerInlineSyntax('$$', decline)).toThrow(/single character/);
	});

	it.each([
		['prefix that does not start with the trigger', '[', 'x^'],
		['prefix shorter than two characters', '[', '['],
		['bare-length prefix on an unreserved trigger', ':', ':']
	])('rule 1 — rejects a %s', (_name, trigger, prefix) => {
		expect(() =>
			registerInlineSyntax(trigger, recognizeFootnote, { prefix, priority: 40 })
		).toThrow(/must begin with the trigger/);
	});

	it('rule 2 — bare reserved registration keeps the built-in-scanner message', () => {
		expect(() => registerInlineSyntax('[', decline)).toThrow(/claimed by the built-in scanner/);
		expect(getInlineRungs('[')).toHaveLength(0);
	});

	it.each([INLINE_PRIORITIES.builtin, INLINE_PRIORITIES.plugin])(
		'rule 2 — reserved prefix at priority %i (≥ builtin) is rejected',
		(priority) => {
			expect(() =>
				registerInlineSyntax('[', recognizeFootnote, { prefix: '[^', priority })
			).toThrow(/priority below the built-in boundary/);
		}
	);

	it('rule 2 — reserved prefix defaulting its priority is rejected (default is the plugin rung)', () => {
		expect(() => registerInlineSyntax('[', recognizeFootnote, { prefix: '[^' })).toThrow(
			/priority below the built-in boundary/
		);
	});

	it('rule 3 — an unreserved trigger takes any priority; bare defaults to the plugin rung', () => {
		registerInlineSyntax(':', decline);
		expect(getInlineRungs(':')[0].priority).toBe(INLINE_PRIORITIES.plugin);
		registerInlineSyntax('$', decline, { priority: INLINE_PRIORITIES.prefixOverride });
		expect(getInlineRungs('$')[0].priority).toBe(INLINE_PRIORITIES.prefixOverride);
	});

	it('rule 4 — an exact (trigger, prefix, priority) duplicate throws; distinct rungs coexist', () => {
		registerInlineSyntax(':', decline);
		expect(() => registerInlineSyntax(':', decline)).toThrow(/already registered/);
		expect(() => registerInlineSyntax(':', decline, { prefix: '::', priority: 40 })).not.toThrow();
		expect(getInlineRungs(':')).toHaveLength(2);
	});
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

describe('inline ladder — reserved-trigger prefix rungs', () => {
	function scanClean(raw: string): InlineNode[] {
		__resetInlineSyntaxForTests();
		return parseInline(raw, 0, raw.length);
	}

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
