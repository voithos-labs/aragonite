import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { buildExitReplacement } from '../../tree-operations';
import { expectParseConverged } from '../harness/parse-converged';
import type { CstNode } from '../../core/nodes';

// ── Helpers ────────────────────────────────────────────────────────────────

function parseListDoc(src: string) {
	const doc = parse(src);
	const list = doc.children[0];
	if (list?.kind !== 'list') {
		throw new Error(`expected list, got ${list?.kind}`);
	}
	return { doc, list };
}

const parseList = (src: string): CstNode => parseListDoc(src).list;

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

	// The exit slot does not burn a number, from base 1 or any preserved starting number.
	it.each([1, 5])('ordered middle exit from base %i continues the sequence', (base) => {
		const list = parseList(`${base}. a\n${base + 1}. b\n${base + 2}. c\n${base + 3}. d\n`);
		blankFirstParagraph(list.children![2]);

		const { blocks } = buildExitReplacement(list, 2);

		expect(blocks).toHaveLength(3);
		const markerOf = (half: CstNode, i: number) =>
			(half.children?.[i].metadata as { marker: string }).marker;
		expect(markerOf(blocks[0], 0)).toMatch(new RegExp(`^${base}\\.`));
		expect(markerOf(blocks[0], 1)).toMatch(new RegExp(`^${base + 1}\\.`));
		expect(markerOf(blocks[2], 0)).toMatch(new RegExp(`^${base + 2}\\.`));
	});

	it('input list is not mutated', () => {
		const list = parseList('- A\n- B\n- C\n');
		const before = serialize({ children: [list], prefix: '', suffix: '' });

		buildExitReplacement(list, 1);

		const after = serialize({ children: [list], prefix: '', suffix: '' });
		expect(after).toBe(before);
	});
});

// Without a blank line the parser lazy-continues the exit paragraph into the list's last
// item on reload, so the live tree diverges from its own serialization. The exit
// paragraph owns the separator.
describe('buildExitReplacement blank-line separator (parse convergence)', () => {
	it('last-item exit: a typed line after the surviving list stays a separate paragraph', () => {
		const { doc, list } = parseListDoc('- First\n- Last\n');
		blankFirstParagraph(list.children![1]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 1);
		doc.children.splice(0, 1, ...blocks);
		doc.children[paragraphIndex].raw = 'trailing text\n';

		expect(serialize(doc)).toBe('- First\n\ntrailing text\n');
		expectParseConverged(doc);
	});

	it('middle exit: the paragraph between the two list halves converges when typed into', () => {
		const { doc, list } = parseListDoc('- A\n- B\n- C\n');
		blankFirstParagraph(list.children![1]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 1);
		doc.children.splice(0, 1, ...blocks);
		doc.children[paragraphIndex].raw = 'between\n';

		expectParseConverged(doc);
	});

	it('first-item exit keeps the paragraph at the front without a leading separator', () => {
		const { list } = parseListDoc('- First\n- Second\n');
		blankFirstParagraph(list.children![0]);

		const { blocks, paragraphIndex } = buildExitReplacement(list, 0);
		expect(paragraphIndex).toBe(0);
		expect(blocks[0].leadingTrivia).toBe('');
	});
});
