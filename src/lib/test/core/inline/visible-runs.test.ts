// @vitest-environment jsdom
// The run list's SPANS, which the concatenated text cannot check: `renderedText` is the same
// string whatever offsets the runs claim, and `edge-seat` is the one reader that acts on them.
// Miss-analysis: the painted span used to be recovered by searching the construct's raw for its
// painted text, so a self-similar shape matched at the wrong place; the search's only caller had
// no test naming an offset, and the property net over the seat excludes that shape by interval.
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { CONTENT_VISIBILITY, visibleRuns } from '$lib/core/inline/visibility';
import type { InlineNode } from '$lib/core/nodes';

const painted = (nodes: readonly InlineNode[], raw: string) =>
	visibleRuns(nodes, raw, CONTENT_VISIBILITY)
		.filter((run) => run.visible && run.text !== '')
		.map((run) => [run.start, run.end, run.text]);

describe('a run carries the raw bytes it stands for', () => {
	it('locates an alt text that repeats inside its own destination', () => {
		// `![a](a)`: the alt is at 2, and a search for the painted `a` would find the URL's at 5.
		expect(painted(parseInline('![a](a)', 0, 7), '![a](a)')).toEqual([[2, 3, 'a']]);
	});

	it('reads an escape and an angle autolink down to their one painted byte', () => {
		expect(painted(parseInline('\\*', 0, 2), '\\*')).toEqual([[1, 2, '*']]);
		const url = '<http://e.com>';
		expect(painted(parseInline(url, 0, url.length), url)).toEqual([[1, 13, 'http://e.com']]);
	});

	// A widget substitutes its own glyph for its bytes, so its span comes off the shell rather than
	// off a running character count that the substitution would desynchronize.
	it('gives a widget its source range, not its glyph length', () => {
		expect(painted(parseInline('a&copy;b', 0, 8), 'a&copy;b')).toEqual([
			[0, 1, 'a'],
			[1, 7, '©'],
			[7, 8, 'b']
		]);
	});

	// The join seam hands over the surviving side of a cut, whose nodes skip the bytes that went.
	it('keeps a clipped list anchored on each node rather than on a running count', () => {
		const raw = 'ab **cd** ef';
		const clipped: InlineNode[] = [
			{ kind: 'text', start: 0, end: 2 },
			{ kind: 'text', start: 10, end: 12 }
		];
		expect(painted(clipped, raw)).toEqual([
			[0, 2, 'ab'],
			[10, 12, 'ef']
		]);
	});
});
