import { describe, it, expect } from 'vitest';
import { checkCategoryFields } from '../../invariants/node-shape';
import { checkMergeRoleVocabulary } from '../../invariants/registry';
import { parse } from '../../core/parser';
import { ALL_BLOCK_KINDS, type CstNode } from '../../core/nodes';

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

	it('fires when a leaf carries a container structural field', () => {
		const node = leaf('hello\n');
		node.innerPrefix = '';
		expect(checkCategoryFields(node)?.detail).toEqual({
			kind: 'paragraph',
			field: 'innerPrefix'
		});
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

	it('accepts ownerEpoch on every kind', () => {
		for (const kind of ALL_BLOCK_KINDS) {
			const node: CstNode = { kind, leadingTrivia: '', raw: '', ownerEpoch: 0 } as CstNode;
			expect(checkCategoryFields(node)).toBeNull();
		}
	});
});

// The mergeRole vocabulary moved OFF the per-node check: it is a per-kind
// registration fact, so validating it once per committed node re-ran a constant
// on every commit and left a bad registration undetected until the first edit.
describe('G1.30 merge-role vocabulary', () => {
	it('accepts every legal role', () => {
		const legal = ['prose', 'prose-absorber', 'container', 'self-merge', 'not-mergeable'];
		expect(
			checkMergeRoleVocabulary(legal.map((mergeRole) => ({ kind: 'paragraph', mergeRole })))
		).toBeNull();
	});

	it('reports the offending kind and role', () => {
		const violation = checkMergeRoleVocabulary([
			{ kind: 'paragraph', mergeRole: 'prose' },
			{ kind: 'blockquote', mergeRole: 'absorbs-everything' }
		]);
		expect(violation?.code).toBe('merge-role-vocabulary');
		expect(violation?.message).toContain('blockquote');
		expect(violation?.message).toContain('absorbs-everything');
	});
});
