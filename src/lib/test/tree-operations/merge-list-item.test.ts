import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { mergeListItemIntoPrevious } from '../../tree-operations';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { __resetPasteSurfacesForTests } from '../../tree-operations/paste-surfaces';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import type { CstNode } from '../../core/nodes';

// Backspace-at-start-of-list-item merge semantics. The worked examples mirror the table
// in e2e/requirements/blocks/list/backspace.md.

describe('mergeListItemIntoPrevious', () => {
	function parseList(src: string): CstNode {
		const doc = parse(src);
		const list = doc.children[0];
		if (list?.kind !== 'list') {
			throw new Error(`expected list, got ${list?.kind}`);
		}
		return list;
	}

	// Every worked-example row reaches a text-bearing target; the null path has its own case.
	function mergeExpectingTarget(list: CstNode, children: CstNode[], currentIndex: number) {
		const result = mergeListItemIntoPrevious(list, children, currentIndex);
		if (!result) throw new Error('expected a merge target');
		return result;
	}

	it('row 1: flat merge of two paragraphs', () => {
		const list = parseList('- A\n- B\n');

		const { mergePoint } = mergeExpectingTarget(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(1);
		const mergedRaw = list.children?.[0].raw ?? '';
		expect(mergedRaw).toContain('AB');
		expect(mergePoint.targetPath).toEqual([0, 0]);
		expect(mergePoint.offset).toBe('A'.length);
	});

	it('row 2: current item has nested sub-list; it nests under target item (absorb)', () => {
		const list = parseList('- A\n- B\n  - C\n');

		const { mergePoint } = mergeExpectingTarget(list, list.children!.slice(), 1);

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

		const { mergePoint } = mergeExpectingTarget(list, list.children!.slice(), 1);

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
		// E must keep its original absolute depth, not deepen to match the merge target's.
		const list = parseList('- A\n  - B\n    - C\n- D\n  - E\n');

		const { mergePoint } = mergeExpectingTarget(list, list.children!.slice(), 1);

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

		const { mergePoint } = mergeExpectingTarget(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(1);
		const target = list.children?.[0];
		expect((target?.children?.[0].raw ?? '').trim()).toBe('AB');
		expect((target?.children?.[1]?.raw ?? '').trim()).toBe('extra');
		expect(mergePoint.targetPath).toEqual([0, 0]);
		expect(mergePoint.offset).toBe('A'.length);
	});

	it('row 5b: target item is loose — trailing paragraph index is not 0', () => {
		// A loose target lands findDeepestVisibleTextTarget on A.children[1]; a path-slice bug
		// cascaded focus to A.children[0].
		const list = parseList('- A\n\n  extra\n- B\n');

		const { mergePoint } = mergeExpectingTarget(list, list.children!.slice(), 1);

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

		const { mergePoint } = mergeExpectingTarget(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(2);
		expect((list.children?.[0].children?.[0].raw ?? '').trim()).toBe('FirstSecond');
		const thirdMarker = (list.children?.[1].metadata as { marker: string }).marker;
		expect(thirdMarker).toMatch(/^2\./);
		expect(mergePoint.offset).toBe('First'.length);
	});

	it('ordered list: non-1 base is preserved across the merge', () => {
		const list = parseList('3. First\n4. Second\n5. Third\n');

		mergeListItemIntoPrevious(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(2);
		const markers = list.children!.map((i) => (i.metadata as { marker: string }).marker);
		expect(markers[0]).toMatch(/^3\./);
		expect(markers[1]).toMatch(/^4\./);
	});

	it('ordered list: non-1 base survives a 2-into-1 collapse', () => {
		const list = parseList('3. First\n4. Second\n');

		mergeListItemIntoPrevious(list, list.children!.slice(), 1);

		expect(list.children?.length).toBe(1);
		const soleMarker = (list.children?.[0].metadata as { marker: string }).marker;
		expect(soleMarker).toMatch(/^3\./);
	});

	it("itemIndex = 0 is rejected (caller's responsibility to handle)", () => {
		const list = parseList('- A\n- B\n');

		expect(() => mergeListItemIntoPrevious(list, list.children!.slice(), 0)).toThrow();
	});

	it('opaque previous leaf (fenced code): returns null without throwing or mutating', () => {
		// A not-mergeable previous item leaves the walker no text-bearing leaf: M1 must report
		// no-target for the caller's focus-move fallback, not throw inside the ceremony.
		const list = parseList('- ```\n  code\n  ```\n- text\n');
		const children = list.children!.slice();
		const before = children.length;

		const result = mergeListItemIntoPrevious(list, children, 1);

		expect(result).toBeNull();
		expect(children.length).toBe(before);
		expect(list.children?.length).toBe(before);
	});
});

// Isolated because the walker's collapse probe needs the details kind registered to read
// the summary chrome as opaque.
describe('mergeListItemIntoPrevious — collapsed container as previous leaf', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerDetailsKind();
	});

	it('previous item ends in a collapsed <details>: returns null without mutating', () => {
		// The collapsed details' only reachable leaf is its opaque summary chrome, so this
		// reaches the same no-target fallback as the fenced-code case.
		const list = parse(
			'- <details>\n  <summary>Sum</summary>\n\n  Hidden\n\n  </details>\n- text\n'
		).children[0];
		expect(list.children?.[0].children?.at(-1)?.kind).toBe('details');
		const children = list.children!.slice();
		const before = children.length;

		const result = mergeListItemIntoPrevious(list, children, 1);

		expect(result).toBeNull();
		expect(children.length).toBe(before);
		expect(list.children?.length).toBe(before);
	});
});
