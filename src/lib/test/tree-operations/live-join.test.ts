// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { mergeIntoPrevDeepLeaf, mergeWithNext } from '$lib/tree-operations';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import type { PresentationMode } from '$lib/presentation-mode';
import { fixtureReading } from '../harness/fixture-grammar';
import { createSharingState } from '$lib/tree-operations/sharing';

// Both merge primitives, Backspace's deep-leaf write and Delete's reparse write, each in live mode
// and with no mode, which keeps the bytes as typed.

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

describe('each merge primitive drops the join pair in live', () => {
	it('mergeWithNext', () => {
		expect(
			merged(
				'live',
				(doc) => void mergeWithNext(doc, 0, fixtureReading({}, 'live'), createSharingState())
			)
		).toBe(REJOINED);
		expect(
			merged(undefined, (doc) => void mergeWithNext(doc, 0, fixtureReading(), createSharingState()))
		).toBe(RESIDUE);
	});

	it('mergeIntoPrevDeepLeaf', () => {
		expect(
			merged(
				'live',
				(doc) =>
					void mergeIntoPrevDeepLeaf(doc, 1, createSharingState(), fixtureReading({}, 'live'))
			)
		).toBe(REJOINED);
		expect(
			merged(
				undefined,
				(doc) => void mergeIntoPrevDeepLeaf(doc, 1, createSharingState(), fixtureReading())
			)
		).toBe(RESIDUE);
	});
});

describe('the join offset the caret rides moves with the runs the cleanup dropped', () => {
	// Dropping the closing run shortens the first half, so a `joinOffset` read before the cleanup
	// would put the caret two characters into the text below.
	it('reports the join in the bytes that were actually written', () => {
		const doc = parse(SPLIT_BOLD);
		const result = mergeIntoPrevDeepLeaf(doc, 1, createSharingState(), fixtureReading({}, 'live'));
		expect(result?.joinOffset).toBe(9);
		expect(doc.children[0].raw.slice(0, result!.joinOffset)).toBe('Some **bo');
	});

	it('the forward merge reports the same join', () => {
		const doc = parse(SPLIT_BOLD);
		expect(mergeWithNext(doc, 0, fixtureReading({}, 'live'), createSharingState()).joinOffset).toBe(
			9
		);
		expect(
			mergeWithNext(parse(SPLIT_BOLD), 0, fixtureReading(), createSharingState()).joinOffset
		).toBe(11);
	});
});

describe('a merge with nothing on its join', () => {
	it('joins two plain paragraphs unchanged', () => {
		const doc = parse('abc\n\ndef\n');
		mergeIntoPrevDeepLeaf(doc, 1, createSharingState(), fixtureReading({}, 'live'));
		expect(doc.children[0].raw).toBe('abcdef\n');
	});

	it('keeps the line ending the target block was written with', () => {
		const doc = parse('Some **bo**\r\n\r\n**ld** text\r\n');
		mergeIntoPrevDeepLeaf(doc, 1, createSharingState(), fixtureReading({}, 'live'));
		expect(doc.children[0].raw).toBe('Some **bold** text\r\n');
	});
});
