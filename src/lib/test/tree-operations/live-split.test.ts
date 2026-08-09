// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { splitNode, mergeIntoPrevDeepLeaf } from '$lib/tree-operations';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import { rebalanceLiveSplit } from '$lib/components/blocks/text/live-split-rebalance';
import {
	registerLiveJoinSeamCleaner,
	registerLiveSplitRebalancer,
	__resetLiveJoinSeamCleanerForTests,
	__resetLiveSplitRebalancerForTests
} from '$lib/schema/inline-construct-policy';

// `splitNode`'s mode arm: live consults the one registered rebalancer, every other mode keeps the
// byte-literal cut. The registration is the production one — a stub here would pin the wiring and
// nothing else. The mode is the only difference between the two halves of each pair below.

beforeEach(() => {
	registerLiveSplitRebalancer(rebalanceLiveSplit);
	registerLiveJoinSeamCleaner(cleanLiveJoinSeam);
});

afterEach(() => {
	__resetLiveSplitRebalancerForTests();
	__resetLiveJoinSeamCleanerForTests();
});

const rawsAfterSplit = (source: string, offset: number, mode: 'live' | 'source' | undefined) => {
	const doc = parse(source);
	splitNode(doc, 0, offset, mode, undefined);
	return doc.children.map((child) => child.raw);
};

describe('live mode rebalances the halves; the other modes do not', () => {
	it('Enter inside bold yields two balanced constructs', () => {
		expect(rawsAfterSplit('**bold**\n', 4, 'live')).toEqual(['**bo**\n', '**ld**\n']);
	});

	it('the same cut in source mode stays byte-literal', () => {
		expect(rawsAfterSplit('**bold**\n', 4, 'source')).toEqual(['**bo\n', 'ld**\n']);
	});

	it('a caller with no mode gets the byte-literal cut', () => {
		expect(rawsAfterSplit('**bold**\n', 4, undefined)).toEqual(['**bo\n', 'ld**\n']);
	});

	it('a split link duplicates its url', () => {
		expect(rawsAfterSplit('[text](url)\n', 3, 'live')).toEqual(['[te](url)\n', '[xt](url)\n']);
	});

	// GH #95's cut rule runs first: the ending terminates the FIRST half, and the rebalance
	// closes the construct against it rather than against a line the user never typed.
	it('composes with the line-ending cut', () => {
		expect(rawsAfterSplit('**bo\nld**\n', 4, 'live')).toEqual(['**bo**\n', '**ld**\n']);
	});

	// The setext underline stays on the first half (structuralSuffixSplit), and the bold that
	// spanned the cut closes on both sides of it.
	it('composes with the structural-suffix split', () => {
		expect(rawsAfterSplit('**bold**\n===\n', 4, 'live')).toEqual(['**bo**\n===\n', '**ld**\n']);
	});

	it('a heading keeps its prefix and hands a paragraph the reopened pair', () => {
		expect(rawsAfterSplit('## **bold**\n', 7, 'live')).toEqual(['## **bo**\n', '**ld**\n']);
	});

	it('a cut outside every construct is untouched by the mode', () => {
		expect(rawsAfterSplit('Some **bold** text\n', 3, 'live')).toEqual([
			'Som\n',
			'e **bold** text\n'
		]);
	});
});

// `splitNode` only dev-warns when the first half parses to more than one block, and a devWarn is
// invisible to every gate. The rewrite closes that off by construction — it refuses any candidate
// whose halves are not one prose block each — so the block count is asserted here instead.
describe('a rebalanced split always produces exactly two blocks', () => {
	const adversarial: [string, number][] = [
		['# **head**\n', 5],
		['**bold**\n===\n', 4],
		['**a `b` c**\n', 6],
		['**[a](u)**\n', 4],
		['   **ind**\n', 6],
		['**a - b**\n', 4],
		['*a **b** c*\n', 6],
		['[a **b** c](u)\n', 7]
	];

	for (const [source, offset] of adversarial) {
		it(`${JSON.stringify(source)}@${offset}`, () => {
			expect(rawsAfterSplit(source, offset, 'live')).toHaveLength(2);
		});
	}

	it('rewrote the set rather than declining it, so the rule above is not vacuous', () => {
		const rewritten = adversarial.filter(
			([source, offset]) =>
				JSON.stringify(rawsAfterSplit(source, offset, 'live')) !==
				JSON.stringify(rawsAfterSplit(source, offset, 'source'))
		);
		expect(rewritten.length).toBeGreaterThanOrEqual(6);
	});
});

// The split's inverse: the closing and reopening runs meet at the seam enclosing nothing, and the
// join drops them (§ 4.5). Without the cleanup these wrote `Some **bo****ld** text`, gaining a
// pair on every repeat, and returned a split link as two anchors sharing one destination.
describe('Backspace merging the halves back', () => {
	it('restores the original bytes with no residue between the runs', () => {
		const doc = parse('Some **bold** text\n');
		splitNode(doc, 0, 9, 'live', undefined);
		mergeIntoPrevDeepLeaf(doc, 1, undefined, 'live', undefined);
		expect(doc.children[0].raw).toBe('Some **bold** text\n');
	});

	it('a merged split link is one link again', () => {
		const doc = parse('Visit [example](https://example.com) here\n');
		splitNode(doc, 0, 11, 'live', undefined);
		mergeIntoPrevDeepLeaf(doc, 1, undefined, 'live', undefined);
		expect(doc.children[0].raw).toBe('Visit [example](https://example.com) here\n');
	});

	// The byte-literal split merges back identically in every mode, which is what made the residue
	// a regression of the rewrite rather than a pre-existing hole — and the join, not the split,
	// is where the cleaning belongs.
	it('is not a defect of the byte-literal split, which round-trips', () => {
		const doc = parse('Some **bold** text\n');
		splitNode(doc, 0, 9, undefined, undefined);
		mergeIntoPrevDeepLeaf(doc, 1, undefined, undefined, undefined);
		expect(doc.children[0].raw).toBe('Some **bold** text\n');
	});

	// A merge with no mode is every other mode: the residue stays, because there the delimiters
	// were painted and the user could see what the two halves carried.
	it('a modeless merge keeps the halves byte-literal', () => {
		const doc = parse('Some **bold** text\n');
		splitNode(doc, 0, 9, 'live', undefined);
		mergeIntoPrevDeepLeaf(doc, 1, undefined, undefined, undefined);
		expect(doc.children[0].raw).toBe('Some **bo****ld** text\n');
	});
});

// A parse-only consumer loads the descriptors and never the component layer that fills the slot.
describe('no rebalancer registered', () => {
	it('leaves live splits byte-literal rather than throwing', () => {
		__resetLiveSplitRebalancerForTests();
		expect(rawsAfterSplit('**bold**\n', 4, 'live')).toEqual(['**bo\n', 'ld**\n']);
	});
});
