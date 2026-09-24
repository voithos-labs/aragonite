import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { deleteNode } from '$lib/tree-operations/settle';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { splitNode } from '$lib/tree-operations/node-ops';
import { trailingLineEnding } from '$lib/core/lines';
import { expectParseConverged, layoutOf as layout } from '$lib/test/harness/parse-converged';
import type { Document } from '$lib/core/nodes';

// The reverse of the typed-blank-line cases (`typed-blank-lines-reload.test.ts`): a block that
// becomes blank joins the blank run around it, and a run carries exactly the one separating line
// its reload produces. Two of them reload as an empty paragraph nobody typed; none merges the
// run's head into the block above.
// Miss-analysis: every blank-line case drove the fill direction (a blank block gaining content),
// so nothing emptied a block, and `updateNodeContent` fixed up one direction of the transition.

/** The gesture: `TextEditableBlock.commitInput` sends `text + trailingLineEnding(raw)`, so an
 *  emptied block sends the line ending alone. */
function empty(doc: Document, index: number): void {
	updateNodeContent(doc, index, trailingLineEnding(doc.children[index].raw));
}

function expectReloadsAsItStands(doc: Document, bytes: string): void {
	expect(serialize(doc)).toBe(bytes);
	expect(layout(parse(bytes).children)).toEqual(layout(doc.children));
}

describe('emptying a block settles the run it joins', () => {
	it('drops the separator its follower already carries', () => {
		const doc = parse('alpha\n\nx\n\ndelta\n');

		empty(doc, 1);

		expectReloadsAsItStands(doc, 'alpha\n\n\ndelta\n');
	});

	// The block carries no separator of its own (the blank block above it opens the run), so the
	// one the follower holds is the second, not the first.
	it('drops the follower separator when a blank block already opens the run', () => {
		const doc = parse('a\n\n\nx\n\nb\n');

		empty(doc, 2);

		expectReloadsAsItStands(doc, 'a\n\n\n\nb\n');
	});

	// A split leaves the separator on the follower, so the run's second line sits two positions
	// past the block being emptied: a fix-up reaching only `index + 1` finds a blank block with none.
	it('reaches past a blank follower to the separator a split left below it', () => {
		const doc = parse('Hello\n\nSecond\n');
		splitNode(doc, 0, 5, undefined, undefined, undefined);
		splitNode(doc, 1, 0, undefined, undefined, undefined);
		updateNodeContent(doc, 1, 'x\n');
		expect(layout(doc.children)).toEqual([
			['paragraph', '', 'Hello\n'],
			['paragraph', '\n', 'x\n'],
			['paragraph', '', '\n'],
			['paragraph', '\n', 'Second\n']
		]);

		empty(doc, 1);

		expectReloadsAsItStands(doc, 'Hello\n\n\n\nSecond\n');
	});

	// A document-leading run separates from nothing, so every line is a block and the run carries
	// no separator at all: the follower's is one too many, not one of two.
	it('leaves a head run no separator at all', () => {
		const doc = parse('x\n\nb\n');

		empty(doc, 0);

		expectReloadsAsItStands(doc, '\nb\n');
	});

	// A multi-block commit puts the new blank at the end of what it created, where it meets the
	// follower; the position the gesture named is prose.
	it('settles the last block a multi-block commit created', () => {
		const doc = parse('alpha\n\nx\n\ndelta\n');

		updateNodeContent(doc, 1, 'p\n\n\n');

		expectReloadsAsItStands(doc, 'alpha\n\np\n\n\ndelta\n');
	});
});

// A fence terminates itself, so the paragraph under it carries no separator, and once that
// paragraph is blank, the run holds none and the reload swallows the block instead of doubling it.
// Miss-analysis: the class was filed as doubling, and a doubling-only fix reads the same red as
// green here; only a check over the run's whole line count sees both signs.
describe('emptying a block the run above cannot separate from', () => {
	it('creates the separator a self-terminating predecessor never had to supply', () => {
		const doc = parse('```\nc\n```\nx\n');

		empty(doc, 1);

		expectReloadsAsItStands(doc, '```\nc\n```\n\n\n');
	});

	// The run's one line already stands, on the follower rather than the run head. Both
	// placements are the same bytes and reload alike, so the fix-up leaves it where it is
	// instead of moving it, hence bytes and convergence here, not a layout match.
	it('leaves the line the follower already holds alone', () => {
		const doc = parse('```\nc\n```\nx\n\nb\n');

		empty(doc, 1);

		expect(serialize(doc)).toBe('```\nc\n```\n\n\nb\n');
		expectParseConverged(doc);
	});
});

describe('emptying a block that must supply nothing', () => {
	it('keeps the tail block its own separator', () => {
		const doc = parse('a\n\nx\n');

		empty(doc, 1);

		expectReloadsAsItStands(doc, 'a\n\n\n');
	});

	// The fill branch creates the follower's separator and declines below the blank tail this
	// commit leaves, so the two branches compose rather than doubling the line between them.
	it('leaves a fill whose own last block is blank converged', () => {
		const doc = parse('alpha\n\n\ndelta\n');

		updateNodeContent(doc, 1, 'p\n\n\n');

		expectReloadsAsItStands(doc, 'alpha\n\np\n\n\ndelta\n');
	});
});

// Indentation alone delimits indented code, so a block turning blank puts bytes back to back that
// re-read as fewer blocks: the join `deleteNode` has always merged, and the content write must
// too. G2.13's `empty` branch sat behind a `holdsIndentedCode` precondition for exactly these
// shapes. Miss-analysis: the property branch excluded them by precondition, and its fixed seed
// does not draw the shape even with the precondition off, so it could not have failed on this
// class either way, and the deterministic cases are what actually guard the write.
describe('emptying a block beside indentation-delimited content', () => {
	it('absorbs the join the two neighbours now make', () => {
		const doc = parse('**b**\n\n    code\n\n\n**b**\n\n    code\n\n> q\n');

		empty(doc, 3);

		expect(serialize(doc)).toBe('**b**\n\n    code\n\n\n\n    code\n\n> q\n');
		expect(doc.children).toHaveLength(3);
		expectParseConverged(doc);
	});

	// The code's tab-indented blank line reaches the item's content column, so the list takes it
	// along with the code, exactly as the reload reads it.
	it('lets the list take the code’s indented blank line with it', () => {
		const doc = parse('- - # **b**\n\n| H0 |\n| --- | --- |\n\n    code\n\t\n\n```\n```\n');

		empty(doc, 1);

		expect(serialize(doc)).toBe('- - # **b**\n\n\n    code\n\t\n\n```\n```\n');
		expect(layout(doc.children)).toEqual([
			['list', '', '- - # **b**\n\n\n    code\n\t\n'],
			['fencedCode', '\n', '```\n```\n']
		]);
		expectParseConverged(doc);
	});

	// The tab-indented blank line belongs to the code but stops short of the item's content
	// column (five), so the joined bytes end in it; here it becomes a block, as the reload reads it.
	it('materializes a trailing blank line the list leaves behind instead of hiding it in raw', () => {
		const doc = parse('1.   # **b**\n\n| H0 |\n| --- | --- |\n\n     code\n\t\n\n```\n```\n');

		empty(doc, 1);

		expect(serialize(doc)).toBe('1.   # **b**\n\n\n     code\n\t\n\n```\n```\n');
		expect(layout(doc.children)).toEqual([
			['list', '', '1.   # **b**\n\n\n     code\n'],
			['paragraph', '\t\n', '\n'],
			['fencedCode', '', '```\n```\n']
		]);
		expectParseConverged(doc);
	});

	// The higher-traffic caller of the same merge: a delete puts the neighbours back to back the
	// same way, and its window can split off the same trailing line.
	it('materializes the trailing blank line on the delete entry point too', () => {
		const doc = parse('1.   # **b**\n\nmid\n\n     code\n\t\n\n```\n```\n');

		deleteNode(doc, 1);

		expect(serialize(doc)).toBe('1.   # **b**\n\n     code\n\t\n\n```\n```\n');
		expectParseConverged(doc);
	});
});

// The fix-up's line ending comes off the node it writes, never a defaulted LF (G4.20).
describe('the CRLF variants', () => {
	it('drops a CRLF separator', () => {
		const doc = parse('alpha\r\n\r\nx\r\n\r\ndelta\r\n');

		empty(doc, 1);

		expectReloadsAsItStands(doc, 'alpha\r\n\r\n\r\ndelta\r\n');
	});

	it('creates a CRLF separator', () => {
		const doc = parse('```\r\nc\r\n```\r\nx\r\n');

		empty(doc, 1);

		expectReloadsAsItStands(doc, '```\r\nc\r\n```\r\n\r\n\r\n');
	});
});
