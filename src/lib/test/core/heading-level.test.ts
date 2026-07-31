import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { headingLevel } from '$lib/core/nodes';

// Exists because `isBuiltinBlockNode` — the narrowing gate for `metadata.level` — is
// deliberately off the authoring barrel a plugin reads.
describe('headingLevel', () => {
	it('reads each ATX heading depth', () => {
		for (const level of [1, 3, 6]) {
			const node = parse(`${'#'.repeat(level)} title\n`).children[0];
			expect(headingLevel(node)).toBe(level);
		}
	});

	it('reads setext heading levels (= is 1, - is 2)', () => {
		expect(headingLevel(parse('Title\n=====\n').children[0])).toBe(1);
		expect(headingLevel(parse('Title\n-----\n').children[0])).toBe(2);
	});

	it('returns null for a non-heading node', () => {
		expect(headingLevel(parse('plain paragraph\n').children[0])).toBeNull();
	});

	it('returns null for a plugin block kind (branded, not a built-in heading)', () => {
		const pluginNode = { kind: 'toc' as unknown as never, leadingTrivia: '', raw: '[[toc]]\n' };
		expect(headingLevel(pluginNode as never)).toBeNull();
	});
});
