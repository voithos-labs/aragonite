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
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { fixtureReading } from '../harness/fixture-grammar';

// Live mode sends `splitNode` through the registered rebalancer, and every other mode cuts the
// bytes as typed; the registration is the production one, so the wiring is tested too.

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
	splitNode(doc, 0, offset, undefined, fixtureReading({}, mode));
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

	// The line-ending cut runs first: the ending terminates the first half, and the rebalance
	// closes the construct against it rather than against a line the user never typed.
	it('composes with the line-ending cut', () => {
		expect(rawsAfterSplit('**bo\nld**\n', 4, 'live')).toEqual(['**bo**\n', '**ld**\n']);
	});

	// The setext underline stays on the first half (cutKeepingStructure), and the bold that
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

// `splitNode` only dev-warns when the first half parses to several blocks, which no gate sees, so
// the block count is asserted here.
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

// The closing and reopening runs meet at the join with nothing between them, so the join drops
// them (`docs/design/live-mode.md` § 4.5 Joins clean up where they meet).
describe('Backspace merging the halves back', () => {
	it('restores the original bytes with no residue between the runs', () => {
		const doc = parse('Some **bold** text\n');
		splitNode(doc, 0, 9, undefined, fixtureReading({}, 'live'));
		mergeIntoPrevDeepLeaf(doc, 1, undefined, fixtureReading({}, 'live'));
		expect(doc.children[0].raw).toBe('Some **bold** text\n');
	});

	it('a merged split link is one link again', () => {
		const doc = parse('Visit [example](https://example.com) here\n');
		splitNode(doc, 0, 11, undefined, fixtureReading({}, 'live'));
		mergeIntoPrevDeepLeaf(doc, 1, undefined, fixtureReading({}, 'live'));
		expect(doc.children[0].raw).toBe('Visit [example](https://example.com) here\n');
	});

	// The byte-literal split merges back the same in every mode, so the cleanup belongs to the join.
	it('is not a defect of the byte-literal split, which round-trips', () => {
		const doc = parse('Some **bold** text\n');
		splitNode(doc, 0, 9, undefined, fixtureReading());
		mergeIntoPrevDeepLeaf(doc, 1, undefined, fixtureReading());
		expect(doc.children[0].raw).toBe('Some **bold** text\n');
	});

	// A merge with no mode is every other mode: the residue stays, because there the delimiters
	// were painted and the user could see what the two halves carried.
	it('a modeless merge keeps the halves byte-literal', () => {
		const doc = parse('Some **bold** text\n');
		splitNode(doc, 0, 9, undefined, fixtureReading({}, 'live'));
		mergeIntoPrevDeepLeaf(doc, 1, undefined, fixtureReading());
		expect(doc.children[0].raw).toBe('Some **bo****ld** text\n');
	});
});

// A parse-only consumer loads the descriptors and never the component layer that registers one.
describe('no rebalancer registered', () => {
	it('leaves live splits byte-literal rather than throwing', () => {
		__resetLiveSplitRebalancerForTests();
		expect(rawsAfterSplit('**bold**\n', 4, 'live')).toEqual(['**bo\n', 'ld**\n']);
	});
});

// Halves checked standalone may lack a final line ending, and side by side they then share a line.
// Miss-analysis: GH #61, every rebalance test asserted each half's bytes, never the pair's reload.
describe('rebalanced halves keep their line endings', () => {
	it('a half the rewrite left unterminated takes the block ending back', () => {
		const doc = parse('\\\n[**bold**](u`)`)  \n&notreal;\\\n[text](u`x`)foo\n\n\\*\n');

		splitNode(doc, 0, 32, undefined, fixtureReading({}, 'live'));

		for (const child of doc.children) expect(child.raw.endsWith('\n')).toBe(true);
		expectParseConverged(doc);
	});
});
