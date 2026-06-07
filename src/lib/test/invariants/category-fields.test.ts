import { describe, it, expect } from 'vitest';
import { checkCategoryFields } from '../../invariants/node-shape';
import { parse } from '../../core/parser';
import type { CstNode } from '../../core/nodes';

function leaf(source: string): CstNode {
	return parse(source).children[0];
}

describe('checkCategoryFields (G1.5)', () => {
	it('fires when a leaf carries children', () => {
		const node = leaf('hello\n');
		node.children = [];
		const violation = checkCategoryFields(node);
		expect(violation?.code).toBe('illegal-fields-for-kind');
		expect(violation?.detail).toEqual({ kind: 'paragraph', field: 'children' });
	});

	it('fires when a non-prose kind carries inlineContent', () => {
		const node = leaf('---\n');
		node.inlineContent = [];
		const violation = checkCategoryFields(node);
		expect(violation?.detail).toEqual({ kind: 'thematicBreak', field: 'inlineContent' });
	});

	it('fires when a leaf carries a container structural field', () => {
		const node = leaf('hello\n');
		node.innerPrefix = '';
		expect(checkCategoryFields(node)?.detail).toEqual({
			kind: 'paragraph',
			field: 'innerPrefix'
		});
	});

	it('passes for a real prose leaf with inlineContent', () => {
		const node = leaf('hello *world*\n');
		node.inlineContent = [];
		expect(checkCategoryFields(node)).toBeNull();
	});

	it('passes for a real container with children', () => {
		const bq = leaf('> quoted\n');
		expect(checkCategoryFields(bq)).toBeNull();
	});

	it('passes for a transiently childless container', () => {
		const bq = leaf('> quoted\n');
		bq.children = [];
		expect(checkCategoryFields(bq)).toBeNull();
	});
});
