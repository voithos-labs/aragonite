import { describe, it, expect } from 'vitest';
import { cascadeCleanupEmptyAncestors } from '../../tree-operations/cleanup';
import type { CstNode, Document } from '../../core/nodes';

function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

function bq(children: CstNode[]): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
		children,
		innerPrefix: '',
		innerSuffix: ''
	};
}

function doc(children: CstNode[]): Document {
	return { kind: 'document', prefix: '', children, suffix: '' };
}

describe('cascadeCleanupEmptyAncestors', () => {
	it('removes an empty blockquote at the top level', () => {
		const d = doc([bq([]), para('x\n')]);
		cascadeCleanupEmptyAncestors(d, [0, 0], []);
		expect(d.children).toHaveLength(1);
		expect(d.children[0].kind).toBe('paragraph');
	});

	it('leaves a non-empty blockquote alone', () => {
		// Blockquote originally had two paragraphs; child at [0, 0] was
		// deleted externally, leaving [0, 1] which is now [0, 0]. Cleanup
		// walks from the deleted path's parent ([0]) and sees a non-empty
		// container — no removal.
		const d = doc([bq([para('b\n')]), para('x\n')]);
		cascadeCleanupEmptyAncestors(d, [0, 0], []);
		expect(d.children).toHaveLength(2);
		expect(d.children[0].children).toHaveLength(1);
	});

	it('cascades through nested empty containers', () => {
		// Outer blockquote contains an inner blockquote containing one paragraph.
		// Pretend the paragraph has been deleted already — its path was [0, 0, 0].
		// Passing the deleted path, we expect the inner and outer blockquote
		// to both cascade-clean because both are now empty.
		const d = doc([bq([bq([])])]);
		cascadeCleanupEmptyAncestors(d, [0, 0, 0], []);
		expect(d.children).toHaveLength(0);
	});

	it('stops walking at the lca', () => {
		// Document has a blockquote and a sibling paragraph. Blockquote is empty.
		// Passing lca = [] means cleanup can reach the top level; passing lca = [0]
		// means cleanup stops before removing the top-level blockquote.
		const d1 = doc([bq([]), para('x\n')]);
		cascadeCleanupEmptyAncestors(d1, [0, 0], [0]);
		// [0] is the lca; we stop before removing it.
		expect(d1.children).toHaveLength(2);
	});
});
