// @vitest-environment jsdom
//
// Where a per-block span meets bytes the single-block seam cannot mark soundly: an edge landing on
// whitespace, and a write whose delimiters form no construct. The decomposition and the direction
// rule are `./format-range.test.ts`.
//
// Miss-analysis: every partial span in that file started and ended on a word boundary, and every
// e2e range was a whole-document Mod+A, so no test ever put a space at a span's edge — the one
// place the source-mode wrap candidate list has a second entry the mode never reaches.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createSharingState } from '$lib/tree-operations/sharing';
import {
	applyCrossBlockFormat,
	planCrossBlockFormat
} from '$lib/selection/cross-block/format-range';
import type { SelectionPoint } from '$lib/selection/primitives';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** Plan and write in one go, so the assertions read as the document the user would see. */
function toggle(
	source: string,
	start: SelectionPoint,
	end: SelectionPoint,
	mode?: 'source' | 'live'
): string | null {
	const doc = parse(source);
	const plan = planCrossBlockFormat(doc, start, end, 'strong', mode);
	if (!plan) return null;
	applyCrossBlockFormat(doc, plan, createSharingState(), undefined);
	return serialize(doc);
}

describe('a span whose edge lands on whitespace', () => {
	const HEAD = { source: 'alpha\n\nbeta gamma\n', start: at([0], 0), end: at([1], 5) };
	const TAIL = { source: 'alpha beta\n\ngamma\n', start: at([0], 5), end: at([1], 5) };

	// Markdown opens and closes a run against a word, never a space, so an untrimmed edge yields
	// delimiters that form no construct — which a marker-painting mode would write anyway.
	for (const mode of [undefined, 'live'] as const) {
		const label = mode ?? 'source';

		it(`marks the word, not the space, on a head span — ${label}`, () => {
			expect(toggle(HEAD.source, HEAD.start, HEAD.end, mode)).toBe('**alpha**\n\n**beta** gamma\n');
		});

		it(`marks the word, not the space, on a tail span — ${label}`, () => {
			expect(toggle(TAIL.source, TAIL.start, TAIL.end, mode)).toBe('alpha **beta**\n\n**gamma**\n');
		});
	}

	// The trim moves the RESTORED range too: its endpoints come off the toggle's own selection, so
	// they land inside the marked run rather than around the space the span gave up.
	it('restores the range inside the marked run, not around the trimmed space', () => {
		const head = planCrossBlockFormat(
			parse(HEAD.source),
			HEAD.start,
			HEAD.end,
			'strong',
			undefined
		)!;
		expect(head.endOffset).toBe('**beta**'.length);

		const tail = planCrossBlockFormat(
			parse(TAIL.source),
			TAIL.start,
			TAIL.end,
			'strong',
			undefined
		)!;
		expect(tail.startOffset).toBe('alpha '.length);
	});

	// A dead second press is the visible half of the bug: bytes that form no construct read as
	// uncovered, so the range never flips back.
	it('leaves bytes a second press unwraps, rather than a dead key', () => {
		const once = toggle(HEAD.source, HEAD.start, HEAD.end)!;
		expect(toggle(once, at([0], 0), at([1], '**beta**'.length))).toBe('alpha\n\nbeta gamma\n');
	});
});

// The seam's wrap arm is UNVERIFIED wherever the mode paints delimiters, so a span whose write
// forms no construct still comes back as a candidate. Only the post-write coverage re-read
// refuses it, which is what keeps a second press from compounding delimiters.
describe('a write that formed no construct', () => {
	// `**alpha***` — the block's own trailing `*` joins the closing run and the pair never closes.
	const TRAILING_MARKER = 'alpha*\n\nbeta\n';

	it('is dropped, while the blocks that did form one are still marked', () => {
		expect(toggle(TRAILING_MARKER, at([0], 0), at([1], 4))).toBe('alpha*\n\n**beta**\n');
	});

	it('leaves a second press with nothing to add, rather than another layer', () => {
		const once = toggle(TRAILING_MARKER, at([0], 0), at([1], 4))!;
		expect(toggle(once, at([0], 0), at([1], '**beta**'.length))).toBeNull();
	});
});
