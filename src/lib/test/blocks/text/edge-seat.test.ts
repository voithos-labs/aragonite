// @vitest-environment jsdom
// The typing seat's resolution table: construct edge × policy × arrival → the raw offset a
// typed byte belongs at. Pure over the inline tree, so no DOM and no dispatch here — the
// dispatch arm that consumes it is pinned in `edge-policy-construct-seat.test.ts`.
import { describe, expect, it } from 'vitest';
import { relocateComposedRun, resolveEdgeSeat } from '$lib/components/blocks/text/edge-seat';
import { parseInline } from '$lib/core/inline';
import { screenVisibility } from '$lib/core/inline/visibility';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';

/** Every row below is a block holding content, so its chrome hides: the live reading. */
const LIVE = screenVisibility('live', { chromePaints: false });

function seatIn(source: string, offset: number, affinity: EdgeAffinity | null, typed = 'X') {
	return resolveEdgeSeat(
		offset,
		parseInline(source, 0, source.length),
		affinity,
		source,
		LIVE,
		typed
	);
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

	// `[](url)`: it paints nothing at all, so there is no content edge for a seat to resolve.
	it('declines a pair emptied of content', () => {
		expect(seatIn('a [](http://e.com) b', 3, 'far')).toBeNull();
	});
});

// An escape, a hard break and an angle autolink are never-extend with NO content range: every
// byte they hold is a delimiter. A seat that stood down there let the byte land between them —
// the caret gets there legitimately, because the landable floor clears the leading hidden run.
describe('a childless construct is all delimiters', () => {
	// `x \* y`: the escape paints `*`, so its backslash is the leading run and offset 3 is that
	// run's end — never-extend puts the byte outside it.
	it('seats a byte against an escape outside the pair', () => {
		expect(seatIn('x \\* y', 3, 'far')).toEqual({ offset: 2, kind: 'escape' });
		// Already outside it: the seat has nothing to move.
		expect(seatIn('x \\* y', 2, 'far')).toBeNull();
	});

	// `end  \nnext`: the two spaces are the run, the break's `\n` is what paints.
	it('seats a byte against a hard break before its spaces', () => {
		expect(seatIn('end  \nnext', 4, 'far')).toEqual({ offset: 3, kind: 'hardLineBreak' });
	});

	// `\\` paints `\` — a painted string that ALSO occurs at the construct's own start. The
	// anchor must take the last match, or the leading backslash reads as content and the seat
	// sends a byte typed at offset 1 to the pair's end instead of its start.
	it('seats a byte at an escaped backslash on the near side, not past the pair', () => {
		expect(seatIn('\\\\x y', 1, 'far')).toEqual({ offset: 0, kind: 'escape' });
	});

	// `<https://e.com>`: the URL is what paints, so the brackets are the two runs. A byte at
	// either one goes outside the construct — the destination is not text to extend.
	it('seats a byte against an angle autolink outside its brackets', () => {
		expect(seatIn('<https://e.com> x', 1, 'outside')).toEqual({ offset: 0, kind: 'autolink' });
		expect(seatIn('<https://e.com> x', 14, 'outside')).toEqual({ offset: 15, kind: 'autolink' });
	});

	// ...and a byte inside the URL is ordinary editing: the destination IS the text there.
	it('declines inside the painted URL', () => {
		expect(seatIn('<https://e.com> x', 6, 'outside')).toBeNull();
	});

	// An entity paints a glyph that is none of its bytes, so its whole span reads as painted and
	// neither end is a run. The widget arm of the dispatch owns a caret there.
	it('declines at either end of an entity widget', () => {
		expect(seatIn('a&copy;b', 1, 'near')).toBeNull();
		expect(seatIn('a&copy;b', 7, 'far')).toBeNull();
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
		expect(relocateComposedRun(BOLD, composed(11, 'かん'), 11, inlines, 'far', LIVE)).toEqual({
			raw: 'Some **bold**かん text',
			caret: 15
		});
	});

	it('leaves a run the seat agrees with alone', () => {
		expect(relocateComposedRun(BOLD, composed(11, 'かん'), 11, inlines, 'near', LIVE)).toBeNull();
	});

	it('relocates a never-extend edge whatever the arrival', () => {
		const link = 'A [link](http://e.com) tail';
		const tree = parseInline(link, 0, link.length);
		const after = link.slice(0, 7) + '感' + link.slice(7);
		expect(relocateComposedRun(link, after, 7, tree, 'near', LIVE)).toEqual({
			raw: 'A [link](http://e.com)感 tail',
			caret: 23
		});
	});

	// The seat claims one insertion, never a range op: a composition that replaced a selection
	// is a different edit, and rebuilding it from a length delta would corrupt the bytes.
	it('declines anything that is not a plain insertion at the composition point', () => {
		expect(relocateComposedRun(BOLD, BOLD, 11, inlines, 'far', LIVE)).toBeNull();
		expect(relocateComposedRun(BOLD, 'Some **bol**X text', 11, inlines, 'far', LIVE)).toBeNull();
		expect(relocateComposedRun(BOLD, composed(4, 'X'), 11, inlines, 'far', LIVE)).toBeNull();
	});
});

// #116's own draw: a run of three or more asterisks is SHARED between a nested pair, so a byte at
// either end rebinds which delimiters pair with which. The painter is what catches it — the seat
// has no side that keeps the screen, and declining leaves the byte where the caret already was.
describe('a delimiter run shared between two pairings', () => {
	const SHARED = '***foo****foo*';

	it('declines every side at the issue’s own draw', () => {
		for (const affinity of ['near', 'far', 'outside', null] as const) {
			expect(seatIn(SHARED, 6, affinity), `${affinity}`).toBeNull();
		}
	});

	// Non-vacuity, and the point of verifying rather than blanket-declining: the run's OTHER end
	// has a reading that keeps the pairing, and the seat still takes it.
	it('still seats where a reading keeps the pairing', () => {
		expect(seatIn(SHARED, 8, 'near')).toEqual({ offset: 6, kind: 'strong' });
		expect(seatIn(SHARED, 13, 'outside')).toEqual({ offset: 14, kind: 'emphasis' });
	});
});
