import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import {
	ensureEditableContainers,
	emptyParagraph,
	nodeAt
} from '../../tree-operations/node-primitives';
import { rebuildListItemRaw, rebuildBlockquoteRaw } from '../../schema/container-rebuilders';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { checkOpaqueStaleRaw } from '../../invariants/node-shape';
import type { CstNode } from '../../core/nodes';
import { testLeaf } from '$lib/test/harness/test-kinds';

describe('emptyParagraph', () => {
	it('creates the empty-paragraph placeholder shape, blank lines and ending parameterized', () => {
		expect(emptyParagraph('', '\n')).toEqual({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
		expect(emptyParagraph('\n', '\n')).toEqual({
			kind: 'paragraph',
			leadingTrivia: '\n',
			raw: '\n'
		});
		expect(emptyParagraph('', '\r\n').raw).toBe('\r\n');
	});

	// A shared node would alias across tree positions and break the snapshot/unshare
	// model (G1.9).
	it('returns a distinct object on every call', () => {
		const first = emptyParagraph('', '\n');
		const second = emptyParagraph('', '\n');
		expect(first).not.toBe(second);
		first.raw = 'mutated\n';
		expect(second.raw).toBe('\n');
	});
});

// Every caller reads `nodeAt` as total, so an unresolvable path must return null.
// Bounding only the high side let a negative index read `children[-1]`, which path
// composers reach by arithmetic (`index - 1` at a boundary, a decoded coordinate).
describe('nodeAt: an out-of-range index resolves to nothing, either side', () => {
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
	// The backfilled paragraph subsumes the trailing-newline role, so innerPrefix clears with it.
	it('backfills an empty item: paragraph child created, innerPrefix cleared', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- \n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '\n',
			children: [],
			innerSuffix: ''
		};
		ensureEditableContainers(item, '\n');
		expect(item.children).toHaveLength(1);
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.children![0].raw).toBe('\n');
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
		ensureEditableContainers(item, '\n');
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
		ensureEditableContainers(bq, '\n');
		expect(bq.innerPrefix).toBe('');
		expect(bq.children).toHaveLength(1);
	});
});

// A whole-block-focus kind is childless by design, so the backfill's "cursor always has
// a target" rationale does not apply. A phantom paragraph makes the opaque node
// permanently fail checkOpaqueStaleRaw: raw can never account for a child it omits.
describe('ensureEditableContainers: whole-block-focus kinds stay childless', () => {
	beforeEach(__resetSchemaRegistriesForTests);

	function wholeBlockNode(): CstNode {
		const kind = testLeaf('node-ops-whole-block', {
			blockFocus: 'whole-block',
			container: { contract: 'opaque', rebuildRaw: () => {} }
		});
		return { kind, leadingTrivia: '', raw: '```x\ny\n```\n', children: [] };
	}

	it('does not backfill a whole-block-focus opaque container', () => {
		const node = wholeBlockNode();
		ensureEditableContainers(node, '\n');
		expect(node.children).toEqual([]);
		expect(node.innerPrefix).toBeUndefined();
	});

	it('a backfilled-then-committed node would fire opaque-stale-raw; skipping keeps it clean', () => {
		const node = wholeBlockNode();
		ensureEditableContainers(node, '\n');
		// The staleness checker bails on its reparse branch without an opener for the test kind,
		// so the faithfulness precondition is asserted directly instead.
		expect((node.children ?? []).map((c) => c.raw).join('')).toBe('');
		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});
});

describe('parse + backfill + edit + rebuild: round-trip after empty-item edit', () => {
	it('typing into a backfilled empty list item produces the expected raw', () => {
		const doc = parse('- \n');
		const list = doc.children[0];
		const item = list.children![0];
		ensureEditableContainers(item, '\n');

		// The edit pipeline's shape: the synthesized paragraph receives content, then the
		// container's raw is rebuilt from children.
		item.children![0].raw = 'X\n';
		rebuildListItemRaw(item);
		expect(item.raw).toBe('- X\n');
	});

	it('typing into a backfilled empty blockquote produces the expected raw', () => {
		const doc = parse('>\n');
		const bq = doc.children[0];
		ensureEditableContainers(bq, '\n');

		bq.children![0].raw = 'X\n';
		rebuildBlockquoteRaw(bq);
		expect(bq.raw).toBe('> X\n');
	});
});
