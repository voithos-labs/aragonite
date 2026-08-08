// The typing seat's resolution table: construct edge × policy × arrival → the raw offset a
// typed byte belongs at. Pure over the inline tree, so no DOM and no dispatch here — the
// dispatch arm that consumes it is pinned in `edge-policy-construct-seat.test.ts`.
import { describe, expect, it } from 'vitest';
import { relocateComposedRun, resolveEdgeSeat } from '$lib/components/blocks/text/edge-seat';
import { parseInline } from '$lib/core/inline';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';

function seatIn(source: string, offset: number, affinity: EdgeAffinity | null) {
	return resolveEdgeSeat(offset, parseInline(source, 0, source.length), affinity);
}

// `Some **bold** text`: strong [5,13), `bold` [7,11). The leading run is [5,7), the trailing
// run [11,13). A read at either run's pixel canonicalizes to the run's NEAR side, so 5 and 11
// are the offsets a real gesture produces — every row below starts from one of them.
describe('a symmetric pair follows the arrival', () => {
	const BOLD = 'Some **bold** text';

	it('leaves the near side alone at either edge — where native insertion already lands', () => {
		expect(seatIn(BOLD, 11, 'near')).toBeNull();
		expect(seatIn(BOLD, 5, 'near')).toBeNull();
	});

	it('moves to the far side when the arrival came from there', () => {
		expect(seatIn(BOLD, 11, 'far')).toEqual({ offset: 13, kind: 'strong' });
		expect(seatIn(BOLD, 5, 'far')).toEqual({ offset: 7, kind: 'strong' });
	});

	// A click resets the affinity, and the gdocs default is the construct the caret touches.
	it('defaults to the near side with no arrival on record — the click default', () => {
		expect(seatIn(BOLD, 11, null)).toBeNull();
		expect(seatIn(BOLD, 5, null)).toBeNull();
	});

	// Construct-relative, not directional: the same value reads as the run's start at an opener
	// and its end at a closer, so a line extreme never lands between delimiter bytes.
	it('seats outside the construct at both edges for a line extreme', () => {
		expect(seatIn(BOLD, 11, 'outside')).toEqual({ offset: 13, kind: 'strong' });
		expect(seatIn(BOLD, 5, 'outside')).toBeNull();
		expect(seatIn('**Lead** in', 2, 'outside')).toEqual({ offset: 0, kind: 'strong' });
	});

	it('declines an offset no marker run touches', () => {
		for (const offset of [0, 4, 9, 15]) expect(seatIn(BOLD, offset, 'far')).toBeNull();
	});

	// A code span carries its content as text, not children; its fences still bound it.
	it('bounds a code span by its backtick runs', () => {
		expect(seatIn('a `code` b', 7, 'far')).toEqual({ offset: 8, kind: 'inlineCode' });
		expect(seatIn('a `code` b', 7, 'near')).toBeNull();
	});

	// The innermost pair owns its own edge, or a nested emphasis would never extend.
	it('the innermost construct claims a shared edge', () => {
		expect(seatIn('**a *b* c**', 6, 'far')).toEqual({ offset: 7, kind: 'emphasis' });
	});
});

describe('a never-extend construct ignores the arrival', () => {
	const LINK = 'A [link](http://e.com) tail';

	it('seats outside the construct at the trailing edge, whatever the arrival', () => {
		for (const affinity of ['near', 'far', 'outside', null] as const) {
			expect(seatIn(LINK, 7, affinity)).toEqual({ offset: 22, kind: 'link' });
		}
	});

	it('seats outside the construct at the leading edge, which is already the near side', () => {
		for (const affinity of ['near', 'far', 'outside', null] as const) {
			expect(seatIn(LINK, 2, affinity)).toBeNull();
		}
	});

	// `[](url)`: no content means no content edge, so there is no seat to resolve.
	it('declines a pair emptied of content', () => {
		expect(seatIn('a [](http://e.com) b', 3, 'far')).toBeNull();
	});
});

// An escape and a hard break are never-extend too, but neither declares a content range: the
// backslash pair and the trailing-space run have no bytes the delimiters do not cover, so the
// canonical read already keeps a caret out of them and the seat stands down.
describe('unstamped marker runs declare no content edge', () => {
	it('declines every offset around an escape', () => {
		for (const offset of [2, 3, 4]) expect(seatIn('x \\* y', offset, 'far')).toBeNull();
	});

	it('declines every offset around a hard break', () => {
		for (const offset of [3, 4, 5]) expect(seatIn('end  \nnext', offset, 'far')).toBeNull();
	});
});

// The IME half: `insertCompositionText` is not cancelable, so the composed run is relocated on
// the commit that lands it rather than intercepted at the keystroke.
describe('relocateComposedRun', () => {
	const BOLD = 'Some **bold** text';
	const inlines = parseInline(BOLD, 0, BOLD.length);

	function composed(at: number, text: string): string {
		return BOLD.slice(0, at) + text + BOLD.slice(at);
	}

	it('moves a run composed at the trailing content edge past the closing delimiter', () => {
		expect(relocateComposedRun(BOLD, composed(11, 'かん'), 11, inlines, 'far')).toEqual({
			raw: 'Some **bold**かん text',
			caret: 15
		});
	});

	it('leaves a run the seat agrees with alone', () => {
		expect(relocateComposedRun(BOLD, composed(11, 'かん'), 11, inlines, 'near')).toBeNull();
	});

	it('relocates a never-extend edge whatever the arrival', () => {
		const link = 'A [link](http://e.com) tail';
		const tree = parseInline(link, 0, link.length);
		const after = link.slice(0, 7) + '感' + link.slice(7);
		expect(relocateComposedRun(link, after, 7, tree, 'near')).toEqual({
			raw: 'A [link](http://e.com)感 tail',
			caret: 23
		});
	});

	// The seat claims one insertion, never a range op: a composition that replaced a selection
	// is a different edit, and rebuilding it from a length delta would corrupt the bytes.
	it('declines anything that is not a plain insertion at the composition point', () => {
		expect(relocateComposedRun(BOLD, BOLD, 11, inlines, 'far')).toBeNull();
		expect(relocateComposedRun(BOLD, 'Some **bol**X text', 11, inlines, 'far')).toBeNull();
		expect(relocateComposedRun(BOLD, composed(4, 'X'), 11, inlines, 'far')).toBeNull();
	});
});
