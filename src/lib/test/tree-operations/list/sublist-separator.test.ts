import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { settleSublistSeparator } from '$lib/tree-operations/list/sublist-separator';
import { rebuildListItemRaw } from '$lib/schema/container-rebuilders';
import type { CstNode } from '$lib/core/nodes';

// The predicate behind the Enter+Tab mint, at its own level: the gesture pin
// (`blocks/list/nested-mint-separator.test.ts`) reaches one shape, and the class is every
// sublist first line a paragraph above it would swallow.
//
// Miss-analysis: this rule had no home at all before the mint owed it one; the parser's
// interrupt predicate was tested against source bytes only, never against a tree being
// written toward those bytes.

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
	it('mints a line for a sublist whose marker carries no content', () => {
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

	it('mints a line for every marker glyph, ordered included', () => {
		for (const sublist of ['* \n', '+ \n', '1. \n', '3) \n']) {
			const item = itemWithSublist('x\n', sublist);
			settleSublistSeparator(item.children!, 1);
			expect(separatorOf(item)).toBe('\n');
		}
	});

	// The seam absorb owns a content-bearing list that stopped interrupting (GH #176): its text
	// survives the fold, so the two rules split on emptiness rather than racing.
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

	// The settled bytes are what the reload reads back: the item holds a paragraph and a
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
