import { describe, it, expect } from 'vitest';
import { parse, MAX_NESTING_DEPTH } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import type { CstNode } from '../../../core/nodes';

// Container nesting recurses one `parseBlocks` per level. Past MAX_NESTING_DEPTH
// the parser folds the rest into paragraph content instead of overflowing the
// call stack — byte-preserving, since only a top-level node's raw is serialized.

function blockquoteChainDepth(doc: ReturnType<typeof parse>): number {
	let node: CstNode | undefined = doc.children[0];
	let depth = 0;
	while (node && node.kind === 'blockquote') {
		depth++;
		node = node.children?.[0];
	}
	return depth;
}

describe('container nesting depth cap (ADV-1)', () => {
	it('a blockquote flood far past the cap parses without throwing and round-trips', () => {
		const source = '>'.repeat(5000) + ' x\n';
		let doc!: ReturnType<typeof parse>;
		expect(() => {
			doc = parse(source);
		}).not.toThrow();
		expect(serialize(doc)).toBe(source);
	});

	it('a nested-list flood far past the cap parses without throwing and round-trips', () => {
		const source =
			Array.from({ length: 700 }, (_, i) => ' '.repeat(2 * i) + '- x').join('\n') + '\n';
		let doc!: ReturnType<typeof parse>;
		expect(() => {
			doc = parse(source);
		}).not.toThrow();
		expect(serialize(doc)).toBe(source);
	}, 30_000);

	it('nesting just under the cap builds the full container chain', () => {
		const depth = MAX_NESTING_DEPTH - 1;
		const source = '>'.repeat(depth) + ' x\n';
		const doc = parse(source);
		expect(blockquoteChainDepth(doc)).toBe(depth);
		expect(serialize(doc)).toBe(source);
	});

	it('nesting past the cap stops the chain at the cap, folding the rest into a paragraph', () => {
		const source = '>'.repeat(MAX_NESTING_DEPTH + 50) + ' x\n';
		const doc = parse(source);
		expect(blockquoteChainDepth(doc)).toBe(MAX_NESTING_DEPTH);
		let node = doc.children[0];
		for (let i = 1; i < MAX_NESTING_DEPTH; i++) node = node.children![0];
		expect(node.children?.[0]?.kind).toBe('paragraph');
		expect(serialize(doc)).toBe(source);
	});
});
