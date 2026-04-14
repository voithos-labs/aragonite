import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serializeMutable } from '../mutable-tree';
import {
    unwrapFirstChildFromBlockquote,
    unwrapFirstItemFromList,
    mergeListItemIntoPrevious
} from '../tree-operations';
import type { CstNode } from '../core/nodes';

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
        // Input not mutated
        expect(JSON.stringify(bq)).toBe(snapshot);
    });

    it('multi-paragraph blockquote returns lifted paragraph + shrunk blockquote', () => {
        const bq = parseBlockquote('> First\n>\n> Second\n');

        const result = unwrapFirstChildFromBlockquote(bq);

        expect(result).toHaveLength(2);
        expect(result[0].kind).toBe('paragraph');
        expect((result[0].raw ?? '').trim()).toBe('First');
        expect(result[1].kind).toBe('blockquote');
        // The remaining blockquote still serializes with its prefix.
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
        const before = serializeMutable({
            children: [bq],
            prefix: '',
            suffix: ''
        });

        unwrapFirstChildFromBlockquote(bq);

        const after = serializeMutable({
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

        // Lifted: paragraph "First"
        // Remaining list: [Nested, Second] (both at top level of the shrunk list)
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

        // Lifted: paragraph "First", then the mismatched sub-list, then the shrunk parent list
        expect(result.length).toBeGreaterThanOrEqual(3);
        expect(result[0].kind).toBe('paragraph');
        expect((result[0].raw ?? '').trim()).toBe('First');
        expect(result[1].kind).toBe('list');
        // The mismatched (ordered) sub-list
        expect((result[1].metadata as { ordered: boolean }).ordered).toBe(true);
        expect((result[1].children?.[0].raw ?? '')).toContain('OrderedNested');
        // The remaining (unordered) parent list
        const remaining = result[result.length - 1];
        expect(remaining.kind).toBe('list');
        expect((remaining.metadata as { ordered: boolean }).ordered).toBe(false);
        expect((remaining.children?.[0].raw ?? '')).toContain('Second');
    });

    it('single-item list whose only item has matching nested sub-list: remaining list is the promoted nested items', () => {
        const list = parseList('- Only\n  - Nested1\n  - Nested2\n');

        const result = unwrapFirstItemFromList(list);

        // Lifted: paragraph "Only"
        // Remaining list: [Nested1, Nested2]
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
        // After unwrap: [Second, Third] should be renumbered 1, 2
        const secondMarker = (remaining.children?.[0].metadata as { marker: string }).marker;
        const thirdMarker = (remaining.children?.[1].metadata as { marker: string }).marker;
        expect(secondMarker).toMatch(/^1\./);
        expect(thirdMarker).toMatch(/^2\./);
    });

    it('loose item (multiple paragraphs): all paragraphs flow out in order', () => {
        const list = parseList('- First\n\n  More text\n- Second\n');

        const result = unwrapFirstItemFromList(list);

        // First paragraph + additional paragraph + remaining list
        expect(result.length).toBeGreaterThanOrEqual(3);
        expect(result[0].kind).toBe('paragraph');
        expect((result[0].raw ?? '').trim()).toBe('First');
        expect(result[1].kind).toBe('paragraph');
        expect((result[1].raw ?? '').trim()).toBe('More text');
        const remaining = result[result.length - 1];
        expect(remaining.kind).toBe('list');
        expect((remaining.children?.[0].raw ?? '')).toContain('Second');
    });

    it('input list is not mutated', () => {
        const list = parseList('- First\n  - Nested\n- Second\n');
        const before = serializeMutable({
            children: [list],
            prefix: '',
            suffix: ''
        });

        unwrapFirstItemFromList(list);

        const after = serializeMutable({
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

        const { mergePoint } = mergeListItemIntoPrevious(list, 1);

        expect(list.children?.length).toBe(1);
        const mergedRaw = list.children?.[0].raw ?? '';
        expect(mergedRaw).toContain('AB');
        // Target path should be [0] (first item in list), offset = length of "A"
        expect(mergePoint.targetPath).toEqual([0]);
        expect(mergePoint.offset).toBe('A'.length);
    });

    it('row 2: current item has nested sub-list; it nests under target item (absorb)', () => {
        const list = parseList('- A\n- B\n  - C\n');

        const { mergePoint } = mergeListItemIntoPrevious(list, 1);

        // Result: [- AB\n  - C\n]
        expect(list.children?.length).toBe(1);
        const mergedItem = list.children?.[0];
        // First child is paragraph with merged text
        expect(mergedItem?.children?.[0].kind).toBe('paragraph');
        expect((mergedItem?.children?.[0].raw ?? '').trim()).toBe('AB');
        // Second child is the absorbed nested list containing C
        expect(mergedItem?.children?.[1].kind).toBe('list');
        expect((mergedItem?.children?.[1].children?.[0].raw ?? '')).toContain('C');
        // Target: [0] (first item), offset = length of "A"
        expect(mergePoint.targetPath).toEqual([0]);
        expect(mergePoint.offset).toBe('A'.length);
    });

    it('row 3: target is nested inside previous item; merged text appends to nested paragraph; current\'s nested children become sibling of target', () => {
        const list = parseList('- A\n  - AA\n- B\n  - C\n');

        const { mergePoint } = mergeListItemIntoPrevious(list, 1);

        // Result: [- A\n  - AAB\n  - C\n]
        expect(list.children?.length).toBe(1);
        const parentItem = list.children?.[0];
        // Parent item's first child is paragraph "A"
        expect((parentItem?.children?.[0].raw ?? '').trim()).toBe('A');
        // Parent item's second child is the nested list containing [AAB, C]
        const nestedList = parentItem?.children?.[1];
        expect(nestedList?.kind).toBe('list');
        expect(nestedList?.children?.length).toBe(2);
        // First nested item: "AAB"
        expect((nestedList?.children?.[0].children?.[0].raw ?? '').trim()).toBe('AAB');
        // Second nested item: "C" (moved from being B's child)
        expect((nestedList?.children?.[1].children?.[0].raw ?? '').trim()).toBe('C');
        // Target "AA" lives in A (index 0) → nestedList (index 1) → item AA (index 0).
        // Uniform path strips the trailing paragraph index: [0, 1, 0].
        // Offset is measured within AA's paragraph, before the appended text.
        expect(mergePoint.targetPath).toEqual([0, 1, 0]);
        expect(mergePoint.offset).toBe('AA'.length);
    });

    it('row 4: deep target (depth 2) — E stays at depth 1 (preserve-absolute-indent)', () => {
        // Input: - A / - B / - C / - D / - E
        // where B is nested in A, C is nested in B, E is nested in D.
        // This is the spec-mandated row 4 case: merging D into the deepest target (C)
        // should preserve E at its ORIGINAL absolute depth 1 (not deepen it to match C's depth 2).
        const list = parseList('- A\n  - B\n    - C\n- D\n  - E\n');

        const { mergePoint } = mergeListItemIntoPrevious(list, 1);

        // Result:
        //   - A
        //     - B
        //       - CD
        //     - E   ← E is at depth 1 alongside B, not under CD at depth 2
        expect(list.children?.length).toBe(1);
        const aItem = list.children?.[0];
        // A's nested list has [B, E]
        const depth1List = aItem?.children?.find((c) => c.kind === 'list');
        expect(depth1List?.children?.length).toBe(2);
        // First: B (with its nested list containing CD)
        const bItem = depth1List?.children?.[0];
        const depth2List = bItem?.children?.find((c) => c.kind === 'list');
        expect(
            (depth2List?.children?.[0]?.children?.[0]?.raw ?? '').trim()
        ).toBe('CD');
        // Second: E (at depth 1 as sibling of B)
        expect(
            (depth1List?.children?.[1]?.children?.[0]?.raw ?? '').trim()
        ).toBe('E');
        // Uniform path with trailing paragraph index stripped before return:
        // [0 (A) → 1 (nestedList in A) → 0 (B) → 1 (nestedList in B) → 0 (C)]
        expect(mergePoint.targetPath).toEqual([0, 1, 0, 1, 0]);
        expect(mergePoint.offset).toBe('C'.length);
    });

    it('row 5: current has non-listItem extra paragraph; absorbed into target item children', () => {
        // Loose item: B has two paragraphs (paragraph "B" and paragraph "extra")
        const list = parseList('- A\n- B\n\n  extra\n');

        const { mergePoint } = mergeListItemIntoPrevious(list, 1);

        // Result: [- AB\n\n  extra\n] — the "extra" paragraph is absorbed as
        // the second child of the target item, after the merged paragraph.
        expect(list.children?.length).toBe(1);
        const target = list.children?.[0];
        expect((target?.children?.[0].raw ?? '').trim()).toBe('AB');
        expect((target?.children?.[1]?.raw ?? '').trim()).toBe('extra');
        expect(mergePoint.targetPath).toEqual([0]);
        expect(mergePoint.offset).toBe('A'.length);
    });

    it('ordered list: remaining items renumber after the merged item is deleted', () => {
        const list = parseList('1. First\n2. Second\n3. Third\n');

        const { mergePoint } = mergeListItemIntoPrevious(list, 1);

        // Result: [1. FirstSecond\n2. Third\n]
        expect(list.children?.length).toBe(2);
        expect((list.children?.[0].children?.[0].raw ?? '').trim()).toBe('FirstSecond');
        const thirdMarker = (list.children?.[1].metadata as { marker: string }).marker;
        expect(thirdMarker).toMatch(/^2\./);
        expect(mergePoint.offset).toBe('First'.length);
    });

    it('itemIndex = 0 is rejected (caller\'s responsibility to handle)', () => {
        const list = parseList('- A\n- B\n');

        expect(() => mergeListItemIntoPrevious(list, 0)).toThrow();
    });
});
