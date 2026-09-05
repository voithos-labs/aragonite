import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { checkCategoryFields } from '../../invariants/node-shape';
import { checkMergeRoleVocabulary } from '../../invariants/registry';
import { MERGE_ROLES, isKnownMergeRole } from '../../schema/block-kind-descriptor';
import { parse } from '../../core/parser';
import { ALL_BLOCK_KINDS, type CstNode } from '../../core/nodes';

function leaf(source: string): CstNode {
	return parse(source).children[0];
}

// The only kinds that legally carry a non-empty `innerPrefix` are wrapped containers, and every
// one of them ships as a plugin.
beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

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

	// A blockquote and a list item open their body on the container's own first line, so no
	// parse can peel a blank into `innerPrefix` and a filled slot is bytes nobody typed.
	// Miss-analysis: the field-legality check read the container/leaf split only, so a slot
	// legal for the CATEGORY but impossible for the KIND had no predicate at all.
	it.each([
		['blockquote', () => leaf('> quoted\n')],
		['listItem', () => leaf('- item\n').children![0]]
	] as const)('fires when a wrap-less %s carries an innerPrefix', (kind, make) => {
		const node = make();
		expect(node.kind).toBe(kind);
		expect(node.innerPrefix).toBe('');

		node.innerPrefix = '\n';

		expect(checkCategoryFields(node)?.detail).toEqual({ kind, field: 'innerPrefix' });
	});

	// The other direction, or the predicate would just outlaw the slot: a chrome line above the
	// body is exactly what makes a peeled blank the wrap's.
	it('accepts an innerPrefix on a container whose body sits under a chrome line', () => {
		const admonition = leaf(':::note T\n\nbody\n\n:::\n');
		expect(admonition.innerPrefix).toBe('\n');
		expect(checkCategoryFields(admonition)).toBeNull();
	});

	it('accepts ownerEpoch on every kind', () => {
		for (const kind of ALL_BLOCK_KINDS) {
			const node: CstNode = { kind, leadingTrivia: '', raw: '', ownerEpoch: 0 } as CstNode;
			expect(checkCategoryFields(node)).toBeNull();
		}
	});
});

// mergeRole is a per-kind registration fact, so a per-node check re-runs a constant every
// commit and leaves a bad registration undetected until the first edit.
describe('G1.30 merge-role vocabulary', () => {
	// The declared vocabulary drives the check, so a sixth role added to the tuple is accepted
	// here without an edit — the drift this pins is a role the registration seam would reject.
	it('accepts every declared role', () => {
		expect(
			checkMergeRoleVocabulary(
				MERGE_ROLES.map((mergeRole) => ({ kind: 'paragraph', mergeRole })),
				isKnownMergeRole
			)
		).toBeNull();
	});

	it('reports the offending kind and role', () => {
		const violation = checkMergeRoleVocabulary(
			[
				{ kind: 'paragraph', mergeRole: 'prose' },
				{ kind: 'blockquote', mergeRole: 'absorbs-everything' }
			],
			isKnownMergeRole
		);
		expect(violation?.code).toBe('merge-role-vocabulary');
		expect(violation?.message).toContain('blockquote');
		expect(violation?.message).toContain('absorbs-everything');
	});
});
