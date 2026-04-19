import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { buildExitReplacement } from '../../tree-operations';
import type { CstNode } from '../../core/nodes';

// ── Helpers ────────────────────────────────────────────────────────────────

function parseList(src: string): CstNode {
	const doc = parse(src);
	const list = doc.children[0];
	if (list?.kind !== 'list') {
		throw new Error(`expected list, got ${list?.kind}`);
	}
	return list;
}

// Compose `exitedItem` synthetically from two raw fragments. Real callers reach
// this code via Enter on an item whose first paragraph is empty; we mirror
// that shape by parsing and surgically blanking the target's first paragraph.
function blankFirstParagraph(item: CstNode): void {
	const first = item.children?.[0];
	if (!first || first.kind !== 'paragraph') {
		throw new Error('item must start with a paragraph');
	}
	first.raw = '\n';
	first.inlineContent = undefined;
}

// ── buildExitReplacement ───────────────────────────────────────────────────

describe('buildExitReplacement', () => {
	it('only-item, no trailing children: replaces list with a single empty paragraph', () => {
		const list = parseList('- Only\n');
		blankFirstParagraph(list.children![0]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 0);

		expect(blocks).toHaveLength(1);
		expect(blocks[0].kind).toBe('paragraph');
		expect(paragraphIndex).toBe(0);
	});

	it('first item with siblings: paragraph above the surviving list', () => {
		const list = parseList('- First\n- Second\n');
		blankFirstParagraph(list.children![0]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 0);

		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('paragraph');
		expect(blocks[1].kind).toBe('list');
		expect(blocks[1].children?.[0].raw ?? '').toContain('Second');
		expect(paragraphIndex).toBe(0);
	});

	it('middle item: paragraph between the two list halves', () => {
		const list = parseList('- A\n- B\n- C\n');
		blankFirstParagraph(list.children![1]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 1);

		expect(blocks).toHaveLength(3);
		expect(blocks[0].kind).toBe('list');
		expect(blocks[0].children?.[0].raw ?? '').toContain('A');
		expect(blocks[1].kind).toBe('paragraph');
		expect(blocks[2].kind).toBe('list');
		expect(blocks[2].children?.[0].raw ?? '').toContain('C');
		expect(paragraphIndex).toBe(1);
	});

	it('last item: paragraph after the surviving list', () => {
		const list = parseList('- First\n- Last\n');
		blankFirstParagraph(list.children![1]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 1);

		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('list');
		expect(blocks[1].kind).toBe('paragraph');
		expect(paragraphIndex).toBe(1);
	});

	// Sub-case 1 of the original bug: mismatched-type nested list used to be
	// silently dropped. It must lift to top-level instead.
	it('mismatched-type nested list lifts as a separate top-level block', () => {
		const list = parseList('- Item\n  1. NestedOrdered\n');
		// Synthesize "user pressed Enter at end of Item, then Enter on the new
		// empty item carrying the ordered sub-list". The CST shape after first
		// Enter is what the parser produces if we strip "Item" out and split.
		const item = list.children![0];
		// Insert an empty paragraph at the front so it looks like an exited item.
		item.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: '\n' },
			...(item.children ?? []).slice(1)
		];

		const { blocks, paragraphIndex } = buildExitReplacement(list, 0);

		// [paragraph, ordered sub-list] — no surviving outer list (only-item).
		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('paragraph');
		expect(blocks[1].kind).toBe('list');
		expect((blocks[1].metadata as { ordered: boolean }).ordered).toBe(true);
		expect(blocks[1].children?.[0].raw ?? '').toContain('NestedOrdered');
		expect(paragraphIndex).toBe(0);
	});

	// Sub-case 2 of the original bug: extra paragraphs in a loose item used to
	// be silently dropped. They must lift to top-level instead.
	it('non-list trailing children lift as separate top-level blocks', () => {
		// Loose item: [paragraph "First", paragraph "second"]
		const list = parseList('- First\n\n  second\n');
		blankFirstParagraph(list.children![0]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 0);

		// [empty paragraph (exit), paragraph "second"]
		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('paragraph');
		expect((blocks[0].raw ?? '').trim()).toBe('');
		expect(blocks[1].kind).toBe('paragraph');
		expect((blocks[1].raw ?? '').trim()).toBe('second');
		expect(paragraphIndex).toBe(0);
	});

	it('matching-type nested list items merge into the surviving list as siblings', () => {
		const list = parseList('- Item\n  - Nested\n');
		// Same shape as the mismatched test, but the sub-list type matches the
		// parent. Synthesize the exited-item shape.
		const item = list.children![0];
		item.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: '\n' },
			...(item.children ?? []).slice(1)
		];

		const { blocks, paragraphIndex } = buildExitReplacement(list, 0);

		// wasFirstItem promotes into the second half (no first half exists).
		// Result: [paragraph, list[Nested]]
		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('paragraph');
		expect(blocks[1].kind).toBe('list');
		expect(blocks[1].children?.[0].raw ?? '').toContain('Nested');
		expect(paragraphIndex).toBe(0);
	});

	it('ordered middle exit: second half continues the sequence across the gap', () => {
		const list = parseList('1. one\n2. two\n3. three\n4. four\n');
		blankFirstParagraph(list.children![2]);

		const { blocks } = buildExitReplacement(list, 2);

		expect(blocks).toHaveLength(3);
		const firstHalf = blocks[0];
		const secondHalf = blocks[2];
		expect((firstHalf.children?.[0].metadata as { marker: string }).marker).toMatch(/^1\./);
		expect((firstHalf.children?.[1].metadata as { marker: string }).marker).toMatch(/^2\./);
		// "four" continues at 3 — the exit slot doesn't burn a number.
		expect((secondHalf.children?.[0].metadata as { marker: string }).marker).toMatch(/^3\./);
	});

	it('input list is not mutated', () => {
		const list = parseList('- A\n- B\n- C\n');
		const before = serialize({ children: [list], prefix: '', suffix: '' });

		buildExitReplacement(list, 1);

		const after = serialize({ children: [list], prefix: '', suffix: '' });
		expect(after).toBe(before);
	});
});
