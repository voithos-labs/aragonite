// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { displayLength } from '$lib/core/lines';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';

// The bytes a live-mode join writes. Every case states the byte-literal concatenation the cleanup
// is offered — that is what a decline leaves behind — so a null return is as pinned as a rewrite.

const blockOf = (source: string) => parse(source, { scope: 'fragment' }).children[0];

/** The Backspace shape: two whole blocks, cut at the first one's content end and the second's 0. */
function merge(first: string, second: string): string | null {
	const start = blockOf(first);
	const end = blockOf(second);
	const seam = displayLength(start.raw);
	return (
		cleanLiveJoinSeam({
			mergedRaw: start.raw.slice(0, seam) + end.raw,
			seam,
			start: { node: start, offset: seam },
			end: { node: end, offset: 0 },
			linkRef: undefined
		})?.raw ?? null
	);
}

/** The range-delete shape: two endpoints cut mid-block, the bytes between them gone. */
function deleteBetween(
	first: string,
	startOffset: number,
	second: string,
	endOffset: number
): string | null {
	const start = blockOf(first);
	const end = blockOf(second);
	return (
		cleanLiveJoinSeam({
			mergedRaw: start.raw.slice(0, startOffset) + end.raw.slice(endOffset),
			seam: startOffset,
			start: { node: start, offset: startOffset },
			end: { node: end, offset: endOffset },
			linkRef: undefined
		})?.raw ?? null
	);
}

const sameBlock = (source: string, from: number, to: number) =>
	deleteBetween(source, from, source, to);

describe('the split inverse — a closer and an opener meeting at the seam', () => {
	it('two bold halves come back as one construct', () => {
		expect(merge('Some **bo**\n', '**ld** text\n')).toBe('Some **bold** text\n');
	});

	it('a split link comes back as one link on one destination', () => {
		expect(merge('Visit [exam](https://example.com)\n', '[ple](https://example.com) here\n')).toBe(
			'Visit [example](https://example.com) here\n'
		);
	});

	it('emphasis, strikethrough and a code span each rejoin on their own run', () => {
		expect(merge('*it*\n', '*al*\n')).toBe('*ital*\n');
		expect(merge('~~de~~\n', '~~l~~\n')).toBe('~~del~~\n');
		expect(merge('`co`\n', '`de`\n')).toBe('`code`\n');
	});

	it('a nested pair rejoins outermost-first', () => {
		expect(merge('**a *it***\n', '***al* b**\n')).toBe('**a *ital* b**\n');
	});

	it('the block above keeps its own kind and prefix', () => {
		expect(merge('## **bo**\n', '**ld**\n')).toBe('## **bold**\n');
	});

	// The pair is one construct's two halves only if the bytes say so: two links to different
	// places are two links, and collapsing them would silently retarget the first one's text.
	it('declines when the two runs are not the same construct', () => {
		expect(merge('[a](https://one.example)\n', '[b](https://two.example)\n')).toBeNull();
		expect(merge('__bo__\n', '**ld**\n')).toBeNull();
		expect(merge('`` a`b``\n', '`c`\n')).toBeNull();
	});

	// Only the constructs whose family declares close-and-reopen: an image's brackets are not a
	// pair a join may cut, and an autolink has no content of its own to rejoin.
	it('declines for families that declare no rejoin', () => {
		expect(merge('![a](u)\n', '![b](u)\n')).toBeNull();
		expect(merge('<https://a.example>\n', '<https://b.example>\n')).toBeNull();
	});

	it('leaves an ordinary join alone', () => {
		expect(merge('abc\n', 'def\n')).toBeNull();
		expect(merge('**bold**\n', 'plain\n')).toBeNull();
	});
});

describe('a truncation that strands a delimiter run', () => {
	// § 5's row: the reader saw bold, then italic; what survives is the joined TEXT, and the runs
	// whose partners the cut took are dropped rather than printed.
	it('bold to italic drops both stranded runs', () => {
		expect(sameBlock('**bold** and *italic*\n', 4, 16)).toBe('boalic\n');
	});

	// Same kind on both sides: the surviving opener and closer make one construct across the seam,
	// which is what the reader had, so the literal join already says it and the cleanup declines.
	it('the same construct cut on both sides keeps its pair', () => {
		expect(sameBlock('**bold**\n', 3, 5)).toBeNull();
		expect(deleteBetween('a **bold** b\n', 5, 'c **more** d\n', 5)).toBeNull();
		expect(deleteBetween('**a *bc* d**\n', 6, '**e *fg* h**\n', 6)).toBeNull();
	});

	it('a nested cut keeps the pair it can and drops the run it cannot', () => {
		expect(deleteBetween('**a *bc* d**\n', 6, '**e f**\n', 4)).toBe('**a bf**\n');
	});

	// Same kind, different bytes: markdown will not close `__` with `**`, so keeping the pair
	// prints both runs and the fallback reading drops everything the cut stranded.
	it('drops both runs where the two spellings cannot close each other', () => {
		expect(deleteBetween('__bold__ x\n', 3, 'y **more**\n', 7)).toBe('be\n');
	});

	// A construct with no content of its own cannot be cut into halves, so the seam stands down
	// and the caller keeps bytes that are at least honest about what they are.
	it('declines a cut through an atomic run', () => {
		expect(sameBlock('a <https://example.com> b\n', 10, 24)).toBeNull();
		expect(sameBlock('a \\* b\n', 3, 5)).toBeNull();
	});
});

describe('a join whose survivors are only terminal hard-break trivia', () => {
	// Miss-analysis (#113): the split half's terminal-trivia rule (#106) had deterministic unit
	// twins; the join half was covered only by the fresh-seed property lane, so the class flaked
	// at ~1 run in 6 instead of failing a named row.
	it('drops the trivia with the stranded run, not the run alone', () => {
		// `  \n` alone would reload as blank trivia — a different shape than the block written.
		expect(sameBlock('~~foo~~  \n', 0, 5)).toBe('\n');
	});

	it('closes the fresh-seed flake signature, CRLF ending included', () => {
		expect(sameBlock('foo*42*_lorem_  \r\n', 0, 13)).toBe('\r\n');
		expect(sameBlock('a[**bold**](u)  \n', 0, 10)).toBe('\n');
	});

	it('lands the caret at the emptied block start', () => {
		const node = blockOf('~~foo~~  \n');
		expect(
			cleanLiveJoinSeam({
				mergedRaw: node.raw.slice(5),
				seam: 0,
				start: { node, offset: 0 },
				end: { node, offset: 5 },
				linkRef: undefined
			})
		).toEqual({ raw: '\n', seam: 0 });
	});

	it('keeps trailing spaces while any content still stands', () => {
		expect(sameBlock('foo ~~ba~~  \n', 4, 8)).toBe('foo   \n');
	});
});

describe('what the cleanup refuses to be asked', () => {
	it('declines an offset outside the block content', () => {
		const heading = blockOf('## bo\n');
		expect(
			cleanLiveJoinSeam({
				mergedRaw: '## ld\n',
				seam: 1,
				start: { node: heading, offset: 1 },
				end: { node: heading, offset: 3 },
				linkRef: undefined
			})
		).toBeNull();
	});

	// The offsets below are the two sides' own; bytes a normalizer rewrote are no longer theirs.
	it('declines when the merged bytes are not the two sides end to end', () => {
		const start = blockOf('Some **bo**\n');
		const end = blockOf('**ld** text\n');
		expect(
			cleanLiveJoinSeam({
				mergedRaw: '> Some **bo****ld** text\n',
				seam: displayLength(start.raw),
				start: { node: start, offset: displayLength(start.raw) },
				end: { node: end, offset: 0 },
				linkRef: undefined
			})
		).toBeNull();
	});

	it('declines a non-prose kind', () => {
		const fence = blockOf('```\ncode\n```\n');
		const para = blockOf('x\n');
		expect(
			cleanLiveJoinSeam({
				mergedRaw: fence.raw.slice(0, 3) + para.raw,
				seam: 3,
				start: { node: fence, offset: 3 },
				end: { node: para, offset: 0 },
				linkRef: undefined
			})
		).toBeNull();
	});
});

// A construct standing over a content-empty one paints ALL its bytes (live-mode.md § 4.1), so a
// side that survives as chrome survives as bytes the reader saw. Miss-analysis: the painted-chrome
// pins used the FLAT `[](u)`, which both seams decline by childless arity (the wrong reason), so no
// case ever reached the cleaner with a painting side it could classify as a stranded run.
describe('a side that is painting chrome is not a stranded run', () => {
	const PAINTED = '**[](u)**\n';

	it('keeps a leading run the reader saw, whichever end of it survives', () => {
		expect(deleteBetween(PAINTED, 2, 'para\n', 2)).toBeNull();
		expect(deleteBetween(PAINTED, 7, 'para\n', 2)).toBeNull();
	});

	it('keeps a trailing run the reader saw', () => {
		expect(deleteBetween('para\n', 4, PAINTED, 7)).toBeNull();
	});

	// The same cut where the construct stands over content: those delimiters really are hidden,
	// so the cleanup is still the cleanup.
	it('still cleans a side whose construct stands over content', () => {
		expect(deleteBetween('**bold**\n', 2, 'para\n', 2)).toBe('ra\n');
	});
});
