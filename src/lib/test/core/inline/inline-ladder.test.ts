import { afterEach, describe, expect, it } from 'vitest';
import type { InlineNode } from '../../../core/nodes';
import { parseInline } from '../../../core/inline';
import {
	INLINE_PRIORITIES,
	getInlineRungs,
	registerInlineSyntax,
	type InlineSyntaxRecognizer
} from '../../../core/inline/scan/plugin-syntax';
import { scanClean, textNode } from './scan/scan-test-helpers';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

afterEach(() => __resetSchemaRegistriesForTests());

const decline: InlineSyntaxRecognizer = () => null;

// `[^label]` through the closing bracket, or null when the reference never closes
// (the unterminated-fallback path the built-in `[` handler then reads).
const recognizeFootnote: InlineSyntaxRecognizer = (raw, pos, end) => {
	if (raw[pos] !== '[' || raw[pos + 1] !== '^') return null;
	const close = raw.indexOf(']', pos + 2);
	if (close < 0 || close >= end) return null;
	return { kind: 'footnoteReference' as InlineNode['kind'], start: pos, end: close + 1 };
};

// Two claiming handlers competing on `:`: the `::`-prefix handler claims a pair, the bare
// handler claims one colon. Distinct kinds so dispatch order is observable end-to-end.
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

describe('inline priority order: deterministic order (registration order never matters)', () => {
	// Priority ascending, then prefix length descending, then prefix alphabetical. A bare
	// handler (no prefix) takes the trigger as its effective prefix.
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

	// The scanner-level pin: a reverse-iterating dispatch would let the bare `:`@100 handler
	// claim a single colon before `::`@40, which the array-order test above cannot see.
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

describe('inline priority order: reserved-trigger prefix inline syntax handlers', () => {
	it('a matching prefix inline syntax handler claims ahead of the built-in `[` handler', () => {
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

	it('a plain link bracket never triggers the `[^` inline syntax handler', () => {
		const raw = '[label](/url)';
		const clean = scanClean(raw);
		registerInlineSyntax('[', recognizeFootnote, { prefix: '[^', priority: 40 });
		expect(parseInline(raw, 0, raw.length)).toEqual(clean);
	});
});
