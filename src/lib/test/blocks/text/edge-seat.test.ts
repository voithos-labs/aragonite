// @vitest-environment jsdom
// The table that decides where a typed byte goes: construct edge, policy and arrival side give
// the raw offset. Pure over the inline tree, so no DOM and no dispatch here; the dispatch branch
// that uses it is covered in `edge-policy-construct-seat.test.ts`.
import { describe, expect, it } from 'vitest';
import { relocateComposedRun, resolveEdgeSeat } from '$lib/components/blocks/text/edge-seat';
import { parseInline } from '$lib/core/inline';
import { screenVisibility } from '$lib/core/inline/visibility';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';

/** Every case below is a block holding content, so its markers are hidden: the live reading. */
const LIVE = screenVisibility('live', { chromePaints: false });

function seatIn(source: string, offset: number, affinity: EdgeAffinity | null, typed = 'X') {
	return resolveEdgeSeat(
		offset,
		parseInline(source, 0, source.length),
		affinity,
		source,
		LIVE,
		typed,
		fixtureReading()
	);
}

// `Some **bold** text`: strong [5,13), runs [5,7) and [11,13). A point over either run reads as
// the run's near side, so 5 and 11 are the offsets real gestures produce.
describe('a symmetric pair follows the arrival', () => {
	const BOLD = 'Some **bold** text';

	it('leaves the near side alone at either edge: where native insertion already lands', () => {
		expect(seatIn(BOLD, 11, 'near')).toBeNull();
		expect(seatIn(BOLD, 5, 'near')).toBeNull();
	});

	it('moves to the far side when the arrival came from there', () => {
		expect(seatIn(BOLD, 11, 'far')).toEqual({ offset: 13, kind: 'strong' });
		expect(seatIn(BOLD, 5, 'far')).toEqual({ offset: 7, kind: 'strong' });
	});

	// A click resets the arrival side, and the default, as in Google Docs, is the construct the
	// caret touches.
	it('defaults to the near side with no arrival on record: the click default', () => {
		expect(seatIn(BOLD, 11, null)).toBeNull();
		expect(seatIn(BOLD, 5, null)).toBeNull();
	});

	// Relative to the construct, not to a direction: the same value reads as the run's start at
	// an opener and its end at a closer, so the end of a line never lands between delimiters.
	it('puts the caret outside the construct at both edges for a line extreme', () => {
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

	it('puts the caret outside the construct at the trailing edge, whatever the arrival', () => {
		for (const affinity of ['near', 'far', 'outside', null] as const) {
			expect(seatIn(LINK, 7, affinity)).toEqual({ offset: 22, kind: 'link' });
		}
	});

	it('puts the caret outside the construct at the leading edge, which is already the near side', () => {
		for (const affinity of ['near', 'far', 'outside', null] as const) {
			expect(seatIn(LINK, 2, affinity)).toBeNull();
		}
	});

	// `[](url)`: it draws nothing at all, so there is no content edge to resolve.
	it('declines a pair emptied of content', () => {
		expect(seatIn('a [](http://e.com) b', 3, 'far')).toBeNull();
	});
});

// An escape, a hard break and an angle autolink are all delimiters, and the caret does reach them
// past the leading run, so doing nothing would land the byte between delimiters.
describe('a childless construct is all delimiters', () => {
	// `x \* y`: the escape shows `*`, so its backslash is the leading run and offset 3 is that
	// run's end; never-extend puts the byte outside it.
	it('puts the caret at a byte against an escape outside the pair', () => {
		expect(seatIn('x \\* y', 3, 'far')).toEqual({ offset: 2, kind: 'escape' });
		// Already outside it: there is nothing to move.
		expect(seatIn('x \\* y', 2, 'far')).toBeNull();
	});

	// `end  \nnext`: the two spaces are the run, and the break's `\n` is what shows.
	it('puts the caret at a byte against a hard break before its spaces', () => {
		expect(seatIn('end  \nnext', 4, 'far')).toEqual({ offset: 3, kind: 'hardLineBreak' });
	});

	// `\\` shows `\`, which also matches at the construct's own start, so the match must be the
	// last one, or a byte typed at offset 1 goes to the pair's end instead of its start.
	it('puts the caret at a byte at an escaped backslash on the near side, not past the pair', () => {
		expect(seatIn('\\\\x y', 1, 'far')).toEqual({ offset: 0, kind: 'escape' });
	});

	// `<https://e.com>`: the URL is what shows, so the brackets are the two runs. A byte at
	// either one goes outside the construct, since the destination is not text to extend.
	it('puts the caret at a byte against an angle autolink outside its brackets', () => {
		expect(seatIn('<https://e.com> x', 1, 'outside')).toEqual({ offset: 0, kind: 'autolink' });
		expect(seatIn('<https://e.com> x', 14, 'outside')).toEqual({ offset: 15, kind: 'autolink' });
	});

	// ...and a byte inside the URL is ordinary editing: the destination is the text there.
	it('declines inside the painted URL', () => {
		expect(seatIn('<https://e.com> x', 6, 'outside')).toBeNull();
	});

	// An entity shows a character that is none of its bytes, so its whole span reads as visible
	// and neither end is a run. The dispatch's widget branch owns a caret there.
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
		expect(
			relocateComposedRun(BOLD, composed(11, 'かん'), 11, inlines, 'far', LIVE, fixtureReading())
		).toEqual({
			raw: 'Some **bold**かん text',
			caret: 15
		});
	});

	it('leaves a run the caret position agrees with alone', () => {
		expect(
			relocateComposedRun(BOLD, composed(11, 'かん'), 11, inlines, 'near', LIVE, fixtureReading())
		).toBeNull();
	});

	it('relocates a never-extend edge whatever the arrival', () => {
		const link = 'A [link](http://e.com) tail';
		const tree = parseInline(link, 0, link.length);
		const after = link.slice(0, 7) + '感' + link.slice(7);
		expect(relocateComposedRun(link, after, 7, tree, 'near', LIVE, fixtureReading())).toEqual({
			raw: 'A [link](http://e.com)感 tail',
			caret: 23
		});
	});

	// This handles one insertion, never a range edit: a composition that replaced a selection is
	// a different edit, and rebuilding it from a length difference would corrupt the bytes.
	it('declines anything that is not a plain insertion at the composition point', () => {
		expect(relocateComposedRun(BOLD, BOLD, 11, inlines, 'far', LIVE, fixtureReading())).toBeNull();
		expect(
			relocateComposedRun(BOLD, 'Some **bol**X text', 11, inlines, 'far', LIVE, fixtureReading())
		).toBeNull();
		expect(
			relocateComposedRun(BOLD, composed(4, 'X'), 11, inlines, 'far', LIVE, fixtureReading())
		).toBeNull();
	});
});

// A run of three or more asterisks is shared by a nested pair, so a byte at its end can re-pair it.
// Miss-analysis: GH #116, the property suite's input regex excluded this class of run.
describe('a delimiter run shared between two pairings', () => {
	const SHARED = '***foo****foo*';

	it('declines every side at the issue’s own draw', () => {
		for (const affinity of ['near', 'far', 'outside', null] as const) {
			expect(seatIn(SHARED, 6, affinity), `${affinity}`).toBeNull();
		}
	});

	// Checking beats refusing outright: the run's other end keeps the pairing, and is still taken.
	it('still puts the caret where a reading keeps the pairing', () => {
		expect(seatIn(SHARED, 8, 'near')).toEqual({ offset: 6, kind: 'strong' });
		expect(seatIn(SHARED, 13, 'outside')).toEqual({ offset: 14, kind: 'emphasis' });
	});
});

// Miss-analysis: GH #228, no run in this table enclosed a bare autolink.
describe('a run enclosing a bare autolink', () => {
	// GFM's bare-autolink scanner takes a trailing `*` into the URL, so a byte outside the closer
	// strands the opener. Inside it the URL absorbs the byte and both delimiters stay hidden.
	it('puts the caret inside the closing delimiter, whatever the arrival', () => {
		for (const affinity of ['near', 'far', 'outside', null] as const) {
			expect(seatIn('*www.example.com*', 17, affinity), `${affinity}`).toEqual({
				offset: 16,
				kind: 'emphasis'
			});
		}
	});
});

// Miss-analysis: GH #229, escape fixtures stood beside plain text, never another construct's run.
describe('abutting marker runs are one screen position', () => {
	// `_foo_\*x`: the emphasis closer [4,5) and the escape's backslash [5,6) abut, so 4, 5 and 6
	// are one screen position. 5 kills the underscore pair, 6 kills the escape, 4 keeps both.
	it('reaches a neighbour’s run when the construct’s own outside edge is poisoned', () => {
		for (const affinity of ['near', 'far', 'outside', null] as const) {
			expect(seatIn('_foo_\\*x', 6, affinity), `${affinity}`).toEqual({
				offset: 4,
				kind: 'escape'
			});
		}
	});
});

// Miss-analysis: the caret's own offset always passed first, so no case reached the second one.
describe('a never-extend construct admits no interior caret position', () => {
	// `_foo_` spoils the byte before each construct (an intraword `_` cannot close), the only way
	// past the first candidate. Offset 4 is inside the emphasis, outside the never-extend kind.
	it.each([['_foo_[link](url)'], ['_foo_<https://e.com>'], ['_foo_![alt](u)']])(
		'seats outside the construct in %s, never between its delimiters',
		(source) => {
			for (const affinity of ['near', 'far', 'outside', null] as const) {
				expect(seatIn(source, 5, affinity), `${affinity}`).toEqual(
					expect.objectContaining({ offset: 4 })
				);
			}
		}
	);
});
