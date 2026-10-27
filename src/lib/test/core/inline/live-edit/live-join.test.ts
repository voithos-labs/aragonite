// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { displayLength } from '#lib/core/lines.js';
import { cleanLiveJoinSeam, pairedPrefix } from '#lib/core/inline/live-edit/live-join.js';
import { topLevelStore } from '../../../harness/fixture-grammar';

// The bytes a live-mode join writes. Each case states the plain concatenation a refusal leaves,
// so a null return is covered as closely as a rewrite.

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
			typed: '',
			store: topLevelStore(start)
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
			typed: '',
			store: topLevelStore(start)
		})?.raw ?? null
	);
}

const sameBlock = (source: string, from: number, to: number) =>
	deleteBetween(source, from, source, to);

/** A selection inside one block typed over: the cleaned bytes with `typed` written where it lands. */
function typeOver(source: string, from: number, to: number, typed: string): string | null {
	const node = blockOf(source);
	const join = cleanLiveJoinSeam({
		mergedRaw: node.raw.slice(0, from) + node.raw.slice(to),
		seam: from,
		start: { node, offset: from },
		end: { node, offset: to },
		typed,
		store: topLevelStore(node)
	});
	return join && join.raw.slice(0, join.seam) + typed + join.raw.slice(join.seam);
}

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
	// pair a join may cut, and two halves of URLs are not one URL.
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
	// The user saw bold, then italic; each kept half keeps its format, closed or reopened at the cut.
	it('bold to italic closes the bold and reopens the italic', () => {
		expect(sameBlock('**bold** and *italic*\n', 4, 16)).toBe('**bo***alic*\n');
	});

	// Same kind on both sides: the surviving opener and closer make one construct across the join,
	// which is what the user had, so the plain concatenation already says it and nothing changes.
	it('the same construct cut on both sides keeps its pair', () => {
		expect(sameBlock('**bold**\n', 3, 5)).toBeNull();
		expect(deleteBetween('a **bold** b\n', 5, 'c **more** d\n', 5)).toBeNull();
		expect(deleteBetween('**a *bc* d**\n', 6, '**e *fg* h**\n', 6)).toBeNull();
	});

	it('a nested cut keeps the pair it can and closes the run it cannot', () => {
		expect(deleteBetween('**a *bc* d**\n', 6, '**e f**\n', 4)).toBe('**a *b*f**\n');
	});

	// Same kind, different bytes: markdown will not close `__` with `**`, so each half keeps its own.
	it('keeps both runs apart where the two spellings cannot close each other', () => {
		expect(deleteBetween('__bold__ x\n', 3, 'y **more**\n', 7)).toBe('__b__**e**\n');
	});

	// Miss-analysis: the drop reading paired runs by kind, and the screen check threw out what it
	// wrote, so every join row stayed green with the pairing gone.
	it('pairs two stranded runs only when they share delimiters', () => {
		const strong = { kind: 'strong', start: 0, end: 6, contentStart: 2, contentEnd: 4 } as const;
		const side = (raw: string) => ({ raw, dangling: [strong] });
		expect(pairedPrefix(side('__ab__'), side('**cd**'))).toBe(0);
		expect(pairedPrefix(side('__ab__'), side('__cd__'))).toBe(1);
	});

	// A URL or an escape cannot be cut into halves, so the cleanup does nothing and the caller
	// keeps bytes that are at least honest about what they are.
	it('declines a cut through a URL or an escape', () => {
		expect(sameBlock('a <https://example.com> b\n', 10, 24)).toBeNull();
		expect(sameBlock('a https://example.com b\n', 8, 23)).toBeNull();
		expect(sameBlock('a \\* b\n', 3, 5)).toBeNull();
	});
});

// G1.91: a live removal keeps the marks on the visible characters it keeps.
// Miss-analysis: every truncation row pinned the stranded run going, so the lost format read as the rule.
describe('a truncation keeps the format on the half that stays', () => {
	it.each([
		[
			'a bold run closes where the cut begins',
			'Some **bold** and words tail\n',
			9,
			16,
			'Some **bo**d words tail\n'
		],
		[
			'a bold run reopens where the cut ends',
			'Some text **and bold** tail\n',
			5,
			14,
			'Some **d bold** tail\n'
		],
		[
			'a link closes on its destination',
			'see [here](https://x.example) now\n',
			7,
			31,
			'see [he](https://x.example)ow\n'
		],
		['a code span closes on its fence', 'a `code` b\n', 5, 10, 'a `co`\n'],
		['strikethrough closes', '~~gone~~ x\n', 4, 9, '~~go~~x\n'],
		['a nested run closes innermost first', '***bold*** x\n', 5, 11, '***bo***x\n'],
		['two nested runs close innermost first', '~~a *bc* d~~ x\n', 6, 12, '~~a *b*~~ x\n'],
		[
			'an underscore run closes in the mark’s own bytes mid-word',
			'__bold__ and\n',
			4,
			10,
			'**bo**nd\n'
		]
	])('%s', (_label, source, from, to, expected) => {
		expect(sameBlock(source, from, to)).toBe(expected);
	});

	it('closes and reopens across two blocks', () => {
		expect(deleteBetween('Some **bold** x\n', 9, 'y *it* z\n', 4)).toBe('Some **bo***t* z\n');
	});

	// Two links to different places are two links, so the halves keep their own destinations.
	it('keeps two links apart that point at different places', () => {
		expect(deleteBetween('[ab](https://one.example)\n', 2, '[cd](https://two.example)\n', 2)).toBe(
			'[a](https://one.example)[d](https://two.example)\n'
		);
	});

	// The outermost runs that match merge, and the rest stay balanced inside them.
	it('merges the matching outer runs of two chains of different depth', () => {
		expect(merge('**a *b***\n', '**c**\n')).toBe('**a *b*c**\n');
	});

	it('puts the caret before the closer it wrote and reports where the far side starts', () => {
		const node = blockOf('Some **bold** and words tail\n');
		expect(
			cleanLiveJoinSeam({
				mergedRaw: node.raw.slice(0, 9) + node.raw.slice(16),
				seam: 9,
				start: { node, offset: 9 },
				end: { node, offset: 16 },
				typed: '',
				store: topLevelStore(node)
			})
		).toMatchObject({ raw: 'Some **bo**d words tail\n', seam: 9, seamEnd: 11 });
	});

	// Miss-analysis: the caret rows cut mid-word, never where a space had to step outside the run.
	it('puts the caret after a boundary space it moved outside the run', () => {
		const node = blockOf('**a b**\n');
		expect(
			cleanLiveJoinSeam({
				mergedRaw: node.raw.slice(0, 4) + node.raw.slice(5),
				seam: 4,
				start: { node, offset: 4 },
				end: { node, offset: 5 },
				typed: '',
				store: topLevelStore(node)
			})
		).toMatchObject({ raw: '**a** \n', seam: 6, seamEnd: 6 });
	});
});

describe('text typed over a cut through a run', () => {
	it('takes the format of the character before it', () => {
		expect(typeOver('Some **bold** and words tail\n', 9, 16, 'X')).toBe(
			'Some **boX**d words tail\n'
		);
	});

	// A link never grows at its edge (live-mode.md § 4.2).
	it('lands after a link', () => {
		expect(typeOver('see [here](u) now\n', 7, 15, 'X')).toBe('see [he](u)Xow\n');
	});

	// The typed text fills the run back in, so the literal replace already says it.
	it('fills a run it replaces whole', () => {
		expect(typeOver('Some **bold** text\n', 7, 11, 'X')).toBeNull();
	});

	// Inside one link the text typed over its whole content is the link's new text.
	// Miss-analysis: the typed-text rows only cut a link's text in part, never all of it.
	it('replaces a link’s text it covers whole', () => {
		expect(typeOver('see [here](u) now\n', 5, 9, 'X')).toBeNull();
	});
});

describe('a join whose survivors are only terminal hard-break blank lines', () => {
	// Miss-analysis: GH #113, only the random property suite covered the join, failing 1 run in 6.
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
				typed: '',
				store: topLevelStore(node)
			})
		).toMatchObject({ raw: '\n', seam: 0 });
	});

	it('keeps trailing spaces while any content still stands', () => {
		expect(sameBlock('foo ~~ba~~  \n', 4, 8)).toBe('foo   \n');
	});
});

// Miss-analysis: join cases left content on one side, and the empty-pair regex missed `[](url)`.
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
				typed: '',
				store: topLevelStore(node)
			})
		).toMatchObject({ raw: ' more\n', seam: 0 });
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

	// Miss-analysis: no case had a reading that leaves fewer empty pairs but shows the wrong text,
	// so a floor taken over every reading went unseen.
	it('weighs empty pairs only among the readings that show what the screen showed', () => {
		expect(typeOver('~~a~~*[](u)***\n', 2, 5, 'X')).toBe('~~X~~*[](u)***\n');
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
				typed: '',
				store: topLevelStore(heading)
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
				typed: '',
				store: topLevelStore(start)
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
				typed: '',
				store: topLevelStore(fence)
			})
		).toBeNull();
	});
});

// A construct over an empty one shows its bytes (live-mode.md § 4.1), so the user saw that side.
// Miss-analysis: visible cases used flat `[](u)`, which both rewrites refuse for another reason.
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

// An empty link has no content range, so a cut inside it leaves halves no reading can repair.
// Miss-analysis: an empty link and one with text were never contrasted, so a per-kind rule passed.
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
