// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { mergeIntoPrevDeepLeaf, mergeWithNext, mergeWithPrevious } from '$lib/tree-operations';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import type { PresentationMode } from '$lib/presentation-mode';

// All THREE merge primitives, because the Backspace cascade reaches a different one per shape and
// a rule carried at two of three is the audit's dominant bug. Each case is run in live and again
// with no mode, so the byte-literal behavior every other mode keeps is pinned beside the rewrite.

beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterEach(() => __resetLiveJoinSeamCleanerForTests());

const SPLIT_BOLD = 'Some **bo**\n\n**ld** text\n';
const REJOINED = 'Some **bold** text\n';
const RESIDUE = 'Some **bo****ld** text\n';

const merged = (
	mode: PresentationMode | undefined,
	merge: (doc: ReturnType<typeof parse>) => void
) => {
	const doc = parse(SPLIT_BOLD);
	merge(doc);
	return doc.children[0].raw;
};

describe('each merge primitive drops the seam pair in live', () => {
	it('mergeWithPrevious', () => {
		expect(merged('live', (doc) => void mergeWithPrevious(doc, 1, 'live'))).toBe(REJOINED);
		expect(merged(undefined, (doc) => void mergeWithPrevious(doc, 1, undefined))).toBe(RESIDUE);
	});

	it('mergeWithNext', () => {
		expect(merged('live', (doc) => void mergeWithNext(doc, 0, 'live'))).toBe(REJOINED);
		expect(merged(undefined, (doc) => void mergeWithNext(doc, 0, undefined))).toBe(RESIDUE);
	});

	it('mergeIntoPrevDeepLeaf', () => {
		expect(merged('live', (doc) => void mergeIntoPrevDeepLeaf(doc, 1, undefined, 'live'))).toBe(
			REJOINED
		);
		expect(
			merged(undefined, (doc) => void mergeIntoPrevDeepLeaf(doc, 1, undefined, undefined))
		).toBe(RESIDUE);
	});
});

describe('the join offset the caret rides moves with the runs the cleanup dropped', () => {
	// The caret lands where the two blocks MET. Dropping the closing run ahead of the seam shortens
	// the first half's bytes, so a `joinOffset` read before the cleanup would seat the caret two
	// characters into the text below it.
	it('reports the seam in the bytes that were actually written', () => {
		const doc = parse(SPLIT_BOLD);
		const result = mergeIntoPrevDeepLeaf(doc, 1, undefined, 'live');
		expect(result?.joinOffset).toBe(9);
		expect(doc.children[0].raw.slice(0, result!.joinOffset)).toBe('Some **bo');
	});

	it('the forward merge reports the same seam', () => {
		const doc = parse(SPLIT_BOLD);
		expect(mergeWithNext(doc, 0, 'live').joinOffset).toBe(9);
		expect(mergeWithNext(parse(SPLIT_BOLD), 0, undefined).joinOffset).toBe(11);
	});
});

describe('a merge with nothing on its seam', () => {
	it('joins two plain paragraphs unchanged', () => {
		const doc = parse('abc\n\ndef\n');
		void mergeWithPrevious(doc, 1, 'live');
		expect(doc.children[0].raw).toBe('abcdef\n');
	});

	it('keeps the line ending the target block was written with', () => {
		const doc = parse('Some **bo**\r\n\r\n**ld** text\r\n');
		mergeIntoPrevDeepLeaf(doc, 1, undefined, 'live');
		expect(doc.children[0].raw).toBe('Some **bold** text\r\n');
	});
});
