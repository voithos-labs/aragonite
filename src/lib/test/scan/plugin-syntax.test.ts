import { afterEach, describe, expect, it } from 'vitest';
import type { InlineNode } from '../../core/nodes';
import { parseInline } from '../../core/inline';
import {
	__resetInlineSyntaxForTests,
	getInlineSyntax,
	hasInlineSyntax,
	registerInlineSyntax,
	type InlineSyntaxRecognizer
} from '../../core/inline/scan/plugin-syntax';
import { assertTotalCoverage, textNode } from './scan-test-helpers';

afterEach(() => __resetInlineSyntaxForTests());

function mathNode(start: number, end: number): InlineNode {
	return { kind: 'math' as InlineNode['kind'], start, end };
}

// A minimal `$…$` recognizer: claims the span through the next in-range `$`.
const recognizeMath: InlineSyntaxRecognizer = (raw, pos, end) => {
	if (raw[pos] !== '$') return null;
	const close = raw.indexOf('$', pos + 1);
	if (close < 0 || close >= end) return null;
	return mathNode(pos, close + 1);
};

// ── Registry ─────────────────────────────────────────────────────────────────

describe('inline-syntax registry', () => {
	it('reports empty until a trigger is registered', () => {
		expect(hasInlineSyntax()).toBe(false);
		registerInlineSyntax('$', recognizeMath);
		expect(hasInlineSyntax()).toBe(true);
		expect(getInlineSyntax('$')).toBe(recognizeMath);
		expect(getInlineSyntax('%')).toBeUndefined();
	});

	it('registers a trigger once — a duplicate throws', () => {
		registerInlineSyntax('$', recognizeMath);
		expect(() => registerInlineSyntax('$', recognizeMath)).toThrow(/already registered/);
	});

	it('rejects a multi-character trigger', () => {
		expect(() => registerInlineSyntax('$$', recognizeMath)).toThrow(/single character/);
	});
});

// ── Scanner integration ──────────────────────────────────────────────────────

describe('inline-syntax recognition', () => {
	it('is dormant until registered — $ stays plain text', () => {
		const nodes = parseInline('a $x$ b', 0, 7);
		expect(nodes).toEqual([textNode(0, 7, 'a $x$ b')]);
	});

	it('claims the recognized span and tiles the rest as text', () => {
		registerInlineSyntax('$', recognizeMath);
		const nodes = parseInline('a $x$ b', 0, 7);
		assertTotalCoverage(nodes, 0, 7);
		expect(nodes).toEqual([textNode(0, 2, 'a '), mathNode(2, 5), textNode(5, 7, ' b')]);
	});

	it('leaves the trigger as literal text when the recognizer declines', () => {
		registerInlineSyntax('$', () => null);
		const nodes = parseInline('a$b', 0, 3);
		expect(nodes).toEqual([textNode(0, 3, 'a$b')]);
	});

	it('throws when a recognizer returns a non-advancing node', () => {
		registerInlineSyntax('$', (_raw, pos) => mathNode(pos, pos));
		expect(() => parseInline('a$b', 0, 3)).toThrow(/did not advance/);
	});
});
