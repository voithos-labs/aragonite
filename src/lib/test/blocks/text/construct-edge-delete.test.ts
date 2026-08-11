// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import {
	resolveEdgeDeletion,
	type DeleteDirection
} from '$lib/components/blocks/text/construct-edge-delete';

// The bytes a destructive key at a hidden delimiter run turns into. Live paints no marker, so the
// source is the oracle and every result is re-parsed: a press must never leave a delimiter on
// screen, and a pair the cut empties must never survive as invisible `****`.

function del(
	display: string,
	caret: number,
	direction: DeleteDirection = 'backward',
	content = { start: 0, end: display.length }
) {
	return resolveEdgeDeletion({
		display,
		content,
		caret,
		direction,
		inlines: parseInline(display, content.start, content.end)
	});
}

// `Some **bold** text`: strong [5,13), `bold` [7,11).
describe('a press past a hidden run takes the content character, never a delimiter', () => {
	const BOLD = 'Some **bold** text';

	it('deletes the last content byte from the far side of the trailing run', () => {
		expect(del(BOLD, 13)).toEqual({ raw: 'Some **bol** text', caret: 10 });
	});

	it('deletes the first content byte from the near side of the leading run', () => {
		expect(del(BOLD, 5, 'forward')).toEqual({ raw: 'Some **old** text', caret: 5 });
	});

	// Measured: Chromium takes the adjacent non-rendered span along with the character, so a press
	// at the content edge is the arm's even though the character it deletes is the obvious one.
	it('claims the content edge, where native takes the hidden run with the byte', () => {
		expect(del(BOLD, 11)).toEqual({ raw: 'Some **bol** text', caret: 10 });
		expect(del(BOLD, 7, 'forward')).toEqual({ raw: 'Some **old** text', caret: 7 });
	});

	// Away from every run the engine is right and owns the press, grapheme and IME behavior
	// included.
	it('declines where no hidden run touches the cut', () => {
		expect(del(BOLD, 9)).toBeNull();
		expect(del(BOLD, 9, 'forward')).toBeNull();
		expect(del('abc', 2)).toBeNull();
		expect(del('abc', 1, 'forward')).toBeNull();
	});

	// The engine takes the run adjacent to the BYTE it deletes, not to the caret it started from,
	// so the last content character at either end is destructive one press before the edge. Six
	// measured shapes: a pair, a code span and a link, from both sides.
	it.each([
		['strong, first content byte', 'Some **bold** text', 8, 'backward', 'Some **old** text', 7],
		['strong, last content byte', 'Some **bold** text', 10, 'forward', 'Some **bol** text', 10],
		['code, first content byte', 'a `xy` b', 4, 'backward', 'a `y` b', 3],
		['code, last content byte', 'a `xy` b', 4, 'forward', 'a `x` b', 4],
		['link, first content byte', 'zz [text](u) yy', 5, 'backward', 'zz [ext](u) yy', 4],
		['link, last content byte', 'zz [text](u) yy', 7, 'forward', 'zz [tex](u) yy', 7]
	])('claims %s', (_case, display, caret, direction, raw, after) => {
		expect(del(display, caret, direction as DeleteDirection)).toEqual({ raw, caret: after });
	});

	// A press it does claim beside a run still cuts whole characters: half a surrogate pair is
	// not one, and the engine is not the thing deciding.
	it('takes an astral character whole', () => {
		expect(del('**b**👍', 5, 'forward')).toEqual({ raw: '**b**', caret: 5 });
	});

	// Nothing content-side of the caret: the press belongs to the block-merge cascade.
	it('declines with only delimiters between the caret and the block edge', () => {
		expect(del('**bold**', 2)).toBeNull();
		expect(del('**bold**', 6, 'forward')).toBeNull();
	});

	// The structural bytes of the block are not content, so no press may reach them.
	it('declines past the content range', () => {
		expect(del('## **b** x', 3, 'backward', { start: 3, end: 10 })).toBeNull();
	});
});

describe('emptying a construct drops its delimiters in the same cut', () => {
	it.each([
		['strong', '**b** tail', 3],
		['emphasis', '*b* tail', 2],
		['strikethrough', '~~b~~ tail', 3],
		['inlineCode', '`b` tail', 2],
		['link', '[b](u) tail', 2]
	])('%s unwraps to its surroundings when its last content byte goes', (_kind, display, caret) => {
		expect(del(display, caret)).toEqual({ raw: ' tail', caret: 0 });
	});

	// `***x***`: emphasis [0,7) around strong [1,6) around `x` [3,4). Emptying the inner pair
	// empties the outer one, so the cut grows outward until nothing is left enclosing nothing.
	it('unwraps every construct the cut empties, innermost outward', () => {
		expect(del('***x***', 4)).toEqual({ raw: '', caret: 0 });
	});

	it('unwraps the same way forward', () => {
		expect(del('**b** tail', 2, 'forward')).toEqual({ raw: ' tail', caret: 0 });
	});

	// An image is not a pair around content: an empty alt is still an image, so the cut takes the
	// character and stops — the marker skip still applies. A pure-function guard on the policy
	// row, not a reachable gesture: live renders an image as a widget, and the dispatch's widget
	// arm claims a caret at this offset long before this one is consulted.
	it('leaves a construct that stays itself when emptied', () => {
		expect(del('![a](u)', 7)).toEqual({ raw: '![](u)', caret: 2 });
	});
});

// `escape` and `hardLineBreak` are hidden runs with no construct stamp: what the reader sees is
// one character, and the bytes that produce it have no independent meaning.
describe('an atomic hidden run deletes as one unit', () => {
	it('takes both bytes of an escape from either side', () => {
		expect(del('a \\* b', 4)).toEqual({ raw: 'a  b', caret: 2 });
		expect(del('a \\* b', 2, 'forward')).toEqual({ raw: 'a  b', caret: 2 });
	});

	it('takes a backslash hard break with its line ending', () => {
		expect(del('a\\\nb', 3)).toEqual({ raw: 'ab', caret: 1 });
	});

	it('takes a trailing-space hard break as one unit', () => {
		expect(del('a  \nb', 4)).toEqual({ raw: 'ab', caret: 1 });
	});
});

// The T7 shape, in reverse: a candidate that READS right can PARSE wrong. `**a *b***` emptied of
// `b` is `**a **`, whose closing run follows a space and so is not right-flanking — CommonMark
// renders the stars literally. Markdown cannot express bold with a trailing space, so there is no
// sound rewrite — and handing the press back to the engine is not neutral: measured, native turns
// `**a *b*** z` into `**a  z`, destroying both constructs and painting the stars. The press is
// this arm's, and taking nothing is the only answer that keeps the markers off screen.
describe('a rewrite the parser would not read back takes nothing', () => {
	it('swallows where dropping the pair would surface its delimiters', () => {
		expect(del('**a *b*** z', 6)).toEqual({ swallow: true });
	});

	// Deleting the space between two bold words leaves `**a****b**`, which renders `a****b` — but
	// the press has a second reading the reader would call obvious: the two constructs become one.
	// Widening the cut through the runs it now sits between is that reading, and it parses back.
	it('widens the cut through the flanking runs where that reads back', () => {
		expect(del('**a** **b**', 3, 'forward')).toEqual({ raw: '**ab**', caret: 3 });
	});

	// The same widening on a shape with no sound reading at all still ends in a swallow: `*b* c**`
	// surfaces the stars just as `** *b* c**` does.
	it('swallows when neither the cut nor the widened cut reads back', () => {
		expect(del('**a *b* c**', 3)).toEqual({ swallow: true });
	});

	// A swallow is a claim, so it must not spread past the presses this arm owns: with no run
	// beside the cut the engine is right and the press is not ours to take.
	it('still declines a press it does not own', () => {
		expect(del('**a *b*** z', 11)).toBeNull();
	});
});

// The join case is sound today only because THIS parser reads `**a****b**` as one strong. A
// CommonMark-conformant reading there would make the PLAIN cut verify, and the arm would write a
// four-star run into the source that nothing on screen explains. The candidate order happens to
// protect that; this is the rule itself, so the day the ordering stops protecting it, it fails.
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
