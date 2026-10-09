// @vitest-environment jsdom
// What the next typed letter would carry, and when the answer can skip the trial insertion: only
// where no character beside the caret could open or close a construct and no record waits there.
import { describe, expect, it } from 'vitest';
import { nextByte, typesInPlace } from '#lib/components/blocks/text/next-byte.js';
import {
	createInsertionRecords,
	type InsertionRecord,
	type PreviewInsertion
} from '#lib/caret/next-insertion.js';
import { parseInline } from '#lib/core/inline/index.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import type { InlineMarkKind } from '#lib/schema/inline-construct-policy.js';

describe('typesInPlace', () => {
	it.each([
		['between two letters', 'bold', 2],
		['between a letter and a space', 'a b', 1],
		['at the text’s start, before a letter', 'abc', 0],
		['at the text’s end, after a letter', 'abc', 3],
		['beside a combining mark', 'éx', 2],
		['in empty text', '', 0]
	])('types in place %s', (_name, text, caret) => {
		expect(typesInPlace(text, caret)).toBe(true);
	});

	it.each([
		['after a closer', '**b**', 5],
		['before an opener', 'a **b**', 2],
		['inside an empty pair', '****', 2],
		['beside an intraword underscore', 'b_c_d', 2],
		['after a backtick', '`c` d', 3],
		['beside a whole surrogate pair', 'b😀', 1],
		['after a surrogate pair', 'b😀', 3]
	])('asks the trial insertion %s', (_name, text, caret) => {
		expect(typesInPlace(text, caret)).toBe(false);
	});
});

/** A record that waits at `at` and adds nothing, the way a held space waits past a closer. */
const waitingAt = (at: number): InsertionRecord => ({
	take: () => ({ at, apply: () => null, release: () => {} }),
	end: () => false
});

/** A dry run of `records` that counts its trial insertions. */
function countedPreview(records: InsertionRecord[] = []): {
	preview: PreviewInsertion;
	trials: () => number;
} {
	const preview = createInsertionRecords(records).preview({}, null);
	let trials = 0;
	return {
		preview: {
			...preview,
			spend: (...args) => (trials++, preview.spend(...args)),
			spendInPlace: (...args) => (trials++, preview.spendInPlace(...args))
		},
		trials: () => trials
	};
}

function answer(
	display: string,
	caret: number,
	pending: InlineMarkKind[] | null = null,
	records: InsertionRecord[] = []
) {
	const reading = fixtureReading();
	const counted = countedPreview(records);
	const next = nextByte(caret, {
		display,
		inlines: parseInline(display, 0, display.length),
		reading,
		pendingMarks: pending ? new Set(pending) : null,
		preview: counted.preview,
		inlinesOf: (text) => parseInline(text, 0, text.length)
	});
	return { marks: next.marks, trials: counted.trials() };
}

describe('nextByte', () => {
	it.each([
		['mid-word in bold', 'a **bold** b', 6, ['strong'], 0],
		['mid-word in plain text', 'a **bold** bc', 12, [], 0],
		['inside bold italic', '***both***', 5, ['strong', 'emphasis'], 0],
		['at an empty pair', 'b **** c', 4, ['strong'], 1],
		['at bold’s inside end', 'a **bold** b', 8, ['strong'], 1],
		['past bold’s closer', 'a **bold** b', 10, [], 1]
	])('%s', (_name, display, caret, marks, trials) => {
		expect(answer(display, caret)).toEqual({ marks, trials });
	});

	it('asks the trial insertion where a record waits, even mid-word', () => {
		expect(answer('bold text', 2, null, [waitingAt(2)])).toEqual({ marks: [], trials: 1 });
	});

	it('reads pending marks through the insertion the chord promised', () => {
		expect(answer('plain words', 8, ['strong'])).toEqual({ marks: ['strong'], trials: 1 });
		expect(answer('**bold**', 4, ['strong'])).toEqual({ marks: [], trials: 1 });
	});
});
