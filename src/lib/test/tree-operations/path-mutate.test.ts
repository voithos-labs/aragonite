import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { assignIds } from '../../block-id';
import { deleteAtPath, replaceAtPath } from '../../tree-operations/path-mutate';
import type { CstNode } from '../../core/nodes';

// `createBlockListState` backfills only an ABSENT `childIds` array, never a short one, so
// a hand-rolled splice at depth desyncs the keyed-each source permanently.
function quoteWithIds(source: string): CstNode {
	const quote = parse(source).children[0];
	quote.childIds = assignIds(quote.children!);
	return quote;
}

describe('deleteAtPath', () => {
	it('keeps childIds in lockstep with the container it deletes from', () => {
		const doc = parse('> a\n>\n> b\n');
		const quote = doc.children[0];
		quote.childIds = assignIds(quote.children!);
		const survivingId = quote.childIds[1];

		deleteAtPath(doc, [0, 0]);

		expect(quote.children).toHaveLength(1);
		expect(quote.childIds).toEqual([survivingId]);
	});

	it('splices a top-level child whose parent carries no childIds', () => {
		const doc = parse('a\n\nb\n');
		deleteAtPath(doc, [0]);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].raw).toBe('b\n');
	});
});

describe('replaceAtPath', () => {
	it('keeps childIds in lockstep when a replacement changes the child count', () => {
		const doc = parse('> a\n');
		const quote = doc.children[0];
		quote.childIds = assignIds(quote.children!);
		const replacement = parse('x\n\ny\n').children;

		replaceAtPath(doc, [0, 0], replacement);

		expect(quote.children).toHaveLength(2);
		expect(quote.childIds).toHaveLength(2);
	});

	it('leaves the trailing siblings ids untouched', () => {
		const quote = quoteWithIds('> a\n>\n> b\n');
		const doc = { kind: 'document' as const, prefix: '', children: [quote], suffix: '' };
		const trailingId = quote.childIds![1];

		replaceAtPath(doc, [0, 0], parse('x\n').children);

		expect(quote.childIds).toHaveLength(2);
		expect(quote.childIds![1]).toBe(trailingId);
	});
});
