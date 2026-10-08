import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { mergeListItemIntoPrevious } from '#lib/test/harness/list-merge.js';
import { checkStaleRaw } from '#lib/invariants/node-shape.js';
import { metadataOf } from '#lib/core/nodes.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { fixtureGrammar, fixtureReading } from '../../harness/fixture-grammar';
import { createSharingState } from '#lib/tree-operations/sharing.js';

describe('mergeListItemIntoPrevious: children-array contract', () => {
	it('mutates the caller-owned children copy, not a hidden internal array', () => {
		const doc = parse('- alpha\n- beta\n- gamma\n');
		const list = doc.children[0];
		expect(list.kind).toBe('list');

		const childrenCopy = list.children!.slice();
		const originalLength = childrenCopy.length;

		const result = mergeListItemIntoPrevious(
			list,
			childrenCopy,
			2,
			createSharingState(),
			fixtureReading()
		);
		if (!result) throw new Error('expected a merge target');

		expect(childrenCopy.length).toBe(originalLength - 1);

		expect(result.mergePoint.targetPath).toEqual([1, 0]);
		expect(result.mergePoint.offset).toBe('beta'.length);
	});
});

function mergeSecondItem(source: string) {
	const doc = parse(source);
	const list = doc.children[0];
	const result = mergeListItemIntoPrevious(
		list,
		list.children!.slice(),
		1,
		createSharingState(),
		fixtureReading()
	);
	return { doc, list, result, source: serialize(doc) };
}

// Miss-analysis: every merge fixture's previous item ended in a paragraph, never a heading.
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

// Miss-analysis: no merge fixture joined two halves that together read as another kind.
describe('mergeListItemIntoPrevious: a join that completes another kind re-kinds the leaf', () => {
	it('two backticks joined to a backtick and text become a code fence', () => {
		const { doc, list, source } = mergeSecondItem('- ``\n- `x\n');

		expect(source).toBe('- ```x\n');
		expectParseConverged(doc);
		expect(checkStaleRaw(list, fixtureGrammar)).toBeNull();
	});
});

// Miss-analysis: no merge fixture held a task marker on either side of the join.
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

// Miss-analysis: the merge tests only ever joined, so a refusal thrown instead of returned passed.
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
