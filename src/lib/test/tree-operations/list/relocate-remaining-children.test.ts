import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { mergeListItemIntoPrevious } from '$lib/test/harness/list-merge';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import type { Document } from '$lib/core/nodes';
import { fixtureReading } from '../../harness/fixture-grammar';
import { createSharingState } from '$lib/tree-operations/sharing';

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
		createSharingState(),
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

// Miss-analysis (GH #555): every relocated leaf here was a paragraph, the one kind the old rule
// gave a separator, so a block that needed its own blank line kept was never moved.
describe('a relocated child keeps its own blank line', () => {
	it.each([
		['indented code after a blank line', '- a\n- b\n\n      code\n', '- ab\n\n      code\n'],
		['a quote right under the text', '- a\n- b\n  > q\n', '- ab\n  > q\n'],
		['a paragraph after a blank line', '- a\n- b\n\n  extra\n', '- ab\n\n  extra\n']
	])('%s', (_name, src, expected) => {
		const { doc, source } = mergeAndConverge(src, 1);

		expect(source).toBe(expected);
		expectParseConverged(doc);
	});
});
