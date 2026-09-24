// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { displayLength } from '$lib/core/lines';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import { fixtureLinkRef } from '../../harness/fixture-grammar';

// The bytes a live-mode join writes. Every case states the plain concatenation the cleanup is
// offered, which is what a refusal leaves behind, so a null return is covered as closely as a
// rewrite.

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
			linkRef: fixtureLinkRef()
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
			linkRef: fixtureLinkRef()
		})?.raw ?? null
	);
}

const sameBlock = (source: string, from: number, to: number) =>
	deleteBetween(source, from, source, to);

describe('the split inverse: a closer and an opener meeting at the join', () => {
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
	// The § 5 case: the user saw bold, then italic; what survives is the joined text, and the runs
	// whose partners the cut took are dropped rather than printed.
	it('bold to italic drops both stranded runs', () => {
		expect(sameBlock('**bold** and *italic*\n', 4, 16)).toBe('boalic\n');
	});

	// Same kind on both sides: the surviving opener and closer make one construct across the join,
	// which is what the user had, so the plain concatenation already says it and nothing changes.
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

	// A construct with no content of its own cannot be cut into halves, so the cleanup does
	// nothing and the caller keeps bytes that are at least honest about what they are.
	it('declines a cut through an atomic run', () => {
		expect(sameBlock('a <https://example.com> b\n', 10, 24)).toBeNull();
		expect(sameBlock('a \\* b\n', 3, 5)).toBeNull();
	});
});

describe('a join whose survivors are only terminal hard-break blank lines', () => {
	// Miss-analysis (GH #113): the split half's trailing-whitespace rule (GH #106) had matching
	// deterministic tests; the join half was covered only by the random property suite, so the
	// case failed about one run in six instead of failing a named test.
	it('drops the blank lines with the stranded run, not the run alone', () => {
		// `  \n` alone would reparse as a blank line, not the block that was written.
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
				linkRef: fixtureLinkRef()
			})
		).toEqual({ raw: '\n', seam: 0 });
	});

	it('keeps trailing spaces while any content still stands', () => {
		expect(sameBlock('foo ~~ba~~  \n', 4, 8)).toBe('foo   \n');
	});
});

// Miss-analysis: every join case cut a construct so that one side kept content, so the shape
// where both sides together empty it was never drawn; and the empty-pair check spelled leftovers
// as an asterisk-family regex, which `[](url)` does not match, so the property suite missed it.
describe('a join that would leave a construct enclosing nothing unwraps it', () => {
	it('unwraps a link the cut emptied rather than leaving [](url) unpainted', () => {
		expect(sameBlock('[text](url) more\n', 1, 5)).toBe(' more\n');
	});

	it('lands the caret where the emptied construct stood', () => {
		const node = blockOf('[text](url) more\n');
		expect(
			cleanLiveJoinSeam({
				mergedRaw: '[](url) more\n',
				seam: 1,
				start: { node, offset: 1 },
				end: { node, offset: 5 },
				linkRef: fixtureLinkRef()
			})
		).toEqual({ raw: ' more\n', seam: 0 });
	});

	// Across two blocks, and through a nesting chain: emptying the inner link leaves the strong
	// enclosing nothing, so both runs go rather than one pair surviving around the other's residue.
	it('unwraps across two blocks, and through a nesting chain', () => {
		expect(deleteBetween('a [te](url)\n', 3, '[xt](url) b\n', 3)).toBe('a  b\n');
		expect(sameBlock('x **[a](u)** y\n', 5, 6)).toBe('x  y\n');
	});

	// The reading that keeps the runs is the one that empties the link here, so "fewest drops" has
	// to be read among the readings that leave none behind.
	it('prefers the fuller drop where the leaner one empties a construct', () => {
		expect(sameBlock('[**bold**]()*x***foo**\n', 1, 7)).toBe('*x***foo**\n');
	});

	// Only what this cut emptied: an empty pair the document already carried is bytes the gesture
	// never aimed at, and dropping it would take more than the user asked for.
	it('leaves residue the cut did not create', () => {
		expect(sameBlock('[](url) some text\n', 9, 13)).toBeNull();
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
				linkRef: fixtureLinkRef()
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
				linkRef: fixtureLinkRef()
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
				linkRef: fixtureLinkRef()
			})
		).toBeNull();
	});
});

// A construct standing over an empty one shows all its bytes (live-mode.md § 4.1), so a side that
// survives as visible markers survives as bytes the user saw. Miss-analysis: the visible-marker
// cases used the flat `[](u)`, which both rewrites refuse because it has no children, the wrong
// reason, so none reached the cleanup with a visible side it could call a stranded run.
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

// Which constructs count as atomic is a fact about the node here too: an empty link has no content
// range, so a cut inside it leaves halves no reading can repair, while the same cut inside a link
// with text leaves an ordinary open run. Miss-analysis: the two shapes were never contrasted, so a
// per-kind column looked like it could replace the test that produces both answers.
describe('a cut inside a construct with no content declines', () => {
	// 3 is the empty content point itself, where no delimiter run is cut and the node's own arity
	// is all that is left to decline on; 4 is inside the closer, which the run test also catches.
	it.each([3, 4])(
		'declines inside an empty link cut at %i, a kind otherwise rejoinable',
		(from) => {
			expect(sameBlock('A [](u) B\n', from, 8)).toBeNull();
		}
	);

	it('still cleans the same cut inside a link that has text', () => {
		expect(sameBlock('A [a](u) B\n', 3, 9)).toBe('A B\n');
	});
});
