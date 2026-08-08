import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { splitNode, updateNodeContent } from '$lib/tree-operations/node-ops';
import { trailingLineEnding } from '$lib/core/lines';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import type { CstNode, Document } from '$lib/core/nodes';

// The reverse of the typed-blank-line spine (`typed-blank-lines-reload.test.ts`): a block that
// BECOMES blank joins the blank run around it, and a run carries exactly the one separating line
// its reload mints. Two of them reload as an empty paragraph nobody typed; none folds the run's
// head into the block above.
// Miss-analysis: every blank-line case drove the FILL direction — a blank block gaining content —
// so nothing emptied a block, and `updateNodeContent` settled one direction of the transition.

const layout = (nodes: readonly CstNode[]): [string, string, string][] =>
	nodes.map((n) => [n.kind, n.leadingTrivia, n.raw]);

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

	// The slot carries no separator of its own — the blank block above it opens the run — so the
	// one the follower holds is the second, not the first.
	it('drops the follower separator when a blank block already opens the run', () => {
		const doc = parse('a\n\n\nx\n\nb\n');

		empty(doc, 2);

		expectReloadsAsItStands(doc, 'a\n\n\n\nb\n');
	});

	// A split leaves the separator on the FOLLOWER, so the run's second line sits two slots past
	// the block being emptied: a settle reaching only `index + 1` finds a blank block with none.
	it('reaches past a blank follower to the separator a split left below it', () => {
		const doc = parse('Hello\n\nSecond\n');
		splitNode(doc, 0, 5, undefined);
		splitNode(doc, 1, 0, undefined);
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

	// A document-leading run separates from nothing, so it materializes in full and carries no
	// line at all — the follower's is one too many, not one of two.
	it('leaves a head run no separator at all', () => {
		const doc = parse('x\n\nb\n');

		empty(doc, 0);

		expectReloadsAsItStands(doc, '\nb\n');
	});

	// A multi-block commit puts the new blank at the END of what it minted, where it meets the
	// follower; the slot the gesture named is prose.
	it('settles the last block a multi-block commit minted', () => {
		const doc = parse('alpha\n\nx\n\ndelta\n');

		updateNodeContent(doc, 1, 'p\n\n\n');

		expectReloadsAsItStands(doc, 'alpha\n\np\n\n\ndelta\n');
	});
});

// A fence terminates itself, so the paragraph under it carries no separator — and once that
// paragraph is blank, the run holds none and the reload swallows the block instead of doubling it.
// Miss-analysis: the class was filed as doubling, and a doubling-only fix reads the same red as
// green here; only an oracle over the run's whole line count sees both signs.
describe('emptying a block the run above cannot separate from', () => {
	it('mints the separator a self-terminating predecessor never owed', () => {
		const doc = parse('```\nc\n```\nx\n');

		empty(doc, 1);

		expectReloadsAsItStands(doc, '```\nc\n```\n\n\n');
	});

	// The run's one line already stands, on the follower rather than the run head. Both
	// placements are the same bytes and reload alike, so the settle leaves it where it is
	// instead of moving it — hence bytes and convergence here, not a layout match.
	it('leaves the line the follower already holds alone', () => {
		const doc = parse('```\nc\n```\nx\n\nb\n');

		empty(doc, 1);

		expect(serialize(doc)).toBe('```\nc\n```\n\n\nb\n');
		expectParseConverged(doc);
	});
});

describe('emptying a block that owes nothing', () => {
	it('keeps the tail block its own separator', () => {
		const doc = parse('a\n\nx\n');

		empty(doc, 1);

		expectReloadsAsItStands(doc, 'a\n\n\n');
	});

	// The fill arm mints the follower's separator and declines below the blank tail this commit
	// leaves, so the two arms compose rather than doubling the line between them.
	it('leaves a fill whose own last block is blank converged', () => {
		const doc = parse('alpha\n\n\ndelta\n');

		updateNodeContent(doc, 1, 'p\n\n\n');

		expectReloadsAsItStands(doc, 'alpha\n\np\n\n\ndelta\n');
	});
});

// G4.20: the settle's bytes come off the node it writes, never a defaulted LF.
describe('the CRLF twins', () => {
	it('drops a CRLF separator', () => {
		const doc = parse('alpha\r\n\r\nx\r\n\r\ndelta\r\n');

		empty(doc, 1);

		expectReloadsAsItStands(doc, 'alpha\r\n\r\n\r\ndelta\r\n');
	});

	it('mints a CRLF separator', () => {
		const doc = parse('```\r\nc\r\n```\r\nx\r\n');

		empty(doc, 1);

		expectReloadsAsItStands(doc, '```\r\nc\r\n```\r\n\r\n\r\n');
	});
});
