import { describe, it, expect } from 'vitest';
import type { BlockKind } from '../../core/nodes';
import {
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor
} from '../../tree-operations/block-kind-descriptor';

// Every BlockKind in the type union must have a descriptor registered at
// module load. Callers (merge-rules, BlockHost) rely on non-optional lookups.
const ALL_KINDS: BlockKind[] = [
	'paragraph',
	'heading',
	'setextHeading',
	'fencedCode',
	'thematicBreak',
	'indentedCode',
	'htmlBlock',
	'linkReferenceDefinition',
	'table',
	'unrecognized',
	'blockquote',
	'list',
	'listItem'
];

describe('block-kind-descriptor registry', () => {
	it('has a descriptor for every BlockKind', () => {
		for (const kind of ALL_KINDS) {
			expect(tryGetBlockKindDescriptor(kind)).toBeDefined();
		}
	});

	it('marks thematicBreak as non-editable and every other kind as editable', () => {
		for (const kind of ALL_KINDS) {
			const d = getBlockKindDescriptor(kind);
			const expected = kind !== 'thematicBreak';
			expect(d.editable, `${kind}.editable`).toBe(expected);
		}
	});

	it('marks blockquote/list/listItem as containers and nothing else', () => {
		const containers: BlockKind[] = ['blockquote', 'list', 'listItem'];
		for (const kind of ALL_KINDS) {
			const d = getBlockKindDescriptor(kind);
			expect(d.isContainer, `${kind}.isContainer`).toBe(containers.includes(kind));
		}
	});

	it('assigns the merge roles pinned by the design spec', () => {
		expect(getBlockKindDescriptor('paragraph').mergeRole).toBe('prose');
		expect(getBlockKindDescriptor('heading').mergeRole).toBe('prose-absorber');
		expect(getBlockKindDescriptor('setextHeading').mergeRole).toBe('prose-absorber');
		expect(getBlockKindDescriptor('unrecognized').mergeRole).toBe('self-merge');
		expect(getBlockKindDescriptor('thematicBreak').mergeRole).toBe('opaque');
		expect(getBlockKindDescriptor('fencedCode').mergeRole).toBe('opaque');
		expect(getBlockKindDescriptor('blockquote').mergeRole).toBe('container');
		expect(getBlockKindDescriptor('list').mergeRole).toBe('container');
		expect(getBlockKindDescriptor('listItem').mergeRole).toBe('container');
	});
});
