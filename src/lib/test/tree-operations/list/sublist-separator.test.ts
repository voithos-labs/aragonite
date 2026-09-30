import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { settleSublistSeparator } from '$lib/tree-operations/list/sublist-separator';
import { rebuildListItemRaw } from '$lib/schema/container-rebuilders';
import type { CstNode } from '$lib/core/nodes';

// The blank line a sublist needs wherever a paragraph above would swallow its first line, across
// every such line rather than the one shape the Enter+Tab test reaches.
// Miss-analysis: the parser's interrupt check was tested on source bytes, never on a written tree.

/** `[paragraph(text), sublist]` inside one item, as a nesting splice leaves it. */
function itemWithSublist(text: string, sublistSource: string): CstNode {
	const paragraph = parse(text).children[0];
	const sublist = parse(sublistSource).children[0];
	return {
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
		children: [paragraph, sublist]
	} as CstNode;
}

const separatorOf = (item: CstNode) => item.children![1].leadingTrivia;

describe('settleSublistSeparator', () => {
	it('creates a line for a sublist whose marker carries no content', () => {
		const item = itemWithSublist('x\n', '- \n');
		settleSublistSeparator(item.children!, 1);
		expect(separatorOf(item)).toBe('\n');

		rebuildListItemRaw(item);
		expect(item.raw).toBe('- x\n\n  - \n');
	});

	it('declines where the marker interrupts on its own', () => {
		const item = itemWithSublist('x\n', '- y\n');
		settleSublistSeparator(item.children!, 1);
		expect(separatorOf(item)).toBe('');
	});

	it('creates a line for every marker glyph, ordered included', () => {
		for (const sublist of ['* \n', '+ \n', '1. \n', '3) \n']) {
			const item = itemWithSublist('x\n', sublist);
			settleSublistSeparator(item.children!, 1);
			expect(separatorOf(item)).toBe('\n');
		}
	});

	// A sublist with content that can't interrupt is left to the neighbour merge, which keeps its
	// text, so the two rules split on emptiness rather than racing.
	it('declines for an ordered sublist that carries content', () => {
		const item = itemWithSublist('x\n', '2. y\n');
		settleSublistSeparator(item.children!, 1);
		expect(separatorOf(item)).toBe('');
	});

	it('takes the paragraph’s line ending', () => {
		const item = itemWithSublist('x\r\n', '- \r\n');
		settleSublistSeparator(item.children!, 1);
		expect(separatorOf(item)).toBe('\r\n');
	});

	it('declines below anything that leaves no paragraph open', () => {
		const item = itemWithSublist('# x\n', '- \n');
		settleSublistSeparator(item.children!, 1);
		expect(separatorOf(item)).toBe('');
	});

	it('declines at the head of the item, where no paragraph precedes it', () => {
		const children = [parse('- \n').children[0]];
		settleSublistSeparator(children, 0);
		expect(children[0].leadingTrivia).toBe('');
	});

	it('is idempotent and never doubles a standing line', () => {
		const item = itemWithSublist('x\n', '- \n');
		settleSublistSeparator(item.children!, 1);
		settleSublistSeparator(item.children!, 1);
		expect(separatorOf(item)).toBe('\n');
	});

	// The fixed-up bytes are what the reload reads back: the item holds a paragraph and a
	// one-item sublist, not the setext heading the unseparated bytes spell.
	it('leaves bytes that reparse to the tree they were written from', () => {
		const item = itemWithSublist('x\n', '- \n');
		settleSublistSeparator(item.children!, 1);
		rebuildListItemRaw(item);

		const reparsed = parse(item.raw).children[0].children![0];
		expect(reparsed.children!.map((c) => c.kind)).toEqual(['paragraph', 'list']);
		expect(serialize(parse(item.raw))).toBe(item.raw);
	});
});
