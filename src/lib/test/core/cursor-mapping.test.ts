import { describe, it, expect } from 'vitest';
import { findNodeAtOffset } from '../../core/inline-render';
import type { InlineNode } from '../../core/nodes';

describe('findNodeAtOffset', () => {
	it('finds text node containing offset', () => {
		const nodes: InlineNode[] = [
			{ kind: 'text', start: 0, end: 6, text: 'Hello ' },
			{ kind: 'inlineCode', start: 6, end: 12, text: 'code' },
			{ kind: 'text', start: 12, end: 18, text: ' world' }
		];
		const result = findNodeAtOffset(nodes, 3);
		expect(result).toEqual({ node: nodes[0], localOffset: 3 });
	});

	it('finds offset inside inline code opening marker', () => {
		const nodes: InlineNode[] = [
			{ kind: 'text', start: 0, end: 6, text: 'Hello ' },
			{ kind: 'inlineCode', start: 6, end: 12, text: 'code' }
		];
		const result = findNodeAtOffset(nodes, 6);
		expect(result).toEqual({ node: nodes[1], localOffset: 0 });
	});

	it('finds offset at boundary — prefers right node', () => {
		const nodes: InlineNode[] = [
			{ kind: 'inlineCode', start: 0, end: 6, text: 'code' },
			{ kind: 'text', start: 6, end: 12, text: ' world' }
		];
		const result = findNodeAtOffset(nodes, 6);
		expect(result).toEqual({ node: nodes[1], localOffset: 0 });
	});

	it('offset at end of all nodes', () => {
		const nodes: InlineNode[] = [{ kind: 'text', start: 0, end: 5, text: 'Hello' }];
		const result = findNodeAtOffset(nodes, 5);
		expect(result).toEqual({ node: nodes[0], localOffset: 5 });
	});

	it('handles nested emphasis children', () => {
		const inner: InlineNode = { kind: 'text', start: 2, end: 6, text: 'bold' };
		const nodes: InlineNode[] = [{ kind: 'strong', start: 0, end: 8, children: [inner] }];
		const result = findNodeAtOffset(nodes, 4);
		expect(result).toEqual({ node: inner, localOffset: 2 });
	});
});
