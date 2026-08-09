// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { rangeDelete } from '$lib/selection/range-delete';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createSharingState } from '$lib/tree-operations/sharing';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import type { PresentationMode } from '$lib/presentation-mode';

// `rangeDelete`'s mode arm, the seam every cross-block delete, cut, type-over and paste's delete
// half crosses. The registration is the production one — a stub here would pin the wiring and
// nothing else. The mode is the only difference between the two halves of each pair below.

beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterEach(() => __resetLiveJoinSeamCleanerForTests());

function deleteRange(
	source: string,
	start: { path: number[]; offset: number },
	end: { path: number[]; offset: number },
	mode: PresentationMode | undefined
): string {
	const doc = parse(source);
	rangeDelete(doc, start, end, createSharingState(), undefined, mode);
	return serialize(doc);
}

const at = (block: number, offset: number) => ({ path: [block], offset });

describe('a selection running out of one construct and into another', () => {
	// § 5's row: the reader never saw either run, so the joined TEXT is what survives.
	it('bold to italic leaves no delimiter on screen', () => {
		expect(deleteRange('**bold** and *italic*\n', at(0, 4), at(0, 16), 'live')).toBe('boalic\n');
	});

	it('the same selection in source mode stays byte-literal', () => {
		expect(deleteRange('**bold** and *italic*\n', at(0, 4), at(0, 16), 'source')).toBe(
			'**boalic*\n'
		);
	});

	it('a caller with no mode gets the byte-literal cut', () => {
		expect(deleteRange('**bold** and *italic*\n', at(0, 4), at(0, 16), undefined)).toBe(
			'**boalic*\n'
		);
	});

	it('cross-block, the joined bytes carry neither stranded run', () => {
		expect(deleteRange('a **bold** b\n\nc *ital* d\n', at(0, 5), at(1, 5), 'live')).toBe(
			'a bal d\n'
		);
	});

	// The same construct on both sides survives the cut: its opener and closer meet across the
	// seam, so the literal join already says what the reader saw and nothing is dropped.
	it('cutting inside one construct keeps it whole', () => {
		expect(deleteRange('**bold**\n', at(0, 3), at(0, 5), 'live')).toBe('**bd**\n');
	});
});

describe('a selection that closes a construct against the one below it', () => {
	// The delete's own inverse of the split: what is left of the two blocks meets closer-to-opener.
	it('the pair enclosing nothing at the seam goes', () => {
		expect(deleteRange('Some **bo**\n\nX**ld** text\n', at(0, 11), at(1, 1), 'live')).toBe(
			'Some **bold** text\n'
		);
	});

	it('the same delete in source mode keeps the residue', () => {
		expect(deleteRange('Some **bo**\n\nX**ld** text\n', at(0, 11), at(1, 1), 'source')).toBe(
			'Some **bo****ld** text\n'
		);
	});
});

describe('joins the seam has no business touching', () => {
	it('leaves an ordinary paragraph merge alone', () => {
		expect(deleteRange('hello world\n\nfoo bar\n', at(0, 6), at(1, 4), 'live')).toBe('hello bar\n');
	});

	it('a parse-only consumer with no cleaner registered still joins', () => {
		__resetLiveJoinSeamCleanerForTests();
		expect(deleteRange('**bold** and *italic*\n', at(0, 4), at(0, 16), 'live')).toBe('**boalic*\n');
	});
});
