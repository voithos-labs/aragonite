import { afterEach, describe, expect, it } from 'vitest';
import type { InlineNode } from '../../../../core/nodes';
import { parseInline } from '../../../../core/inline';
import {
	__resetInlineSyntaxForTests,
	getInlineRungs,
	hasInlineSyntax,
	registerInlineSyntax,
	type InlineSyntaxRecognizer
} from '../../../../core/inline/scan/plugin-syntax';
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
		expect(getInlineRungs('$')[0].recognizer).toBe(recognizeMath);
		expect(getInlineRungs('%')).toHaveLength(0);
	});

	it('registers a trigger once — a duplicate throws', () => {
		registerInlineSyntax('$', recognizeMath);
		expect(() => registerInlineSyntax('$', recognizeMath)).toThrow(/already registered/);
	});

	it('rejects a multi-character trigger', () => {
		expect(() => registerInlineSyntax('$$', recognizeMath)).toThrow(/single character/);
	});

	// The scanner consults the registry only in its `default` arm, so a trigger the
	// built-in switch already claims would register cleanly and then never fire.
	// Registration is the only place that can see the collision; a silent no-op in a
	// public API is the failure mode to make impossible.
	it.each(['\\', '`', '&', '*', '_', '~', '[', ']', '!', '<', '\n'])(
		'rejects %j — a trigger the built-in scanner already claims',
		(trigger) => {
			expect(() => registerInlineSyntax(trigger, recognizeMath)).toThrow(/built-in/);
			expect(hasInlineSyntax()).toBe(false);
		}
	);

	it('still accepts a trigger the built-in scanner ignores', () => {
		expect(() => registerInlineSyntax('$', recognizeMath)).not.toThrow();
		expect(() => registerInlineSyntax(':', recognizeMath)).not.toThrow();
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

	it('throws when a recognizer returns a node that starts off the cursor', () => {
		// appendNode flushes pending text to node.start; a start past the trigger would
		// gap coverage (and a start before it would overlap the prior run), so the seam
		// fails loud instead of tiling a torn tree.
		registerInlineSyntax('$', (_raw, pos) => mathNode(pos + 1, pos + 2));
		expect(() => parseInline('a$b', 0, 3)).toThrow(/started at 2, expected 1/);
	});
});
