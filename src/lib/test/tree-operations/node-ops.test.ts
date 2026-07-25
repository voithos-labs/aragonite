import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { ensureEditableContainers, emptyParagraph, nodeAt } from '../../tree-operations/node-ops';
import { rebuildListItemRaw, rebuildBlockquoteRaw } from '../../schema/container-rebuilders';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { declarePluginKind } from '../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { checkOpaqueStaleRaw } from '../../invariants/node-shape';
import type { CstNode } from '../../core/nodes';

describe('emptyParagraph', () => {
	it('mints the empty-paragraph placeholder shape, trivia parameterized', () => {
		expect(emptyParagraph()).toEqual({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
		expect(emptyParagraph('\n')).toEqual({ kind: 'paragraph', leadingTrivia: '\n', raw: '\n' });
	});

	// A shared/module-level node would alias across tree positions and break the
	// snapshot/unshare model (G1.9). Every call must hand back a fresh object.
	it('returns a distinct object on every call', () => {
		const first = emptyParagraph();
		const second = emptyParagraph();
		expect(first).not.toBe(second);
		first.raw = 'mutated\n';
		expect(second.raw).toBe('\n');
	});
});

// Every caller reads `nodeAt` as total — an unresolvable path returns null. It
// bounded the high side only, so a negative index read `children[-1]`: undefined
// as a final step (returned as if it were a node) and a TypeError as a walked one.
// Path composers arithmetic their way to negatives (`index - 1` at a boundary, a
// decoded coordinate), so this is reachable from any of them, not one subsystem.
describe('nodeAt — an out-of-range index resolves to nothing, either side', () => {
	const doc = parse('- alpha\n- beta\n');

	it('declines a negative index as the final step', () => {
		expect(nodeAt(doc, [-1])).toBeNull();
	});

	it('declines a negative index it has to walk through', () => {
		expect(nodeAt(doc, [0, -1, 0])).toBeNull();
	});

	it('still declines past the high end, and still resolves a real path', () => {
		expect(nodeAt(doc, [99])).toBeNull();
		expect(nodeAt(doc, [0, 0])).not.toBeNull();
	});
});

describe('ensureEditableContainers', () => {
	it('backfills an empty container with a paragraph child', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- \n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '\n',
			children: [],
			innerSuffix: ''
		};
		ensureEditableContainers(item);
		expect(item.children).toHaveLength(1);
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.children![0].raw).toBe('\n');
	});

	it('clears innerPrefix when backfilling — backfilled paragraph subsumes the trailing-newline role', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- \n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '\n',
			children: [],
			innerSuffix: ''
		};
		ensureEditableContainers(item);
		expect(item.innerPrefix).toBe('');
	});

	it('leaves innerPrefix alone for non-empty containers', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- \n  Hello\n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Hello\n' }],
			innerSuffix: ''
		};
		ensureEditableContainers(item);
		expect(item.innerPrefix).toBe('\n');
		expect(item.children).toHaveLength(1);
	});

	it('clears innerPrefix on backfilled blockquote too', () => {
		const bq: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '>\n',
			metadata: { quoteDepth: 1 },
			innerPrefix: '\n',
			children: [],
			innerSuffix: ''
		};
		ensureEditableContainers(bq);
		expect(bq.innerPrefix).toBe('');
		expect(bq.children).toHaveLength(1);
	});
});

// A whole-block-focus kind is childless BY DESIGN — the block itself is the
// caret target, so the backfill's "cursor always has a target" rationale does
// not apply. A backfilled phantom paragraph makes the opaque node permanently
// fail checkOpaqueStaleRaw (raw can never account for a child it doesn't
// contain), which fired on the first commits to ever run the checker over a
// live mermaid node (Enter-split, Alt-arrow reorder).
describe('ensureEditableContainers — whole-block-focus kinds stay childless', () => {
	beforeEach(__resetSchemaRegistriesForTests);

	function wholeBlockNode(): CstNode {
		const kind = declarePluginKind('node-ops-whole-block');
		registerBlockKind(kind, {
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			blockFocus: 'whole-block',
			container: { contract: 'opaque', rebuildRaw: () => {} }
		});
		return { kind, leadingTrivia: '', raw: '```x\ny\n```\n', children: [] };
	}

	it('does not backfill a whole-block-focus opaque container', () => {
		const node = wholeBlockNode();
		ensureEditableContainers(node);
		expect(node.children).toEqual([]);
		expect(node.innerPrefix).toBeUndefined();
	});

	it('a backfilled-then-committed node would fire opaque-stale-raw; skipping keeps it clean', () => {
		const node = wholeBlockNode();
		ensureEditableContainers(node);
		// The staleness checker reparses raw through the registry; without an
		// opener for the test kind it bails on the reparse branch — so assert the
		// faithfulness precondition directly: children contribute zero bytes.
		expect((node.children ?? []).map((c) => c.raw).join('')).toBe('');
		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});
});

describe('parse + backfill + edit + rebuild — round-trip after empty-item edit', () => {
	it('typing into a backfilled empty list item produces the expected raw', () => {
		const doc = parse('- \n');
		const list = doc.children[0];
		const item = list.children![0];
		ensureEditableContainers(item);

		// Simulate the edit pipeline: the synthesized paragraph receives content,
		// then the container's raw is rebuilt from children.
		item.children![0].raw = 'X\n';
		rebuildListItemRaw(item);
		expect(item.raw).toBe('- X\n');
	});

	it('typing into a backfilled empty blockquote produces the expected raw', () => {
		const doc = parse('>\n');
		const bq = doc.children[0];
		ensureEditableContainers(bq);

		bq.children![0].raw = 'X\n';
		rebuildBlockquoteRaw(bq);
		expect(bq.raw).toBe('> X\n');
	});
});
