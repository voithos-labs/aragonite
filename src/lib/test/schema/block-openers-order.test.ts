import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyBlockKind } from '$lib/core/nodes';
import {
	registerBlockOpener,
	getOrderedOpeners,
	__resetBlockOpenersForTests,
	type BlockOpener
} from '$lib/schema/block-openers';

const opener = (priority: number): BlockOpener => ({
	priority,
	tryOpen: () => null,
	interruptsParagraph: false
});

// Two kinds sharing one priority; alphabetical order (alpha < omega) is the tie-break.
const ALPHA = 'alpha-order' as AnyBlockKind;
const OMEGA = 'omega-order' as AnyBlockKind;
const TIE = 9000;

function orderedKinds(kindByOpener: Map<BlockOpener, AnyBlockKind>): AnyBlockKind[] {
	return getOrderedOpeners().map((o) => kindByOpener.get(o)!);
}

describe('opener order is registration-independent', () => {
	beforeEach(() => __resetBlockOpenersForTests());

	it('breaks an equal-priority tie by kind name even when registered omega-before-alpha', () => {
		const alpha = opener(TIE);
		const omega = opener(TIE);
		const kinds = new Map([
			[alpha, ALPHA],
			[omega, OMEGA]
		]);
		registerBlockOpener(OMEGA, omega);
		registerBlockOpener(ALPHA, alpha);
		expect(orderedKinds(kinds)).toEqual([ALPHA, OMEGA]);
	});

	it('yields the identical order when the same kinds register alpha-before-omega', () => {
		const alpha = opener(TIE);
		const omega = opener(TIE);
		const kinds = new Map([
			[alpha, ALPHA],
			[omega, OMEGA]
		]);
		registerBlockOpener(ALPHA, alpha);
		registerBlockOpener(OMEGA, omega);
		expect(orderedKinds(kinds)).toEqual([ALPHA, OMEGA]);
	});

	it('lets priority dominate the kind tie-break', () => {
		const alpha = opener(TIE + 1);
		const omega = opener(TIE);
		const kinds = new Map([
			[alpha, ALPHA],
			[omega, OMEGA]
		]);
		registerBlockOpener(ALPHA, alpha);
		registerBlockOpener(OMEGA, omega);
		expect(orderedKinds(kinds)).toEqual([OMEGA, ALPHA]);
	});
});
