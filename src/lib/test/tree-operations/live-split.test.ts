// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { splitNode, mergeIntoPrevDeepLeaf } from '$lib/tree-operations';
import { rebalanceLiveSplit } from '$lib/components/blocks/text/live-split-rebalance';
import {
	registerLiveSplitRebalancer,
	__resetLiveSplitRebalancerForTests
} from '$lib/schema/inline-construct-policy';

// `splitNode`'s mode arm: live consults the one registered rebalancer, every other mode keeps the
// byte-literal cut. The registration is the production one — a stub here would pin the wiring and
// nothing else. The mode is the only difference between the two halves of each pair below.

beforeEach(() => {
	registerLiveSplitRebalancer(rebalanceLiveSplit);
});

afterEach(() => {
	__resetLiveSplitRebalancerForTests();
});

const rawsAfterSplit = (source: string, offset: number, mode: 'live' | 'source' | undefined) => {
	const doc = parse(source);
	splitNode(doc, 0, offset, mode);
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

/**
 * KNOWN FAILING, owned by the join-seam task (Task 12). Backspace at the second half's start
 * merges the halves with `trimTrailingLineEnding(prev.raw) + curr.raw` and no seam cleanup, so
 * the closing and reopening runs land back to back: `Some **bo****ld** text`, growing by a pair
 * on every repeat, and a split link comes back as two anchors sharing one destination. § 4.4
 * declares that residue unrepresentable in live editing. These rows assert the CORRECT bytes, so
 * the day the join cleanup lands they pass and `it.fails` turns red — that is the removal trigger.
 */
describe('Backspace merging the halves back (known failing until the join seam cleans up)', () => {
	it.fails('restores the original bytes with no residue between the runs', () => {
		const doc = parse('Some **bold** text\n');
		splitNode(doc, 0, 9, 'live');
		mergeIntoPrevDeepLeaf(doc, 1, undefined, undefined);
		expect(doc.children[0].raw).toBe('Some **bold** text\n');
	});

	it.fails('a merged split link is one link again', () => {
		const doc = parse('Visit [example](https://example.com) here\n');
		splitNode(doc, 0, 11, 'live');
		mergeIntoPrevDeepLeaf(doc, 1, undefined, undefined);
		expect(doc.children[0].raw).toBe('Visit [example](https://example.com) here\n');
	});

	// The byte-literal halves DO merge back identically, which is what makes the shape above a
	// regression rather than a pre-existing hole: the rewrite is what gives the join something to
	// clean, and the join is where the cleaning belongs (§ 4.5).
	it('is not a defect of the byte-literal split, which round-trips', () => {
		const doc = parse('Some **bold** text\n');
		splitNode(doc, 0, 9, undefined);
		mergeIntoPrevDeepLeaf(doc, 1, undefined, undefined);
		expect(doc.children[0].raw).toBe('Some **bold** text\n');
	});
});

// A parse-only consumer loads the descriptors and never the component layer that fills the slot.
describe('no rebalancer registered', () => {
	it('leaves live splits byte-literal rather than throwing', () => {
		__resetLiveSplitRebalancerForTests();
		expect(rawsAfterSplit('**bold**\n', 4, 'live')).toEqual(['**bo\n', 'ld**\n']);
	});
});
