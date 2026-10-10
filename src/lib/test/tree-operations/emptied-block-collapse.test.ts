import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { Document } from '#lib/core/nodes.js';
import { deleteNode } from '#lib/tree-operations/settle.js';
import { mergeIntoPrevDeepLeaf } from '#lib/tree-operations/node-ops.js';
import { registerFootnoteDefinition } from '#lib/plugins/footnotes/footnote-definition.js';
import { describeConvergence } from '../harness/parse-converged';
import { fixtureReading } from '../harness/fixture-grammar';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';

// Backspace on an emptied middle block collapses its line on the merge route as on the delete
// route, whatever kind of block follows it.
// Miss-analysis: the delete route was tested and the merge route was not.

/** Backspace on an emptied middle block: `above`, one blank block, then `tail`. */
const sourceWith = (tail: string) => `above\n\n\n${tail}`;

const TAILS: readonly [name: string, tail: string][] = [
	['paragraph', 'below\n'],
	['footnote definition', '[^a]: note\n'],
	['link reference definition', '[a]: /url\n'],
	['html block', '<div>\nx\n</div>\n'],
	['heading', '# H\n'],
	['thematic break', '---\n'],
	['fenced code', '```\ncode\n```\n']
];

function collapsed(tail: string, op: (doc: Document) => void): Document {
	const doc = parse(sourceWith(tail));
	expect(doc.children).toHaveLength(3);
	expect(doc.children[1].raw).toBe('\n');
	op(doc);
	return doc;
}

describe('an emptied middle block takes its own blank line with it', () => {
	beforeEach(() => {
		registerFootnoteDefinition();
	});

	describe.each(TAILS)('above / blank / %s', (_name, tail) => {
		it('merges into the block above, leaving one separator', () => {
			const doc = collapsed(tail, (d) => {
				mergeIntoPrevDeepLeaf(d, 1, createSharingState(), fixtureReading());
			});

			expect(serialize(doc)).toBe(`above\n\n${tail}`);
			expect(doc.children).toHaveLength(2);
			expect(describeConvergence(doc)).toBeNull();
		});

		it('deletes to the same shape the merge reaches', () => {
			const merged = collapsed(tail, (d) => {
				mergeIntoPrevDeepLeaf(d, 1, createSharingState(), fixtureReading());
			});
			const deleted = collapsed(tail, (d) =>
				deleteNode(d, 1, defaultGrammarView, createSharingState())
			);

			expect(serialize(deleted)).toBe(serialize(merged));
			expect(describeConvergence(deleted)).toBeNull();
		});
	});

	// The leftover-blank shape round-trips its bytes, so only the reload check catches it (G2.1).
	it('rejects the leftover-blank shape the collapse used to leave', () => {
		const doc = parse('above\n\n[^a]: note\n');
		doc.children[1].leadingTrivia = '\n\n';

		expect(describeConvergence(doc)).toMatch(/live has 2 children, reparsed has 3/);
	});
});
