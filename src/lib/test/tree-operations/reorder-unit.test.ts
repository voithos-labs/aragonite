import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { resolveReorderUnit } from '$lib/tree-operations/reorder-unit';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import type { CstNode, Document } from '$lib/core/nodes';

describe('resolveReorderUnit', () => {
	it('top-level block resolves to itself under the document', () => {
		const doc = parse('a\n\nb\n\nc\n');
		expect(resolveReorderUnit(doc, [1])).toEqual({
			parentPath: [],
			index: 1,
			scope: 'document',
			renumberMarkers: false
		});
	});

	it('a paragraph inside a list item resolves to the item under the list', () => {
		const doc = parse('- one\n- two\n- three\n');
		expect(resolveReorderUnit(doc, [0, 1, 0])).toEqual({
			parentPath: [0],
			index: 1,
			scope: 'container',
			renumberMarkers: true
		});
	});

	it('a blockquote child resolves to itself under the blockquote', () => {
		const doc = parse('> a\n>\n> b\n');
		expect(resolveReorderUnit(doc, [0, 1])).toEqual({
			parentPath: [0],
			index: 1,
			scope: 'container',
			renumberMarkers: false
		});
	});

	it('walks past the nearest non-reorderable parent to the list', () => {
		// listItem is not reorderable on its own: the unit is the item under the list.
		const doc = parse('- one\n- two\n- three\n');
		expect(resolveReorderUnit(doc, [0, 2])).toEqual({
			parentPath: [0],
			index: 2,
			scope: 'container',
			renumberMarkers: true
		});
	});

	it('resolves a table cell up to the table as a top-level document block', () => {
		// The grid kinds are not reorderable, so the resolver climbs to the table's document slot.
		const doc = parse('| a | b |\n| - | - |\n| c | d |\n');
		expect(resolveReorderUnit(doc, [0, 0, 0])).toEqual({
			parentPath: [],
			index: 0,
			scope: 'document',
			renumberMarkers: false
		});
	});

	it('returns null for the empty path — no slot to move', () => {
		const doc = parse('a\n\nb\n');
		expect(resolveReorderUnit(doc, [])).toBeNull();
	});

	it('a nested node whose kind is "document" is not the reorderable root', () => {
		// The root is identified STRUCTURALLY (parentPath.length === 0), never by kind string. The
		// invalid kind is deliberate: the CstNode union rightly will not type a root-name alias.
		const nested = {
			kind: 'document',
			leadingTrivia: '',
			raw: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]
		} as unknown as CstNode;
		const doc: Document = { kind: 'document', prefix: '', children: [nested], suffix: '' };
		// The alias must not be returned as a reorderable parent.
		expect(resolveReorderUnit(doc, [0, 0])).toEqual({
			parentPath: [],
			index: 0,
			scope: 'document',
			renumberMarkers: false
		});
	});
});

// An opaque container is not a reorderable parent: the resolver declines at its boundary
// rather than teleporting to the document slot. A native reorderable parent nested in
// the body still wins first, so the decline cannot over-reach.
describe('resolveReorderUnit — plugin (opaque) container', () => {
	beforeEach(__resetSchemaRegistriesForTests);

	// An opaque container at document index 1 whose child 0 is reserved chrome.
	function opaqueContainer(body: CstNode[]): Document {
		const chromeKind = declarePluginKind('spec-chrome');
		const containerKind = declarePluginKind('spec-container');
		registerBlockKind(chromeKind, {
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			contextDependentKind: true
		});
		registerBlockKind(containerKind, {
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container: { contract: 'opaque', rebuildRaw: () => {}, reservedChrome: { kind: chromeKind } }
		});
		const container: CstNode = {
			kind: containerKind,
			leadingTrivia: '',
			raw: '',
			children: [{ kind: chromeKind, leadingTrivia: '', raw: '\n' }, ...body]
		};
		return {
			kind: 'document',
			prefix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'top\n' }, container],
			suffix: ''
		};
	}

	it('a body leaf declines to null — no walk-past to the document slot', () => {
		const doc = opaqueContainer([{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]);
		// The teleport: returning { parentPath: [], index: 1 }, the whole container's slot.
		expect(resolveReorderUnit(doc, [1, 1])).toBeNull();
	});

	it('the reserved chrome leaf is never a reorder unit', () => {
		const doc = opaqueContainer([{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]);
		expect(resolveReorderUnit(doc, [1, 0])).toBeNull();
	});

	it('a native blockquote nested in the body still reorders within itself (no over-reach)', () => {
		const blockquote: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '',
			metadata: { quoteDepth: 1 },
			children: [
				{ kind: 'paragraph', leadingTrivia: '', raw: 'a\n' },
				{ kind: 'paragraph', leadingTrivia: '', raw: 'b\n' }
			]
		};
		const doc = opaqueContainer([blockquote]);
		expect(resolveReorderUnit(doc, [1, 1, 1])).toEqual({
			parentPath: [1, 1],
			index: 1,
			scope: 'container',
			renumberMarkers: false
		});
	});
});
