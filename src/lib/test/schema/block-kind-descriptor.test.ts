import { describe, it, expect, beforeEach } from 'vitest';
import type { BlockKind } from '../../core/nodes';
import { ALL_BLOCK_KINDS } from '../../core/nodes';
import {
	getBlockKindDescriptor,
	registerBlockKind,
	tryGetBlockKindDescriptor
} from '../../schema/block-kind-descriptor';
import { declarePluginKind } from '../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';

describe('block-kind-descriptor registry', () => {
	it('has a descriptor for every BlockKind', () => {
		for (const kind of ALL_BLOCK_KINDS) {
			expect(tryGetBlockKindDescriptor(kind)).toBeDefined();
		}
	});

	it('marks thematicBreak as non-editable and every other kind as editable', () => {
		for (const kind of ALL_BLOCK_KINDS) {
			const d = getBlockKindDescriptor(kind);
			const expected = kind !== 'thematicBreak';
			expect(d.editable, `${kind}.editable`).toBe(expected);
		}
	});

	it('marks blockquote/list/listItem/table/tableRow as containers and nothing else', () => {
		const containers: BlockKind[] = ['blockquote', 'list', 'listItem', 'table', 'tableRow'];
		for (const kind of ALL_BLOCK_KINDS) {
			const d = getBlockKindDescriptor(kind);
			expect(d.isContainer, `${kind}.isContainer`).toBe(containers.includes(kind));
		}
	});

	it('assigns the merge roles pinned by the design spec', () => {
		expect(getBlockKindDescriptor('paragraph').mergeRole).toBe('prose');
		expect(getBlockKindDescriptor('heading').mergeRole).toBe('prose-absorber');
		expect(getBlockKindDescriptor('setextHeading').mergeRole).toBe('prose-absorber');
		expect(getBlockKindDescriptor('unrecognized').mergeRole).toBe('self-merge');
		expect(getBlockKindDescriptor('thematicBreak').mergeRole).toBe('not-mergeable');
		expect(getBlockKindDescriptor('fencedCode').mergeRole).toBe('not-mergeable');
		expect(getBlockKindDescriptor('blockquote').mergeRole).toBe('container');
		expect(getBlockKindDescriptor('list').mergeRole).toBe('container');
		expect(getBlockKindDescriptor('listItem').mergeRole).toBe('container');
	});
});

describe('BlockKindDescriptor — supportsInline + getContentRange', () => {
	it('paragraph supports inline with default range (no getContentRange hook)', () => {
		const d = getBlockKindDescriptor('paragraph');
		expect(d.supportsInline).toBe(true);
		expect(d.getContentRange).toBeUndefined();
	});

	it('heading supports inline with marker-skipping content range', () => {
		const d = getBlockKindDescriptor('heading');
		expect(d.supportsInline).toBe(true);
		const range = d.getContentRange!({
			kind: 'heading',
			leadingTrivia: '',
			raw: '## hello\n',
			metadata: { level: 2 }
		});
		expect(range).toEqual({ start: 3, end: 8 });
	});

	it('setextHeading supports inline and trims the underline line', () => {
		const d = getBlockKindDescriptor('setextHeading');
		expect(d.supportsInline).toBe(true);
		const range = d.getContentRange!({
			kind: 'setextHeading',
			leadingTrivia: '',
			raw: 'hello\n---\n',
			metadata: { level: 2 }
		});
		expect(range).toEqual({ start: 0, end: 5 });
	});

	it('fencedCode does not support inline', () => {
		expect(getBlockKindDescriptor('fencedCode').supportsInline).toBe(false);
	});

	it('non-prose leaf kinds do not support inline', () => {
		const nonProseLeaves: BlockKind[] = [
			'thematicBreak',
			'indentedCode',
			'htmlBlock',
			'linkReferenceDefinition',
			'unrecognized'
		];
		for (const kind of nonProseLeaves) {
			expect(getBlockKindDescriptor(kind).supportsInline, `${kind}.supportsInline`).toBe(false);
		}
	});

	it('containers do not support inline (delegate to children)', () => {
		expect(getBlockKindDescriptor('list').supportsInline).toBe(false);
		expect(getBlockKindDescriptor('blockquote').supportsInline).toBe(false);
		expect(getBlockKindDescriptor('listItem').supportsInline).toBe(false);
		expect(getBlockKindDescriptor('table').supportsInline).toBe(false);
		expect(getBlockKindDescriptor('tableRow').supportsInline).toBe(false);
	});

	it('marks tableCell with supportsInline: true and exposes a whole-raw content range', () => {
		const d = getBlockKindDescriptor('tableCell');
		expect(d.supportsInline).toBe(true);
		expect(d.editable).toBe(true);
		expect(d.isContainer).toBe(false);
		expect(d.mergeRole).toBe('not-mergeable');

		const sampleCell = { kind: 'tableCell', leadingTrivia: '', raw: 'hello' } as const;
		expect(d.getContentRange!(sampleCell)).toEqual({ start: 0, end: 5 });

		// Empty cell — happens when buildRow pads short body rows.
		const emptyCell = { kind: 'tableCell', leadingTrivia: '', raw: '' } as const;
		expect(d.getContentRange!(emptyCell)).toEqual({ start: 0, end: 0 });
	});

	it('only paragraph/heading/setextHeading/tableCell support inline', () => {
		const inlineKinds = ALL_BLOCK_KINDS.filter((k) => getBlockKindDescriptor(k).supportsInline);
		expect(inlineKinds.sort()).toEqual(['heading', 'paragraph', 'setextHeading', 'tableCell']);
	});
});

describe('renderImagesAsWidgets descriptor flag', () => {
	it('paragraph defaults to true', () => {
		const d = getBlockKindDescriptor('paragraph');
		expect(d.renderImagesAsWidgets ?? true).toBe(true);
	});

	it('heading defaults to true', () => {
		const d = getBlockKindDescriptor('heading');
		expect(d.renderImagesAsWidgets ?? true).toBe(true);
	});

	it('tableCell opts out (false)', () => {
		const d = getBlockKindDescriptor('tableCell');
		expect(d.renderImagesAsWidgets).toBe(false);
	});
});

describe('containerContract — strip / grid / opaque container-shape union', () => {
	const STRIP: BlockKind[] = ['blockquote', 'list', 'listItem'];
	const GRID: BlockKind[] = ['table', 'tableRow'];

	it('every container declares a contract; non-containers declare none', () => {
		for (const kind of ALL_BLOCK_KINDS) {
			const d = getBlockKindDescriptor(kind);
			if (d.isContainer) {
				expect(d.containerContract, `${kind}.containerContract`).toBeDefined();
			} else {
				expect(d.containerContract, `${kind}.containerContract`).toBeUndefined();
			}
		}
	});

	it('classifies strip containers as strip and grid containers as grid', () => {
		for (const kind of STRIP) {
			expect(getBlockKindDescriptor(kind).containerContract, kind).toBe('strip');
		}
		for (const kind of GRID) {
			expect(getBlockKindDescriptor(kind).containerContract, kind).toBe('grid');
		}
	});
});

// blockFocus is a leaf-level, additive descriptor field: it must survive
// normalization untouched (it is NOT container-only, so stripContainerOnlyKeys
// keeps it) whether the kind registers as a leaf or with a container group — the
// mermaid case, an opaque container that also opts into whole-block focus.
describe('blockFocus — whole-block-focus opt-in', () => {
	beforeEach(__resetSchemaRegistriesForTests);

	it('no built-in kind declares blockFocus', () => {
		for (const kind of ALL_BLOCK_KINDS) {
			expect(getBlockKindDescriptor(kind).blockFocus, `${kind}.blockFocus`).toBeUndefined();
		}
	});

	it('survives leaf registration', () => {
		const kind = declarePluginKind('spec-leaf-focus');
		registerBlockKind(kind, {
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			blockFocus: 'whole-block'
		});
		expect(getBlockKindDescriptor(kind).blockFocus).toBe('whole-block');
	});

	it('survives registration alongside a container group (opaque childless block)', () => {
		const kind = declarePluginKind('spec-container-focus');
		registerBlockKind(kind, {
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			blockFocus: 'whole-block',
			container: { contract: 'opaque', rebuildRaw: () => {} }
		});
		const d = getBlockKindDescriptor(kind);
		expect(d.blockFocus).toBe('whole-block');
		expect(d.isContainer).toBe(true);
		expect(d.containerContract).toBe('opaque');
	});
});
