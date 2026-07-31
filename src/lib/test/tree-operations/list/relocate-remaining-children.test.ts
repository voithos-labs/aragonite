import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { mergeListItemIntoPrevious } from '$lib/tree-operations/list/unwrap-merge';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import type { Document } from '$lib/core/nodes';

// merge-list-item.test.ts pins tree shape and mergePoint; this file pins the serialized
// markdown plus its convergence with a reparse — the byte round-trip alone is a
// tautology that passes on a stale list raw.

function mergeAndConverge(src: string, currentIndex: number): { doc: Document; source: string } {
	const doc = parse(src);
	const list = doc.children[0];
	if (list?.kind !== 'list') {
		throw new Error(`expected list, got ${list?.kind}`);
	}
	mergeListItemIntoPrevious(list, list.children!.slice(), currentIndex);
	return { doc, source: serialize(doc) };
}

// An absorbed trailing paragraph keeps its blank-line separator (the separator-ownership
// rule split and list-exit carry) or the two lazy-continue into one on reload. Promoted
// nested-list items need none: a marker line always starts a fresh item.

describe('relocateRemainingChildren (via mergeListItemIntoPrevious)', () => {
	it('depth-0 target: trailing paragraph absorbed into the target item stays a separate paragraph', () => {
		const { doc, source } = mergeAndConverge('- A\n- B\n\n  extra\n', 1);

		expect(source).toBe('- AB\n\n  extra\n');
		expectParseConverged(doc);
		expect(serialize(parse(source))).toBe(source);
	});

	it('depth-≥1 target: nested-list items promote to the depth-1 sibling list', () => {
		const { doc, source } = mergeAndConverge('- A\n  - B\n    - C\n- D\n  - E\n', 1);

		// E keeps absolute depth 1; a list marker needs no separator.
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
