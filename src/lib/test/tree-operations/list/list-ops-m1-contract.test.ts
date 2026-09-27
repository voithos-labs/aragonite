import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { mergeListItemIntoPrevious } from '$lib/tree-operations/list/unwrap-merge';
import { checkStaleRaw } from '$lib/invariants/node-shape';
import { metadataOf } from '$lib/core/nodes';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { fixtureGrammar, fixtureReading } from '../../harness/fixture-grammar';

describe('mergeListItemIntoPrevious: children-array contract', () => {
	it('mutates the caller-owned children copy, not a hidden internal array', () => {
		const doc = parse('- alpha\n- beta\n- gamma\n');
		const list = doc.children[0];
		expect(list.kind).toBe('list');

		const childrenCopy = list.children!.slice();
		const originalLength = childrenCopy.length;

		const result = mergeListItemIntoPrevious(list, childrenCopy, 2, undefined, fixtureReading());
		if (!result) throw new Error('expected a merge target');

		expect(childrenCopy.length).toBe(originalLength - 1);

		expect(result.mergePoint.targetPath).toEqual([1, 0]);
		expect(result.mergePoint.offset).toBe('beta'.length);
	});
});

/** Merges the list's second item into its first and returns the document's bytes. */
function mergeSecondItem(source: string) {
	const doc = parse(source);
	const list = doc.children[0];
	const result = mergeListItemIntoPrevious(
		list,
		list.children!.slice(),
		1,
		undefined,
		fixtureReading()
	);
	return { doc, list, result, source: serialize(doc) };
}

// Miss-analysis: every M1 fixture's previous item ended in a paragraph, so no test reached the
// heading leaf the target walk also stops at.
describe('mergeListItemIntoPrevious: a heading target joins', () => {
	it.each([
		['an ATX heading', '- # Plan\n- next\n', '- # Plannext\n'],
		[
			'a setext heading, keeping the underline under the title',
			'- Plan\n  ===\n- next\n',
			'- Plannext\n  ===\n'
		]
	])('%s', (_name, before, after) => {
		const { doc, result, source } = mergeSecondItem(before);

		expect(result).not.toBeNull();
		expect(source).toBe(after);
		expectParseConverged(doc);
	});
});

// Miss-analysis: M1 wrote the joined bytes onto the paragraph without a reparse, and no fixture
// joined two halves that together read as another kind.
describe('mergeListItemIntoPrevious: a join that completes another kind re-kinds the leaf', () => {
	it('two backticks joined to a backtick and text become a code fence', () => {
		const { doc, list, source } = mergeSecondItem('- ``\n- `x\n');

		expect(source).toBe('- ```x\n');
		expectParseConverged(doc);
		expect(checkStaleRaw(list, fixtureGrammar)).toBeNull();
	});
});

// Miss-analysis: no M1 fixture held a task marker on either side of the join, so dropping the
// task reconcile from the join left every test green.
describe('mergeListItemIntoPrevious: the task marker follows the joined first block', () => {
	it('a join that spells a task marker makes the item a task', () => {
		const { doc, list, source } = mergeSecondItem('- [ \n- ] x\n');

		const item = list.children![0];
		expect(source).toBe('- [ ] x\n');
		expect(metadataOf(item, 'listItem')?.taskItem).toBe(true);
		expect(item.children![0].raw).toBe('x\n');
		expectParseConverged(doc);
		expect(checkStaleRaw(list, fixtureGrammar)).toBeNull();
	});

	it('a join that re-kinds a task item’s paragraph gives up the task marker', () => {
		const { doc, list, source } = mergeSecondItem('- [ ] a\n- |b\n  |-|-|\n');

		expect(source).toBe('- a|b\n  |-|-|\n');
		expect(list.children![0].children![0].kind).toBe('table');
		expect(metadataOf(list.children![0], 'listItem')?.taskItem).toBe(false);
		expectParseConverged(doc);
	});
});

// Miss-analysis: the M1 tests only ever joined, so turning a refusal back into the throw that
// #470 shipped as an unhandled rejection left every test green.
describe('mergeListItemIntoPrevious: nothing to join returns null and writes nothing', () => {
	it.each([
		['a join that reads as two blocks', '- # h\n- text\n  more\n'],
		['an item that does not open with a paragraph', '- a\n- # h\n']
	])('%s', (_name, before) => {
		const { result, source } = mergeSecondItem(before);

		expect(result).toBeNull();
		expect(source).toBe(before);
	});
});
