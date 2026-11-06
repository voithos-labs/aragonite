import { describe, expect, it } from 'vitest';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import type { BlockOpener } from '#lib/schema/block-openers.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';

const opener = (priority: number): BlockOpener => ({
	priority,
	tryOpen: () => null,
	interruptsParagraph: false
});

// Two kinds sharing one priority; alphabetical order (alpha < omega) is the tie-break.
const ALPHA = 'alpha-order' as AnyBlockKind;
const OMEGA = 'omega-order' as AnyBlockKind;
const TIE = 9000;

// The built-in openers stay registered; only this case's own kinds are read back.
function orderedKinds(kindByOpener: Map<BlockOpener, AnyBlockKind>): AnyBlockKind[] {
	return defaultGrammarView.orderedOpeners().flatMap((o) => kindByOpener.get(o) ?? []);
}

describe('opener order is registration-independent', () => {
	it('breaks an equal-priority tie by kind name even when registered omega-before-alpha', () => {
		const alpha = opener(TIE);
		const omega = opener(TIE);
		const kinds = new Map([
			[alpha, ALPHA],
			[omega, OMEGA]
		]);
		testLeaf(OMEGA, { opener: omega });
		testLeaf(ALPHA, { opener: alpha });
		expect(orderedKinds(kinds)).toEqual([ALPHA, OMEGA]);
	});

	it('yields the identical order when the same kinds register alpha-before-omega', () => {
		const alpha = opener(TIE);
		const omega = opener(TIE);
		const kinds = new Map([
			[alpha, ALPHA],
			[omega, OMEGA]
		]);
		testLeaf(ALPHA, { opener: alpha });
		testLeaf(OMEGA, { opener: omega });
		expect(orderedKinds(kinds)).toEqual([ALPHA, OMEGA]);
	});

	it('lets priority dominate the kind tie-break', () => {
		const alpha = opener(TIE + 1);
		const omega = opener(TIE);
		const kinds = new Map([
			[alpha, ALPHA],
			[omega, OMEGA]
		]);
		testLeaf(ALPHA, { opener: alpha });
		testLeaf(OMEGA, { opener: omega });
		expect(orderedKinds(kinds)).toEqual([OMEGA, ALPHA]);
	});
});
