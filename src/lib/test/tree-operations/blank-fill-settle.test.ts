import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { createSharingState } from '$lib/tree-operations/sharing';

// Filling a blank line runs the neighbour merge, so a fill that an indentation-delimited block
// above absorbs leaves the same tree its reload reads.
// Miss-analysis: no fill case had a block above that could absorb the filled text.

/** A list, a blank line of its own, and a follower: the fill lands in the blank position. */
const SOURCE = '- a\n\n\nzz\n';

function filled(text: string) {
	const doc = parse(SOURCE);
	expect(doc.children.map((c) => c.kind)).toEqual(['list', 'paragraph', 'paragraph']);
	updateNodeContent(doc, 1, text, defaultGrammarView, createSharingState());
	return doc;
}

describe('filling a blank block settles the joins the fill disturbed', () => {
	// Both fill branches, since a blank-to-content fill needs the fix-up whatever its change op says.
	it.each([
		['a kind change the list absorbs', '    code\n', '- a\n\n    code\n\nzz\n'],
		['a same-kind fill the list absorbs', '  b\n', '- a\n\n  b\n\nzz\n']
	])('converges on %s', (_label, text, bytes) => {
		const doc = filled(text);
		expect(serialize(doc)).toBe(bytes);
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.kind)).toEqual(['list', 'paragraph']);
	});

	it('leaves a fill whose neighbours cannot absorb it alone', () => {
		const doc = filled('b\n');
		expect(serialize(doc)).toBe('- a\n\nb\n\nzz\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children).toHaveLength(3);
	});
});
