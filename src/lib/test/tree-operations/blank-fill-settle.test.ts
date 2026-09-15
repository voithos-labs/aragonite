import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// B-F1: the blank-to-content branch returned before the neighbour merge, so filling a blank line
// whose bytes an indentation-delimited neighbour above absorbs left the live tree one block
// richer than its own reload, silently, on ordinary typing. The content-to-blank branch has
// always been fixed up.
// Miss-analysis: the fill suites fill with prose that merges into nothing, and the join suites
// all start from a non-blank block, so the blank-fill with a mergeable neighbour had no case.

/** A list, a blank line of its own, and a follower: the fill lands in the blank position. */
const SOURCE = '- a\n\n\nzz\n';

function filled(text: string) {
	const doc = parse(SOURCE);
	expect(doc.children.map((c) => c.kind)).toEqual(['list', 'paragraph', 'paragraph']);
	updateNodeContent(doc, 1, text);
	return doc;
}

describe('filling a blank block settles the seams the fill disturbed', () => {
	// Both fill branches, because the noop check swallowed the same-kind one even after the early
	// return went: a blank-to-content transition needs the fix-up whatever its change op says.
	it.each([
		['a kind change the list absorbs', '    code\n', '- a\n\n    code\n\nzz\n'],
		['a same-kind fill the list absorbs', '  b\n', '- a\n\n  b\n\nzz\n']
	])('converges on %s', (_label, text, bytes) => {
		const doc = filled(text);
		expect(serialize(doc)).toBe(bytes);
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children.map((c) => c.kind)).toEqual(['list', 'paragraph']);
	});

	// The perf rationale the branch's early return protected: a fill with nothing to absorb above
	// still separates on both sides and stays three blocks.
	it('leaves a fill whose neighbours cannot absorb it alone', () => {
		const doc = filled('b\n');
		expect(serialize(doc)).toBe('- a\n\nb\n\nzz\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(doc.children).toHaveLength(3);
	});
});
