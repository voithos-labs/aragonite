// @vitest-environment jsdom
// What the next typed letter would carry, and when the answer can skip the trial insertion: only
// where no character beside the caret could open or close a construct, no `[` or `<` before the
// caret has its closer after it, and no record waits there.
import { describe, expect, it } from 'vitest';
import { createNextByte, nextByte, typesInPlace } from '#lib/components/blocks/text/next-byte.js';
import { createCaretMemory } from '#lib/caret/caret-memory.js';
import { resolvedInlineContent } from '#lib/core/inline/inline-cache.js';
import type { NodeView } from '#lib/core/node-views.js';
import {
	createInsertionRecords,
	type InsertionRecord,
	type PlaceInsertion,
	type PreviewInsertion
} from '#lib/caret/next-insertion.js';
import { parseInline } from '#lib/core/inline/index.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import {
	normalizeLinkLabel,
	type LinkReferenceResolver
} from '#lib/core/inline/link-reference-resolver.js';
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

/** A document defining one reference label, `foo*`. */
const DEFINES_FOO: LinkReferenceResolver = (label) =>
	normalizeLinkLabel(label) === 'foo*' ? { url: '/u' } : undefined;

function answer(
	display: string,
	caret: number,
	pending: InlineMarkKind[] | null = null,
	records: InsertionRecord[] = [],
	resolver?: LinkReferenceResolver
) {
	const reading = fixtureReading({ resolver });
	const parse = (text: string) => parseInline(text, 0, text.length, resolver);
	const counted = countedPreview(records);
	const next = nextByte(caret, {
		display,
		inlines: parse(display),
		reading,
		pendingMarks: pending ? new Set(pending) : null,
		preview: counted.preview,
		seatOf: (at) => at,
		inlinesOf: parse
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

	// Miss-analysis: the property's lines held no raw HTML and no defined label, the two spans a
	// letter can make or break from inside, away from every delimiter.
	it.each([
		['inside a tag a letter makes valid HTML', '*<b 1c="*">', 4, undefined, []],
		['inside a defined label a letter breaks', '*[foo*]', 3, DEFINES_FOO, ['emphasis']]
	])('asks the trial insertion %s', (_name, display, caret, resolver, marks) => {
		expect(answer(display, caret, null, [], resolver)).toEqual({ marks, trials: 1 });
	});

	/** A document defining one reference label. */
	const defining =
		(defined: string): LinkReferenceResolver =>
		(label) =>
			normalizeLinkLabel(label) === defined ? { url: '/u' } : undefined;

	// Miss-analysis: the open-span check copied the closer rule and missed its exceptions, a `>` in
	// a quoted attribute, an escaped `]`, a `]` in a code span.
	it.each([
		['a `>` in a quoted attribute', '*<a x=">" 1b="*">', 10, undefined],
		['an escaped `]` in a defined label', '*[foo\\]bar*]', 8, defining('foo\\]bar*')],
		['a `]` in a code span in a defined label', '*[a `]` foo*]', 9, defining('a `]` foo*')]
	])('takes the trial insertion past %s', (_name, display, caret, resolver) => {
		const tried = answer(display, caret, null, [waitingAt(caret)], resolver);
		expect(answer(display, caret, null, [], resolver)).toEqual(tried);
	});

	it('reads pending marks through the insertion the chord promised', () => {
		expect(answer('plain words', 8, ['strong'])).toEqual({ marks: ['strong'], trials: 1 });
		expect(answer('**bold**', 4, ['strong'])).toEqual({ marks: [], trials: 1 });
	});
});

describe('the cached answer', () => {
	/** A letter at 6 in `**ab**` joins the bold, so a space typed there is held; a space alone
	 *  stays put, since a closer can't follow it. */
	const INTO_BOLD: PlaceInsertion = (before, edit, at) => {
		const typed = edit.text.slice(at, at + edit.text.length - before.length);
		if (at !== 6 || typed.trim() === '') return null;
		return {
			text: before.slice(0, 4) + typed + before.slice(4),
			caretAfter: 4 + typed.length,
			crossed: ['strong']
		};
	};

	it('answers again once a write lets go of the records it held', () => {
		const memory = createCaretMemory();
		const block = {};
		const opened = memory.holdInsertion(block, INTO_BOLD);
		opened.spend('**ab**', { text: '**ab** ', caretAfter: 7 });
		opened.finish(true);
		const reading = fixtureReading();
		const node = { kind: 'paragraph', leadingTrivia: '', raw: '**ab** \n' } as NodeView;
		const inlines = resolvedInlineContent(node, reading);
		const next = createNextByte({
			getEl: () => null,
			getNode: () => node,
			getInlines: () => inlines,
			reading,
			caretMemory: memory,
			preview: () => memory.previewInsertion(block, INTO_BOLD),
			offsetFor: (caret) => caret
		});

		// A composition holds the records while the ring asks.
		const composing = memory.holdInsertion(block, INTO_BOLD);
		expect(next(7).marks, 'while held').toEqual([]);
		composing.finish(false);

		expect(next(7).marks, 'once let go').toEqual(['strong']);
	});
});
