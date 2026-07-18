import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { mergeListItemIntoPrevious } from '$lib/tree-operations/list/unwrap-merge';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import type { Document } from '$lib/core/nodes';

// Preserve-absolute-indent relocation of the merged-away item's remaining
// children. merge-list-item.test.ts pins tree shape + mergePoint; this file
// pins the serialized markdown the relocation produces — and that the live tree
// the relocation leaves behind converges with a reparse of that markdown (the
// byte round-trip alone is a tautology that would pass on a stale list raw).

function mergeAndConverge(src: string, currentIndex: number): { doc: Document; source: string } {
	const doc = parse(src);
	const list = doc.children[0];
	if (list?.kind !== 'list') {
		throw new Error(`expected list, got ${list?.kind}`);
	}
	mergeListItemIntoPrevious(list, list.children!.slice(), currentIndex);
	return { doc, source: serialize(doc) };
}

// When the relocation absorbs a merged-away item's trailing paragraph, it keeps
// the blank-line separator (the same separator-ownership rule split and list-exit
// carry): the two paragraphs stay distinct on reload rather than lazy-continuing
// into one. Promoted nested-list items need no separator — a marker line always
// starts a fresh item.

describe('relocateRemainingChildren (via mergeListItemIntoPrevious)', () => {
	it('depth-0 target: trailing paragraph absorbed into the target item stays a separate paragraph', () => {
		const { doc, source } = mergeAndConverge('- A\n- B\n\n  extra\n', 1);

		expect(source).toBe('- AB\n\n  extra\n');
		expectParseConverged(doc);
		expect(serialize(parse(source))).toBe(source);
	});

	it('depth-≥1 target: nested-list items promote to the depth-1 sibling list', () => {
		const { doc, source } = mergeAndConverge('- A\n  - B\n    - C\n- D\n  - E\n', 1);

		// E keeps absolute depth 1 (no blank line — a list marker needs no separator).
		expect(source).toBe('- A\n  - B\n    - CD\n  - E\n');
		expectParseConverged(doc);
		expect(serialize(parse(source))).toBe(source);
	});

	it('depth-≥1 target: non-list child absorbed into the target item keeps the separator', () => {
		const { doc, source } = mergeAndConverge('- A\n  - B\n- C\n\n  extra\n', 1);

		expect(source).toBe('- A\n  - BC\n\n    extra\n');
		expectParseConverged(doc);
		expect(serialize(parse(source))).toBe(source);
	});
});
