import { describe, it, expect } from 'vitest';
import { parse, MAX_NESTING_DEPTH } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import type { CstNode } from '../../../core/nodes';

// Container nesting recurses one `parseBlocks` per level, so past MAX_NESTING_DEPTH the
// parser folds the rest into paragraph content rather than overflowing the call stack.

function blockquoteChainDepth(doc: ReturnType<typeof parse>): number {
	let node: CstNode | undefined = doc.children[0];
	let depth = 0;
	while (node && node.kind === 'blockquote') {
		depth++;
		node = node.children?.[0];
	}
	return depth;
}

/** Lists nested through each item's first sublist, outermost first. */
function listChainDepth(doc: ReturnType<typeof parse>): number {
	let node: CstNode | undefined = doc.children[0];
	let depth = 0;
	while (node && node.kind === 'list') {
		depth++;
		node = node.children?.[0]?.children?.find((child) => child.kind === 'list');
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

	// Miss-analysis: the list floods checked only no-throw and round-trip, which hold whether or not
	// a list counts toward the cap.
	it('a nested-list flood past the cap stops the chain at the cap and round-trips', () => {
		const levels = MAX_NESTING_DEPTH + 10;
		const source =
			Array.from({ length: levels }, (_, i) => ' '.repeat(2 * i) + '- x').join('\n') + '\n';
		const doc = parse(source);
		expect(listChainDepth(doc)).toBe(MAX_NESTING_DEPTH);
		expect(serialize(doc)).toBe(source);
	});

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
