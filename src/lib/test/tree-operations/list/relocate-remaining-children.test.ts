import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { mergeListItemIntoPrevious } from '$lib/tree-operations/list/unwrap-merge';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import type { Document } from '$lib/core/nodes';
import { fixtureReading } from '../../harness/fixture-grammar';

// The bytes an item merge writes, also checked against a reparse, since a round-trip of the
// bytes alone passes on a stale list raw.

function mergeAndConverge(src: string, currentIndex: number): { doc: Document; source: string } {
	const doc = parse(src);
	const list = doc.children[0];
	if (list?.kind !== 'list') {
		throw new Error(`expected list, got ${list?.kind}`);
	}
	mergeListItemIntoPrevious(
		list,
		list.children!.slice(),
		currentIndex,
		undefined,
		fixtureReading()
	);
	return { doc, source: serialize(doc) };
}

// An absorbed trailing paragraph keeps its blank-line separator, or it lazily continues into the
// joined text on reload; a promoted sublist item needs none, since a marker line starts an item.

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

	// Miss-analysis: every row joined into a paragraph that stayed one.
	it('a join that changes the target kind still moves the trailing sublist under the target item', () => {
		const { doc, source } = mergeAndConverge('- ######\n- #x\n  - sub\n', 1);

		expect(source).toBe('- #######x\n  - sub\n');
		expect(doc.children[0].children![0].children!.map((c) => c.kind)).toEqual([
			'paragraph',
			'list'
		]);
		expectParseConverged(doc);
	});
});
