import { describe, it, expect, beforeEach } from 'vitest';
import type { BlockKind } from '../../core/nodes';
import { ALL_BLOCK_KINDS } from '../../core/nodes';
import { getContentRange } from '../../core/inline';
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

	// Derived from ALL_BLOCK_KINDS, so a new kind with no row here fails by name — and
	// merge-rules.test.ts can pin the eligibility rules per role rather than per kind pair.
	it('assigns every kind the merge role pinned by the design spec', () => {
		const roles = Object.fromEntries(
			ALL_BLOCK_KINDS.map((kind) => [kind, getBlockKindDescriptor(kind).mergeRole])
		);
		expect(roles).toEqual({
			heading: 'prose-absorber',
			setextHeading: 'prose-absorber',
			paragraph: 'prose',
			fencedCode: 'not-mergeable',
			thematicBreak: 'not-mergeable',
			indentedCode: 'not-mergeable',
			htmlBlock: 'not-mergeable',
			linkReferenceDefinition: 'not-mergeable',
			tableCell: 'not-mergeable',
			unrecognized: 'self-merge',
			blockquote: 'container',
			list: 'container',
			listItem: 'container',
			table: 'not-mergeable',
			tableRow: 'not-mergeable'
		});
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

	it('marks tableCell with supportsInline: true and resolves a whole-raw content range', () => {
		const d = getBlockKindDescriptor('tableCell');
		expect(d.supportsInline).toBe(true);
		expect(d.editable).toBe(true);
		expect(d.isContainer).toBe(false);
		expect(d.mergeRole).toBe('not-mergeable');

		const sampleCell = { kind: 'tableCell', leadingTrivia: '', raw: 'hello' } as const;
		expect(getContentRange(sampleCell)).toEqual({ start: 0, end: 5 });

		// Empty cell — happens when buildRow pads short body rows.
		const emptyCell = { kind: 'tableCell', leadingTrivia: '', raw: '' } as const;
		expect(getContentRange(emptyCell)).toEqual({ start: 0, end: 0 });
	});

	it('only paragraph/heading/setextHeading/tableCell support inline', () => {
		const inlineKinds = ALL_BLOCK_KINDS.filter((k) => getBlockKindDescriptor(k).supportsInline);
		expect(inlineKinds.sort()).toEqual(['heading', 'paragraph', 'setextHeading', 'tableCell']);
	});
});

describe('renderImagesAsWidgets descriptor flag', () => {
	// Exact set over every kind, so a new kind opting out — or an existing one losing its
	// opt-out — has to be a deliberate edit here rather than a silent widening.
	it('tableCell is the only kind opting out; every other kind keeps the true default', () => {
		const optedOut = ALL_BLOCK_KINDS.filter(
			(kind) => getBlockKindDescriptor(kind).renderImagesAsWidgets === false
		);
		expect(optedOut).toEqual(['tableCell']);
		for (const kind of ALL_BLOCK_KINDS) {
			if (kind === 'tableCell') continue;
			expect(getBlockKindDescriptor(kind).renderImagesAsWidgets ?? true, kind).toBe(true);
		}
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

// blockFocus is not container-only, so stripContainerOnlyKeys must keep it whether the
// kind registers as a leaf or with a container group — the mermaid case.
describe('blockFocus — whole-block-focus opt-in', () => {
	beforeEach(__resetSchemaRegistriesForTests);

	// Pinned as an exact set, so a kind gaining or losing the declaration has to be a
	// deliberate edit here rather than a silent widening.
	it('thematicBreak is the only built-in kind declaring blockFocus', () => {
		const declaring = ALL_BLOCK_KINDS.filter(
			(kind) => getBlockKindDescriptor(kind).blockFocus !== undefined
		);
		expect(declaring).toEqual(['thematicBreak']);
		expect(getBlockKindDescriptor('thematicBreak').blockFocus).toBe('whole-block');
	});

	it('survives leaf registration', () => {
		const kind = declarePluginKind('spec-leaf-focus');
		registerBlockKind(kind, {
			gapEdges: 'none',
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
			gapEdges: 'none',
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
