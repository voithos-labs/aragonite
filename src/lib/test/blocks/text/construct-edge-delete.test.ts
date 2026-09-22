// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import {
	resolveEdgeDeletion,
	type DeleteDirection
} from '$lib/components/blocks/text/construct-edge-delete';
import { screenVisibility } from '$lib/core/inline/visibility';

// The bytes a destructive key at a hidden delimiter run produces. Live mode draws no marker, so
// the source decides and every result is reparsed: a keypress must never leave a delimiter on
// screen, and a pair the cut empties must never survive as invisible `****`.

function del(
	display: string,
	caret: number,
	direction: DeleteDirection = 'backward',
	chromePaints = false,
	content = { start: 0, end: display.length }
) {
	return resolveEdgeDeletion({
		display,
		content,
		caret,
		direction,
		screen: screenVisibility('live', { chromePaints }),
		inlines: parseInline(display, content.start, content.end),
		installedAs: 'block'
	});
}

/** The same keypress in a table cell, whose text the caller stores as cell bytes. */
function delInCell(display: string, caret: number, direction: DeleteDirection = 'backward') {
	return resolveEdgeDeletion({
		display,
		content: { start: 0, end: display.length },
		caret,
		direction,
		screen: screenVisibility('live', { chromePaints: false }),
		inlines: parseInline(display, 0, display.length),
		installedAs: 'cell'
	});
}

// `Some **bold** text`: strong [5,13), `bold` [7,11).
describe('a press past a hidden run takes the content character, never a delimiter', () => {
	const BOLD = 'Some **bold** text';

	it('deletes the last content byte from the far side of the trailing run', () => {
		expect(del(BOLD, 13)).toEqual({ raw: 'Some **bol** text', caret: 10, unwrappedMarks: [] });
	});

	it('deletes the first content byte from the near side of the leading run', () => {
		expect(del(BOLD, 5, 'forward')).toEqual({
			raw: 'Some **old** text',
			caret: 5,
			unwrappedMarks: []
		});
	});

	// Measured: Chromium takes the neighbouring hidden span along with the character, so a key at
	// the content edge belongs here even though the character it deletes is the obvious one.
	it('claims the content edge, where native takes the hidden run with the byte', () => {
		expect(del(BOLD, 11)).toEqual({ raw: 'Some **bol** text', caret: 10, unwrappedMarks: [] });
		expect(del(BOLD, 7, 'forward')).toEqual({
			raw: 'Some **old** text',
			caret: 7,
			unwrappedMarks: []
		});
	});

	// Away from every run the browser is right and keeps the key, grapheme and IME behavior
	// included.
	it('declines where no hidden run touches the cut', () => {
		expect(del(BOLD, 9)).toBeNull();
		expect(del(BOLD, 9, 'forward')).toBeNull();
		expect(del('abc', 2)).toBeNull();
		expect(del('abc', 1, 'forward')).toBeNull();
	});

	// The browser takes the run beside the byte it deletes, not the one beside the caret it
	// started from, so the last content character at either end is destructive one key before the
	// edge. Six measured shapes: a pair, a code span and a link, from both sides.
	it.each([
		['strong, first content byte', 'Some **bold** text', 8, 'backward', 'Some **old** text', 7],
		['strong, last content byte', 'Some **bold** text', 10, 'forward', 'Some **bol** text', 10],
		['code, first content byte', 'a `xy` b', 4, 'backward', 'a `y` b', 3],
		['code, last content byte', 'a `xy` b', 4, 'forward', 'a `x` b', 4],
		['link, first content byte', 'zz [text](u) yy', 5, 'backward', 'zz [ext](u) yy', 4],
		['link, last content byte', 'zz [text](u) yy', 7, 'forward', 'zz [tex](u) yy', 7]
	])('claims %s', (_case, display, caret, direction, raw, after) => {
		expect(del(display, caret, direction as DeleteDirection)).toEqual({
			raw,
			caret: after,
			unwrappedMarks: []
		});
	});

	// A key it does take beside a run still cuts whole characters: half a surrogate pair is
	// not one, and the browser is not the one deciding.
	it('takes an astral character whole', () => {
		expect(del('**b**👍', 5, 'forward')).toEqual({ raw: '**b**', caret: 5, unwrappedMarks: [] });
	});

	// Nothing on the content side of the caret: the key belongs to the block merge.
	it('declines with only delimiters between the caret and the block edge', () => {
		expect(del('**bold**', 2)).toBeNull();
		expect(del('**bold**', 6, 'forward')).toBeNull();
	});

	// The block's structural bytes are not content, so no key may reach them.
	it('declines past the content range', () => {
		expect(del('## **b** x', 3, 'backward', false, { start: 3, end: 10 })).toBeNull();
	});
});

// A block whose markers stand over nothing shows them (live-mode.md § 4.1), so there is no hidden
// run here and every byte the key could take is one the user saw.
// Miss-analysis: every case ran against blocks holding content, where the delimiters really are
// hidden, so the branch reading a construct as one unseen unit was never asked if it was visible.
describe('painted chrome leaves the press to the browser', () => {
	it('declines at both ends of a link with no text', () => {
		expect(del('[](u)', 5, 'backward', true)).toBeNull();
		expect(del('[](u)', 0, 'forward', true)).toBeNull();
	});

	// The block's own prefix is drawn beside the construct's, so the block is content-empty while
	// nothing about the inline nodes says so: that fact is the block's and can only be passed in.
	it('declines where a block prefix paints beside the construct', () => {
		expect(del('# [](u)', 7, 'backward', true, { start: 2, end: 7 })).toBeNull();
	});

	// The same keys while the markers are hidden still belong here: that one fact separates them.
	it('still claims them where the block holds content behind its chrome', () => {
		expect(del('[](u)', 5)).toEqual({ raw: '', caret: 0, unwrappedMarks: [] });
		expect(del('[](u)', 0, 'forward')).toEqual({ raw: '', caret: 0, unwrappedMarks: [] });
	});
});

describe('emptying a construct drops its delimiters in the same cut', () => {
	// A link unwraps like the rest but no chord writes one, so it reports no mark to hand back.
	it.each([
		['strong', '**b** tail', 3, ['strong']],
		['emphasis', '*b* tail', 2, ['emphasis']],
		['strikethrough', '~~b~~ tail', 3, ['strikethrough']],
		['inlineCode', '`b` tail', 2, ['inlineCode']],
		['link', '[b](u) tail', 2, []]
	])(
		'%s unwraps to its surroundings when its last content byte goes',
		(_kind, display, caret, marks) => {
			expect(del(display as string, caret as number)).toEqual({
				raw: ' tail',
				caret: 0,
				unwrappedMarks: marks
			});
		}
	);

	// `***x***`: emphasis [0,7) around strong [1,6) around `x` [3,4). Emptying the inner pair
	// empties the outer one, so the cut grows outward until nothing is left enclosing nothing.
	it('unwraps every construct the cut empties, innermost outward', () => {
		expect(del('***x***', 4)).toEqual({
			raw: '',
			caret: 0,
			unwrappedMarks: ['strong', 'emphasis']
		});
	});

	it('unwraps the same way forward', () => {
		expect(del('**b** tail', 2, 'forward')).toEqual({
			raw: ' tail',
			caret: 0,
			unwrappedMarks: ['strong']
		});
	});

	// An image is not a pair around content: an empty alt is still an image, so the cut takes the
	// character and stops, though the marker skip still applies. This checks the policy entry,
	// not a gesture a user can make: live mode renders an image as a widget, and the widget
	// branch takes a caret at this offset first.
	it('leaves a construct that stays itself when emptied', () => {
		expect(del('![a](u)', 7)).toEqual({ raw: '![](u)', caret: 2, unwrappedMarks: [] });
	});
});

// `escape` and `hardLineBreak` are hidden runs with no content of their own: the user sees one
// character, and the bytes that produce it have no separate meaning.
describe('an atomic hidden run deletes as one unit', () => {
	it('takes both bytes of an escape from either side', () => {
		expect(del('a \\* b', 4)).toEqual({ raw: 'a  b', caret: 2, unwrappedMarks: [] });
		expect(del('a \\* b', 2, 'forward')).toEqual({ raw: 'a  b', caret: 2, unwrappedMarks: [] });
	});

	it('takes a backslash hard break with its line ending', () => {
		expect(del('a\\\nb', 3)).toEqual({ raw: 'ab', caret: 1, unwrappedMarks: [] });
	});

	it('takes a trailing-space hard break as one unit', () => {
		expect(del('a  \nb', 4)).toEqual({ raw: 'ab', caret: 1, unwrappedMarks: [] });
	});
});

// A candidate that reads right can parse wrong. `**a *b***` emptied of `b` is `**a **`, whose
// closing run follows a space and so is not right-flanking, and CommonMark renders the stars
// literally. Markdown cannot express bold with a trailing space, so there is no safe rewrite, and
// handing the key back to the browser is not neutral: measured, it turns `**a *b*** z` into
// `**a  z`, destroying both constructs and showing the stars. The key belongs here, and taking
// nothing is the only answer that keeps the markers off screen.
describe('a rewrite the parser would not read back takes nothing', () => {
	it('swallows where dropping the pair would surface its delimiters', () => {
		expect(del('**a *b*** z', 6)).toEqual({ swallow: true });
	});

	// Deleting the space between two bold words leaves `**a****b**`, which renders `a****b`, but
	// the key has a second reading a user would call obvious: the two constructs become one.
	// Widening the cut through the runs it now sits between is that reading, and it parses back.
	it('widens the cut through the flanking runs where that reads back', () => {
		expect(del('**a** **b**', 3, 'forward')).toEqual({
			raw: '**ab**',
			caret: 3,
			unwrappedMarks: []
		});
	});

	// The same widening on a shape with no safe reading at all still writes nothing: `*b* c**`
	// shows the stars just as `** *b* c**` does.
	it('swallows when neither the cut nor the widened cut reads back', () => {
		expect(del('**a *b* c**', 3)).toEqual({ swallow: true });
	});

	// Writing nothing still consumes the key, so it must not spread past the keys handled here:
	// with no run beside the cut the browser is right and the key is not ours to take.
	it('still declines a press it does not own', () => {
		expect(del('**a *b*** z', 11)).toBeNull();
	});
});

// The join case works today only because this parser reads `**a****b**` as one strong span. A
// strictly CommonMark reading would let the plain cut pass, writing a four-star run into the
// source that nothing on screen explains. The candidate order happens to prevent that; this test
// states the rule itself, so it fails the day that ordering stops.
describe('no accepted rewrite grows a delimiter run', () => {
	const CORPUS = [
		'Some **bold** text',
		'**b** tail',
		'a \\* b',
		'first line\\\nsecond line',
		'**a *b* c**',
		'**a** **b**',
		'*a* *b*',
		'~~a~~ ~~b~~',
		'`a` `b`',
		'a `xy` b',
		'zz [text](u) yy',
		'***x*** y',
		'x *a* *b* y',
		'a **b** `c` [d](e) f'
	];

	const longestRun = (raw: string, char: string): number =>
		Math.max(0, ...[...raw.matchAll(new RegExp(`\\${char}+`, 'g'))].map((m) => m[0].length));

	it('over every claimed press in the corpus', () => {
		const grown: string[] = [];
		for (const display of CORPUS) {
			for (let caret = 0; caret <= display.length; caret++) {
				for (const direction of ['backward', 'forward'] as const) {
					const answer = del(display, caret, direction);
					if (!answer || 'swallow' in answer) continue;
					for (const char of ['*', '~', '`']) {
						if (longestRun(answer.raw, char) > longestRun(display, char)) {
							grown.push(`${display} @${caret} ${direction} → ${answer.raw}`);
						}
					}
				}
			}
		}
		expect(grown).toEqual([]);
	});
});

// Which constructs are taken whole is a fact about the node, not about the kind: `[](u)` is a
// link, a kind whose delimiters normally enclose content, with no content range at all, while
// `![a](u)` is an atomic widget that has one. A per-kind column would answer a different question
// and swap these two answers.
// Miss-analysis: no case separated the per-node test from a per-kind one, so a declared
// `contentModel` entry read as a safe substitute for it.
describe('the whole-construct branch reads the node, not the kind', () => {
	it('takes a content-empty link whole, though its kind normally encloses content', () => {
		expect(del('A [](u) B', 7)).toEqual({ raw: 'A  B', caret: 2, unwrappedMarks: [] });
	});

	// This module's own rule, not a gesture a user can make: live mode draws the image as an
	// atomic widget the widget branch takes first. A per-kind `atomic` would delete the picture.
	it('takes one alt character out of an image, whose alt is content', () => {
		expect(del('A ![a](u) B', 9)).toEqual({ raw: 'A ![](u) B', caret: 4, unwrappedMarks: [] });
	});
});

// A candidate is bytes the caller is about to store as one prose block, so it is checked by
// reading it back as a block. The two sibling live rewrites (`live-split-rebalance`,
// `live-join-seam`) read theirs back the same way.
// Miss-analysis: every case here read the result back as inline text, so none could see a
// candidate whose bytes reparse as a different block, which is what an abutted run makes.
describe('a candidate that re-reads as another block is not written', () => {
	// `~~[](u)~~a`: the `~~` runs are literal text, so taking the childless link whole pushes them
	// together into `~~~~a`, a tilde fence, which then swallows every block below it.
	it('refuses a cut that abuts two runs into a fence opener', () => {
		expect(del('~~[](u)~~a', 2, 'forward')).toEqual({ swallow: true });
	});

	it('still takes the same construct where the abutted bytes stay one paragraph', () => {
		expect(del('~~[](u)~~ x', 2, 'forward')).toEqual({
			raw: ' x',
			caret: 0,
			unwrappedMarks: ['strikethrough']
		});
	});

	// How a candidate is read back follows how it will be stored: a cell's text is stored as cell
	// bytes, and reading it back as a block would refuse every cell that happens to start like a
	// container marker, leaving the key to the browser, which shows what § 4.4 keeps off screen.
	it.each(['- **a** b', '> **a** b', '1. **a** b', '    **a** b'])(
		'rewrites in a cell whose text opens like %j',
		(cell) => {
			expect(delInCell(cell, cell.length - 2)).not.toBeNull();
			expect(delInCell(cell, cell.length - 2)).not.toEqual({ swallow: true });
		}
	);

	it('a block surface still refuses those bytes, since a block is what it installs', () => {
		expect(del('- **a** b', 7)).toBeNull();
	});
});
