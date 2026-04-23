import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { mergeListItemIntoPrevious } from '../../tree-operations';
import type { CstNode } from '../../core/nodes';

// Backspace-at-start-of-list-item merge semantics: flat merges, nested-sublist
// absorption, preserve-absolute-indent for deep targets, loose items, ordered
// renumbering, and the itemIndex=0 guard. Worked examples mirror the table in
// e2e/requirements/blocks/list/backspace.md.

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
		// Merging D into the deepest target (C) must preserve E at its original
		// absolute depth 1, not deepen it to match C's depth 2.
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
