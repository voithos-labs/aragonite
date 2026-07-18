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
			parentKind: 'document'
		});
	});

	it('a paragraph inside a list item resolves to the item under the list', () => {
		const doc = parse('- one\n- two\n- three\n');
		expect(resolveReorderUnit(doc, [0, 1, 0])).toEqual({
			parentPath: [0],
			index: 1,
			parentKind: 'list'
		});
	});

	it('a blockquote child resolves to itself under the blockquote', () => {
		const doc = parse('> a\n>\n> b\n');
		expect(resolveReorderUnit(doc, [0, 1])).toEqual({
			parentPath: [0],
			index: 1,
			parentKind: 'blockquote'
		});
	});

	it('walks past the nearest non-reorderable parent to the list', () => {
		// listItem is not reorderable on its own — the unit is the item under the list.
		const doc = parse('- one\n- two\n- three\n');
		expect(resolveReorderUnit(doc, [0, 2])).toEqual({
			parentPath: [0],
			index: 2,
			parentKind: 'list'
		});
	});

	it('resolves a table cell up to the table as a top-level document block', () => {
		// table/tableRow/tableCell are not reorderable, but the table itself is a
		// top-level block — the resolver climbs to the document slot it occupies.
		const doc = parse('| a | b |\n| - | - |\n| c | d |\n');
		expect(resolveReorderUnit(doc, [0, 0, 0])).toEqual({
			parentPath: [],
			index: 0,
			parentKind: 'document'
		});
	});

	it('returns null for the empty path — no slot to move', () => {
		const doc = parse('a\n\nb\n');
		expect(resolveReorderUnit(doc, [])).toBeNull();
	});

	it('a nested node whose kind is "document" is not the reorderable root', () => {
		// The root is identified STRUCTURALLY (parentPath.length === 0), never by the
		// kind string. A plugin kind that happens to be named 'document' sitting at a
		// non-root slot must not be mistaken for the sibling-permutable document.
		const nested: CstNode = {
			kind: 'document' as CstNode['kind'],
			leadingTrivia: '',
			raw: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'body\n' }]
		};
		const doc: Document = { kind: 'document', prefix: '', children: [nested], suffix: '' };
		// Pre-fix this returned { parentPath: [0], index: 0, parentKind: 'document' } —
		// treating the alias as a reorderable parent. It now walks past to the real
		// root, moving the nested node as a top-level unit.
		expect(resolveReorderUnit(doc, [0, 0])).toEqual({
			parentPath: [],
			index: 0,
			parentKind: 'document'
		});
	});
});

// A plugin (opaque) container is not a reorderable parent: the resolver stops at
// its boundary and declines rather than walking past it to the document slot (the
// teleport). A native reorderable parent NESTED in the body still wins first, so
// the decline can't over-reach a legitimate inner list/blockquote.
describe('resolveReorderUnit — plugin (opaque) container', () => {
	beforeEach(__resetSchemaRegistriesForTests);

	// TOP paragraph + an opaque container whose child 0 is reserved chrome and whose
	// remaining children are the passed body. Container sits at document index 1.
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
		// Pre-fix this returned { parentPath: [], index: 1, parentKind: 'document' } —
		// the whole container's slot, which is the teleport.
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
		// Leaf-first: the blockquote wins before the opaque boundary is reached.
		expect(resolveReorderUnit(doc, [1, 1, 1])).toEqual({
			parentPath: [1, 1],
			index: 1,
			parentKind: 'blockquote'
		});
	});
});
