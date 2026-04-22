import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import {
	unwrapFirstChildFromBlockquote,
	unwrapFirstItemFromList,
	mergeListItemIntoPrevious
} from '../../tree-operations';
import type { CstNode } from '../../core/nodes';

// ── unwrapFirstChildFromBlockquote ─────────────────────────────────────────

describe('unwrapFirstChildFromBlockquote', () => {
	function parseBlockquote(src: string): CstNode {
		const doc = parse(src);
		const bq = doc.children[0];
		if (bq?.kind !== 'blockquote') {
			throw new Error(`expected blockquote, got ${bq?.kind}`);
		}
		return bq;
	}

	it('single-paragraph blockquote returns just the lifted paragraph', () => {
		const bq = parseBlockquote('> Hello world\n');
		const snapshot = JSON.stringify(bq);

		const result = unwrapFirstChildFromBlockquote(bq);

		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('Hello world');
		expect(JSON.stringify(bq)).toBe(snapshot);
	});

	it('multi-paragraph blockquote returns lifted paragraph + shrunk blockquote', () => {
		const bq = parseBlockquote('> First\n>\n> Second\n');

		const result = unwrapFirstChildFromBlockquote(bq);

		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('First');
		expect(result[1].kind).toBe('blockquote');
		const remainingRaw = result[1].raw ?? '';
		expect(remainingRaw).toMatch(/^> /m);
		expect(remainingRaw).toContain('Second');
		expect(remainingRaw).not.toContain('First');
	});

	it('blockquote whose first child is itself a blockquote lifts the inner blockquote', () => {
		const bq = parseBlockquote('> > Deep\n');

		const result = unwrapFirstChildFromBlockquote(bq);

		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('blockquote');
		const innerRaw = result[0].raw ?? '';
		expect(innerRaw).toContain('Deep');
	});

	it('blockquote whose first child is a list lifts the list', () => {
		const bq = parseBlockquote('> - Item\n');

		const result = unwrapFirstChildFromBlockquote(bq);

		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('list');
	});

	it('input blockquote is not mutated', () => {
		const bq = parseBlockquote('> First\n>\n> Second\n');
		const before = serialize({
			children: [bq],
			prefix: '',
			suffix: ''
		});

		unwrapFirstChildFromBlockquote(bq);

		const after = serialize({
			children: [bq],
			prefix: '',
			suffix: ''
		});
		expect(after).toBe(before);
	});
});

// ── unwrapFirstItemFromList ────────────────────────────────────────────────

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

	it('single-item list, paragraph only: remaining list omitted entirely', () => {
		const list = parseList('- Solo\n');

		const result = unwrapFirstItemFromList(list);

		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('paragraph');
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

// ── mergeListItemIntoPrevious ──────────────────────────────────────────────

describe('mergeListItemIntoPrevious', () => {
	function parseList(src: string): CstNode {
		const doc = parse(src);
		const list = doc.children[0];
		if (list?.kind !== 'list') {
			throw new Error(`expected list, got ${list?.kind}`);
		}
		return list;
	}

	it('row 1: flat merge of two paragraphs', () => {
		const list = parseList('- A\n- B\n');

		const { mergePoint } = mergeListItemIntoPrevious(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(1);
		const mergedRaw = list.children?.[0].raw ?? '';
		expect(mergedRaw).toContain('AB');
		expect(mergePoint.targetPath).toEqual([0, 0]);
		expect(mergePoint.offset).toBe('A'.length);
	});

	it('row 2: current item has nested sub-list; it nests under target item (absorb)', () => {
		const list = parseList('- A\n- B\n  - C\n');

		const { mergePoint } = mergeListItemIntoPrevious(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(1);
		const mergedItem = list.children?.[0];
		expect(mergedItem?.children?.[0].kind).toBe('paragraph');
		expect((mergedItem?.children?.[0].raw ?? '').trim()).toBe('AB');
		expect(mergedItem?.children?.[1].kind).toBe('list');
		expect(mergedItem?.children?.[1].children?.[0].raw ?? '').toContain('C');
		expect(mergePoint.targetPath).toEqual([0, 0]);
		expect(mergePoint.offset).toBe('A'.length);
	});

	it("row 3: target is nested inside previous item; merged text appends to nested paragraph; current's nested children become sibling of target", () => {
		const list = parseList('- A\n  - AA\n- B\n  - C\n');

		const { mergePoint } = mergeListItemIntoPrevious(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(1);
		const parentItem = list.children?.[0];
		expect((parentItem?.children?.[0].raw ?? '').trim()).toBe('A');
		const nestedList = parentItem?.children?.[1];
		expect(nestedList?.kind).toBe('list');
		expect(nestedList?.children?.length).toBe(2);
		expect((nestedList?.children?.[0].children?.[0].raw ?? '').trim()).toBe('AAB');
		expect((nestedList?.children?.[1].children?.[0].raw ?? '').trim()).toBe('C');
		expect(mergePoint.targetPath).toEqual([0, 1, 0, 0]);
		expect(mergePoint.offset).toBe('AA'.length);
	});

	it('row 4: deep target (depth 2) — E stays at depth 1 (preserve-absolute-indent)', () => {
		// Spec row 4: merging D into the deepest target (C) must preserve E at
		// its original absolute depth 1, not deepen it to match C's depth 2.
		const list = parseList('- A\n  - B\n    - C\n- D\n  - E\n');

		const { mergePoint } = mergeListItemIntoPrevious(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(1);
		const aItem = list.children?.[0];
		const depth1List = aItem?.children?.find((c) => c.kind === 'list');
		expect(depth1List?.children?.length).toBe(2);
		const bItem = depth1List?.children?.[0];
		const depth2List = bItem?.children?.find((c) => c.kind === 'list');
		expect((depth2List?.children?.[0]?.children?.[0]?.raw ?? '').trim()).toBe('CD');
		expect((depth1List?.children?.[1]?.children?.[0]?.raw ?? '').trim()).toBe('E');
		expect(mergePoint.targetPath).toEqual([0, 1, 0, 1, 0, 0]);
		expect(mergePoint.offset).toBe('C'.length);
	});

	it('row 5: current has non-listItem extra paragraph; absorbed into target item children', () => {
		const list = parseList('- A\n- B\n\n  extra\n');

		const { mergePoint } = mergeListItemIntoPrevious(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(1);
		const target = list.children?.[0];
		expect((target?.children?.[0].raw ?? '').trim()).toBe('AB');
		expect((target?.children?.[1]?.raw ?? '').trim()).toBe('extra');
		expect(mergePoint.targetPath).toEqual([0, 0]);
		expect(mergePoint.offset).toBe('A'.length);
	});

	it('row 5b: target item is loose — trailing paragraph index is not 0', () => {
		// Regression: loose target has findDeepestVisibleTextTarget landing on
		// A.children[1]; a prior path-slice bug cascaded focus to A.children[0].
		const list = parseList('- A\n\n  extra\n- B\n');

		const { mergePoint } = mergeListItemIntoPrevious(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(1);
		const target = list.children?.[0];
		expect(target?.children?.length).toBe(2);
		expect((target?.children?.[0].raw ?? '').trim()).toBe('A');
		expect((target?.children?.[1].raw ?? '').trim()).toBe('extraB');
		expect(mergePoint.targetPath).toEqual([0, 1]);
		expect(mergePoint.offset).toBe('extra'.length);
	});

	it('ordered list: remaining items renumber after the merged item is deleted', () => {
		const list = parseList('1. First\n2. Second\n3. Third\n');

		const { mergePoint } = mergeListItemIntoPrevious(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(2);
		expect((list.children?.[0].children?.[0].raw ?? '').trim()).toBe('FirstSecond');
		const thirdMarker = (list.children?.[1].metadata as { marker: string }).marker;
		expect(thirdMarker).toMatch(/^2\./);
		expect(mergePoint.offset).toBe('First'.length);
	});

	it("itemIndex = 0 is rejected (caller's responsibility to handle)", () => {
		const list = parseList('- A\n- B\n');

		expect(() => mergeListItemIntoPrevious(list, list.children!.slice(), 0)).toThrow();
	});
});
