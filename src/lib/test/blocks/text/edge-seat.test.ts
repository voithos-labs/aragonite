// The typing seat's resolution table: construct edge × policy × arrival → the raw offset a
// typed byte belongs at. Pure over the inline tree, so no DOM and no dispatch here — the
// dispatch arm that consumes it is pinned in `edge-policy-construct-seat.test.ts`.
import { describe, expect, it } from 'vitest';
import { resolveEdgeSeat } from '$lib/components/blocks/text/edge-seat';
import { parseInline } from '$lib/core/inline';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';

function seatIn(source: string, offset: number, affinity: EdgeAffinity | null) {
	return resolveEdgeSeat(offset, parseInline(source, 0, source.length), affinity);
}

// `Some **bold** text`: strong [5,13), `bold` [7,11). The leading run is [5,7), the trailing
// run [11,13), and each run's two boundaries paint at one pixel.
describe('a symmetric pair follows the arrival', () => {
	const BOLD = 'Some **bold** text';

	it('leaves the near side alone at either edge — where native insertion already lands', () => {
		expect(seatIn(BOLD, 11, 'inside')).toBeNull();
		expect(seatIn(BOLD, 5, 'inside')).toBeNull();
	});

	it('moves to the far side when the arrival came from there', () => {
		expect(seatIn(BOLD, 11, 'outside')).toEqual({ offset: 13, kind: 'strong' });
		expect(seatIn(BOLD, 5, 'outside')).toEqual({ offset: 7, kind: 'strong' });
	});

	it('defaults to the near side with no arrival on record', () => {
		expect(seatIn(BOLD, 11, null)).toBeNull();
	});

	// The far boundary names the same pixel, so the seat answers it the same way.
	it('answers a caret already on the far boundary', () => {
		expect(seatIn(BOLD, 13, 'inside')).toEqual({ offset: 11, kind: 'strong' });
		expect(seatIn(BOLD, 13, 'outside')).toBeNull();
	});

	it('declines an offset no marker run touches', () => {
		for (const offset of [0, 4, 9, 15]) expect(seatIn(BOLD, offset, 'outside')).toBeNull();
	});

	// A code span carries its content as text, not children; its fences still bound it.
	it('bounds a code span by its backtick runs', () => {
		expect(seatIn('a `code` b', 7, 'outside')).toEqual({ offset: 8, kind: 'inlineCode' });
		expect(seatIn('a `code` b', 7, 'inside')).toBeNull();
	});

	// The innermost pair owns its own edge, or a nested emphasis would never extend.
	it('the innermost construct claims a shared edge', () => {
		expect(seatIn('**a *b* c**', 6, 'outside')).toEqual({ offset: 7, kind: 'emphasis' });
	});
});

describe('a never-extend construct ignores the arrival', () => {
	const LINK = 'A [link](http://e.com) tail';

	it('seats outside the construct at the trailing edge, whatever the arrival', () => {
		for (const affinity of ['inside', 'outside', null] as const) {
			expect(seatIn(LINK, 7, affinity)).toEqual({ offset: 22, kind: 'link' });
		}
	});

	it('seats outside the construct at the leading edge, which is already the near side', () => {
		for (const affinity of ['inside', 'outside', null] as const) {
			expect(seatIn(LINK, 2, affinity)).toBeNull();
		}
	});

	// `[](url)`: no content means no content edge, so there is no seat to resolve.
	it('declines a pair emptied of content', () => {
		expect(seatIn('a [](http://e.com) b', 3, 'outside')).toBeNull();
	});
});

// An escape and a hard break are never-extend too, but neither declares a content range: the
// backslash pair and the trailing-space run have no bytes the delimiters do not cover, so the
// canonical read already keeps a caret out of them and the seat stands down.
describe('unstamped marker runs declare no content edge', () => {
	it('declines every offset around an escape', () => {
		for (const offset of [2, 3, 4]) expect(seatIn('x \\* y', offset, 'outside')).toBeNull();
	});

	it('declines every offset around a hard break', () => {
		for (const offset of [3, 4, 5]) expect(seatIn('end  \nnext', offset, 'outside')).toBeNull();
	});
});
