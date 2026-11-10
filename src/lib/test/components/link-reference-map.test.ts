// The rebuild gate reads the blocks a write replaced, at any depth, on either side of it; a kept set
// of definitions is checked in dev (G1.206).
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import {
	advanceSignatureEpoch,
	definitionsAfter,
	lrdMapCouldChange
} from '#lib/components/link-reference-map.js';
import { definitionsOf } from '#lib/core/inline/scan/definitions.js';
import { NOTHING_REPLACED } from '#lib/editor-actions/commit/emit-edit.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

const blocks = (source: string) => parse(source).children;

describe('lrdMapCouldChange', () => {
	it.each([
		['a write that names nothing', 'unknown' as const, true],
		['a write that replaced no block', NOTHING_REPLACED, false],
		['prose replaced by prose', { before: blocks('a\n'), after: blocks('b\n') }, false],
		['a definition taken out', { before: blocks('[d]: /u\n'), after: blocks('b\n') }, true],
		['a definition put in, inside a quote', { before: [], after: blocks('> [d]: /u\n') }, true]
	])('%s: %s', (_, replaced, expected) => {
		expect(lrdMapCouldChange(replaced)).toBe(expected);
	});
});

describe('definitionsAfter', () => {
	const doc = parse('see [d][d]\n\n[d]: /u\n');
	const signature = definitionsOf(doc.children).signature;

	it('rebuilds for a write that may have changed them', () => {
		expect(definitionsAfter(doc, 'unknown', signature)?.resolve('d')).toEqual({ url: '/u' });
	});

	it('keeps them for one that replaced none, quietly when they did not change', () => {
		expect(definitionsAfter(doc, NOTHING_REPLACED, signature)).toBeNull();
		expect(takeDevWarns()).toEqual([]);
	});

	it('warns in dev when a write that replaced none changed them (G1.206)', () => {
		expect(definitionsAfter(doc, NOTHING_REPLACED, '')).toBeNull();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:definitions-kept']);
	});
});

describe('advanceSignatureEpoch', () => {
	const sigOf = (src: string) => definitionsOf(parse(src).children).signature;

	it('holds the epoch when a rebuild yields an identical signature', () => {
		// A counter that bumped on every rebuild would invalidate every block containing a bracket
		// on every commit (G4.7).
		const sig = sigOf('[d]: https://example.com\n');
		const held = advanceSignatureEpoch(sig, 5, sigOf('[d]: https://example.com\n'));
		expect(held.epoch).toBe(5);
		expect(held.signature).toBe(sig);
	});

	it('bumps the epoch once when a definition edit changes the signature', () => {
		const before = sigOf('[d]: https://old.com\n');
		const after = sigOf('[d]: https://new.com\n');
		expect(after).not.toBe(before);
		const bumped = advanceSignatureEpoch(before, 5, after);
		expect(bumped.epoch).toBe(6);
		expect(bumped.signature).toBe(after);
	});
});
