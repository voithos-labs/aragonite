// @vitest-environment jsdom
//
// The cross-block toggle's decomposition and its direction rule: the anchor's tail, each middle
// block's content, the focus block's head, all rewritten the one way the range's own coverage
// says. Whether a press LANDS is the commit arm's; which spans it would touch is this file's.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createSharingState } from '$lib/tree-operations/sharing';
import {
	applyCrossBlockFormat,
	crossBlockActiveFormats,
	planCrossBlockFormat
} from '$lib/selection/cross-block/format-range';
import type { SelectionPoint } from '$lib/selection/primitives';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** Plan and write in one go, so the assertions read as the document the user would see. */
function toggle(
	source: string,
	start: SelectionPoint,
	end: SelectionPoint,
	format: 'strong' | 'emphasis' | 'inlineCode' = 'strong',
	mode?: 'source' | 'live'
): string | null {
	const doc = parse(source);
	const plan = planCrossBlockFormat(doc, start, end, format, mode);
	if (!plan) return null;
	applyCrossBlockFormat(doc, plan, createSharingState(), undefined);
	return serialize(doc);
}

describe('the spans a range decomposes into', () => {
	it('wraps the anchor tail, the whole middle, and the focus head', () => {
		expect(toggle('alpha one\n\nbeta\n\ngamma two\n', at([0], 6), at([2], 5))).toBe(
			'alpha **one**\n\n**beta**\n\n**gamma** two\n'
		);
	});

	it('leaves a blank span out: a whitespace-only tail and a heading with no content', () => {
		expect(toggle('alpha \n\n#\n\nbeta\n', at([0], 5), at([2], 4))).toBe(
			'alpha \n\n#\n\n**beta**\n'
		);
	});

	it('reaches a container child, and its own raw re-emits around the write', () => {
		expect(toggle('alpha\n\n> quoted\n', at([0], 0), at([1, 0], 6))).toBe(
			'**alpha**\n\n> **quoted**\n'
		);
	});

	it('skips a non-prose block between two that participate', () => {
		expect(toggle('alpha\n\n```\nx = 1\n```\n\nbeta\n', at([0], 0), at([2], 4))).toBe(
			'**alpha**\n\n```\nx = 1\n```\n\n**beta**\n'
		);
	});

	it('writes nothing when no block participates', () => {
		expect(toggle('```\nx = 1\n```\n\n```\ny = 2\n```\n', at([0], 0), at([1], 5))).toBeNull();
	});

	it('marks the content, never the block marker a heading owns', () => {
		expect(toggle('# Title\n\nbody\n', at([0], 0), at([1], 4))).toBe('# **Title**\n\n**body**\n');
	});
});

describe('direction is the whole range’s coverage, not each block’s', () => {
	const TWO_BOLD = '**alpha**\n\n**beta**\n';

	it('every span covered unapplies everywhere', () => {
		expect(toggle(TWO_BOLD, at([0], 0), at([1], 8))).toBe('alpha\n\nbeta\n');
	});

	it('one span uncovered applies, and the covered one is left exactly as it was', () => {
		expect(toggle('**alpha**\n\nbeta\n', at([0], 0), at([1], 4))).toBe('**alpha**\n\n**beta**\n');
	});

	// The single-block seam reads each span alone, so without the range's direction pinned an
	// apply press would walk the covered block back the other way.
	it('an apply press is idempotent over an already-covered span', () => {
		const once = toggle('**alpha**\n\nbeta\n', at([0], 0), at([1], 4))!;
		expect(toggle(once, at([0], 0), at([1], 8))).toBe('alpha\n\nbeta\n');
	});

	it('a code span, whose delimiters are literal content, follows the same rule', () => {
		expect(toggle('`alpha`\n\nbeta\n', at([0], 0), at([1], 4), 'inlineCode')).toBe(
			'`alpha`\n\n`beta`\n'
		);
	});
});

describe('the pressed-state read', () => {
	const active = (source: string, start: SelectionPoint, end: SelectionPoint) =>
		crossBlockActiveFormats(parse(source), start, end).has('strong');

	it('is true only when every participating span carries the mark', () => {
		expect(active('**alpha**\n\n**beta**\n', at([0], 0), at([1], 8))).toBe(true);
		expect(active('**alpha**\n\nbeta\n', at([0], 0), at([1], 4))).toBe(false);
	});

	it('is false where no block participates at all', () => {
		expect(active('```\nx = 1\n```\n\n```\ny = 2\n```\n', at([0], 0), at([1], 5))).toBe(false);
	});

	// A skipped block must not be read as covered: a range whose only prose block is plain is
	// an apply, however many code blocks sit beside it.
	it('ignores the blocks it skips rather than counting them as covered', () => {
		expect(active('```\nx = 1\n```\n\nbeta\n', at([0], 0), at([1], 4))).toBe(false);
	});
});

describe('the endpoints the plan hands back', () => {
	it('shift by each endpoint block’s own delta', () => {
		const doc = parse('alpha one\n\ngamma two\n');
		const plan = planCrossBlockFormat(doc, at([0], 6), at([1], 5), 'strong', undefined)!;
		// `alpha **one**` — the tail span now starts two bytes later and ends at the closer.
		expect(plan.startOffset).toBe(6);
		expect(plan.endOffset).toBe(9);
	});
});
