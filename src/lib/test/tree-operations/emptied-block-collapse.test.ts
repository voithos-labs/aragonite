import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { Document } from '$lib/core/nodes';
import { deleteNode, mergeWithPrevious } from '$lib/tree-operations/node-ops';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { registerFootnoteDefinition } from '$lib/plugins/footnotes/footnote-definition';
import { describeConvergence } from '../harness/parse-converged';

// Miss-analysis (emptied-middle-block collapse): the blank-line rule made every splice derive
// its separator, and the delete arm was pinned while the merge arm was not — so the merge kept
// the emptied block's line and left bytes that reload one block wider. The rule is
// kind-agnostic, so the pin is the family: a successor that is not a paragraph (a footnote
// definition, a link reference definition, an html block) must collapse identically.

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
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerFootnoteDefinition();
	});
	afterEach(__resetSchemaRegistriesForTests);

	describe.each(TAILS)('above / blank / %s', (_name, tail) => {
		it('merges into the block above, leaving one separator', () => {
			const doc = collapsed(tail, (d) => mergeWithPrevious(d, 1, undefined, undefined));

			expect(serialize(doc)).toBe(`above\n\n${tail}`);
			expect(doc.children).toHaveLength(2);
			expect(describeConvergence(doc)).toBeNull();
		});

		it('deletes to the same shape the merge reaches', () => {
			const merged = collapsed(tail, (d) => mergeWithPrevious(d, 1, undefined, undefined));
			const deleted = collapsed(tail, (d) => deleteNode(d, 1));

			expect(serialize(deleted)).toBe(serialize(merged));
			expect(describeConvergence(deleted)).toBeNull();
		});
	});

	// Non-vacuity: the shape this replaced kept the emptied block's line, and the oracle above
	// is what tells the two apart — the bytes alone round-trip either way (G2.1).
	it('rejects the leftover-blank shape the collapse used to leave', () => {
		const doc = parse('above\n\n[^a]: note\n');
		doc.children[1].leadingTrivia = '\n\n';

		expect(describeConvergence(doc)).toMatch(/live has 2 children, reparsed has 3/);
	});
});
