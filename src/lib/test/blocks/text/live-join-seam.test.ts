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
