import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { buildExitReplacement } from '../../tree-operations';
import { expectParseConverged } from '../harness/parse-converged';
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

// Mirrors the shape produced when Enter is pressed on an item whose first paragraph is empty.
function blankFirstParagraph(item: CstNode): void {
	const first = item.children?.[0];
	if (!first || first.kind !== 'paragraph') {
		throw new Error('item must start with a paragraph');
	}
	first.raw = '\n';
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

	it('mismatched-type nested list lifts as a separate top-level block', () => {
		const list = parseList('- Item\n  1. NestedOrdered\n');
		const item = list.children![0];
		item.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: '\n' },
			...(item.children ?? []).slice(1)
		];

		const { blocks, paragraphIndex } = buildExitReplacement(list, 0);

		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('paragraph');
		expect(blocks[1].kind).toBe('list');
		expect((blocks[1].metadata as { ordered: boolean }).ordered).toBe(true);
		expect(blocks[1].children?.[0].raw ?? '').toContain('NestedOrdered');
		expect(paragraphIndex).toBe(0);
	});

	it('non-list trailing children lift as separate top-level blocks', () => {
		const list = parseList('- First\n\n  second\n');
		blankFirstParagraph(list.children![0]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 0);

		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('paragraph');
		expect((blocks[0].raw ?? '').trim()).toBe('');
		expect(blocks[1].kind).toBe('paragraph');
		expect((blocks[1].raw ?? '').trim()).toBe('second');
		expect(paragraphIndex).toBe(0);
	});

	it('matching-type nested list items merge into the surviving list as siblings', () => {
		const list = parseList('- Item\n  - Nested\n');
		const item = list.children![0];
		item.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: '\n' },
			...(item.children ?? []).slice(1)
		];

		const { blocks, paragraphIndex } = buildExitReplacement(list, 0);

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
		// Exit slot doesn't burn a number; "four" continues at 3.
		expect((secondHalf.children?.[0].metadata as { marker: string }).marker).toMatch(/^3\./);
	});

	it('ordered middle exit preserves a non-1 starting number across both halves', () => {
		const list = parseList('5. five\n6. six\n7. seven\n8. eight\n');
		blankFirstParagraph(list.children![2]);

		const { blocks } = buildExitReplacement(list, 2);

		expect(blocks).toHaveLength(3);
		const firstHalf = blocks[0];
		const secondHalf = blocks[2];
		// Surviving first half keeps the original base, not a reset to 1.
		expect((firstHalf.children?.[0].metadata as { marker: string }).marker).toMatch(/^5\./);
		expect((firstHalf.children?.[1].metadata as { marker: string }).marker).toMatch(/^6\./);
		// Exit slot doesn't burn a number; "eight" continues at 7.
		expect((secondHalf.children?.[0].metadata as { marker: string }).marker).toMatch(/^7\./);
	});

	it('input list is not mutated', () => {
		const list = parseList('- A\n- B\n- C\n');
		const before = serialize({ children: [list], prefix: '', suffix: '' });

		buildExitReplacement(list, 1);

		const after = serialize({ children: [list], prefix: '', suffix: '' });
		expect(after).toBe(before);
	});
});

// An exit paragraph that follows the surviving list half serializes directly
// after the list. Without a blank line the parser lazy-continues it into the
// list's last item on reload, so the live [list, paragraph] pair diverges from
// its own serialization once the paragraph is typed into. The exit paragraph
// owns the separator.
describe('buildExitReplacement blank-line separator (parse convergence)', () => {
	it('last-item exit: a typed line after the surviving list stays a separate paragraph', () => {
		const doc = parse('- First\n- Last\n');
		const list = doc.children[0];
		if (list.kind !== 'list') throw new Error('expected list');
		blankFirstParagraph(list.children![1]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 1);
		doc.children.splice(0, 1, ...blocks);
		doc.children[paragraphIndex].raw = 'trailing text\n';

		expect(serialize(doc)).toBe('- First\n\ntrailing text\n');
		expectParseConverged(doc);
	});

	it('middle exit: the paragraph between the two list halves converges when typed into', () => {
		const doc = parse('- A\n- B\n- C\n');
		const list = doc.children[0];
		if (list.kind !== 'list') throw new Error('expected list');
		blankFirstParagraph(list.children![1]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 1);
		doc.children.splice(0, 1, ...blocks);
		doc.children[paragraphIndex].raw = 'between\n';

		expectParseConverged(doc);
	});

	it('first-item exit keeps the paragraph at the front without a leading separator', () => {
		const doc = parse('- First\n- Second\n');
		const list = doc.children[0];
		if (list.kind !== 'list') throw new Error('expected list');
		blankFirstParagraph(list.children![0]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 0);
		expect(paragraphIndex).toBe(0);
		expect(blocks[0].leadingTrivia).toBe('');
	});
});
