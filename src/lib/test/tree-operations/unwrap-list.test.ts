import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { unwrapFirstItemFromList } from '../../tree-operations';
import { assertContainerParity, seedChildIdsRecursive } from '../harness/container-parity';
import type { CstNode } from '../../core/nodes';

describe('unwrapFirstItemFromList', () => {
	function parseList(src: string): CstNode {
		const doc = parse(src);
		const list = doc.children[0];
		if (list?.kind !== 'list') {
			throw new Error(`expected list, got ${list?.kind}`);
		}
		return list;
	}

	it('single-item list with paragraph only: returns just the lifted paragraph', () => {
		const list = parseList('- Only item\n');

		const result = unwrapFirstItemFromList(list);

		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('Only item');
	});

	it('multi-item list: lifts first paragraph, shrinks the list', () => {
		const list = parseList('- First\n- Second\n- Third\n');

		const result = unwrapFirstItemFromList(list);

		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('First');
		expect(result[1].kind).toBe('list');
		expect(result[1].children?.length).toBe(2);
		const remainingRaw = result[1].raw ?? '';
		expect(remainingRaw).toContain('Second');
		expect(remainingRaw).toContain('Third');
		expect(remainingRaw).not.toContain('First');
	});

	it('first item with matching-type nested sub-list: items promote to shrunk parent list', () => {
		const list = parseList('- First\n  - Nested\n- Second\n');

		const result = unwrapFirstItemFromList(list);

		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('First');
		expect(result[1].kind).toBe('list');

		const remaining = result[1];
		expect(remaining.children?.length).toBe(2);
		const firstItemRaw = remaining.children?.[0].raw ?? '';
		const secondItemRaw = remaining.children?.[1].raw ?? '';
		expect(firstItemRaw).toContain('Nested');
		expect(secondItemRaw).toContain('Second');
	});

	it('first item with mismatched-type nested sub-list: sub-list becomes separate block', () => {
		const list = parseList('- First\n  1. OrderedNested\n- Second\n');

		const result = unwrapFirstItemFromList(list);

		expect(result.length).toBeGreaterThanOrEqual(3);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('First');
		expect(result[1].kind).toBe('list');
		expect((result[1].metadata as { ordered: boolean }).ordered).toBe(true);
		expect(result[1].children?.[0].raw ?? '').toContain('OrderedNested');
		const remaining = result[result.length - 1];
		expect(remaining.kind).toBe('list');
		expect((remaining.metadata as { ordered: boolean }).ordered).toBe(false);
		expect(remaining.children?.[0].raw ?? '').toContain('Second');
	});

	it('single-item list whose only item has matching nested sub-list: remaining list is the promoted nested items', () => {
		const list = parseList('- Only\n  - Nested1\n  - Nested2\n');

		const result = unwrapFirstItemFromList(list);

		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('Only');
		expect(result[1].kind).toBe('list');
		expect(result[1].children?.length).toBe(2);
	});

	it('ordered list: remaining items renumber from the original base', () => {
		const list = parseList('1. First\n2. Second\n3. Third\n');

		const result = unwrapFirstItemFromList(list);

		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('First');
		expect(result[1].kind).toBe('list');
		const remaining = result[1];
		const secondMarker = (remaining.children?.[0].metadata as { marker: string }).marker;
		const thirdMarker = (remaining.children?.[1].metadata as { marker: string }).marker;
		expect(secondMarker).toMatch(/^1\./);
		expect(thirdMarker).toMatch(/^2\./);
	});

	it('loose item (multiple paragraphs): all paragraphs flow out in order', () => {
		const list = parseList('- First\n\n  More text\n- Second\n');

		const result = unwrapFirstItemFromList(list);

		expect(result.length).toBeGreaterThanOrEqual(3);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('First');
		expect(result[1].kind).toBe('paragraph');
		expect((result[1].raw ?? '').trim()).toBe('More text');
		const remaining = result[result.length - 1];
		expect(remaining.kind).toBe('list');
		expect(remaining.children?.[0].raw ?? '').toContain('Second');
	});

	// Miss-analysis: the empty-first-item branch had no case of its own, and children/childIds
	// parity was asserted for M1 only.
	it('empty first item: each surviving item keeps its own id in the shrunk list', () => {
		const list = parseList('- Empty\n- Second\n- Third\n');
		list.children![0].children = [];
		seedChildIdsRecursive(list);
		const secondId = list.childIds![1];

		const result = unwrapFirstItemFromList(list);

		expect(result).toHaveLength(1);
		assertContainerParity(result[0]);
		expect(result[0].childIds![0]).toBe(secondId);
	});

	it('input list is not mutated', () => {
		const list = parseList('- First\n  - Nested\n- Second\n');
		const before = serialize({
			children: [list],
			prefix: '',
			suffix: ''
		});

		unwrapFirstItemFromList(list);

		const after = serialize({
			children: [list],
			prefix: '',
			suffix: ''
		});
		expect(after).toBe(before);
	});
});
