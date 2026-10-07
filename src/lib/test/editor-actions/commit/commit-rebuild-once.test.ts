// Several chains rebuilt in one commit rebuild each node once, however many pass through it.
// Miss-analysis: the multi-scope tests asserted bytes and ids, which a repeated rebuild leaves
// right, so a table rebuilt once per mounted row went unseen.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as unshare from '#lib/tree-operations/unshare.js';
import type { CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { registerBlockListState } from '#lib/reactivity/state-registry.js';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt
} from '#lib/test/harness/editor-actions.js';
import { makeTableMutations } from '../table-mutations-harness';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { asDocPath } from '#lib/selection/path-math.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';
import { coverRange } from '#lib/selection/range-coverage.js';
import {
	applyCrossBlockFormat,
	planCrossBlockFormat
} from '#lib/selection/cross-block/format-range.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';

vi.mock('#lib/tree-operations/unshare.js', async (original) => {
	const real = await original<typeof import('#lib/tree-operations/unshare.js')>();
	return { ...real, rebuildOwnedContainer: vi.fn(real.rebuildOwnedContainer) };
});

beforeEach(() => {
	vi.mocked(unshare.rebuildOwnedContainer).mockClear();
});

/** How many times each node was rebuilt, by kind, for the nodes rebuilt more than once. */
function repeatedRebuilds(): string[] {
	const counts = new Map<CstNode, number>();
	for (const [node] of vi.mocked(unshare.rebuildOwnedContainer).mock.calls) {
		counts.set(node, (counts.get(node) ?? 0) + 1);
	}
	return [...counts].filter(([, n]) => n > 1).map(([node, n]) => `${node.kind} x${n}`);
}

const rebuiltKinds = () =>
	vi.mocked(unshare.rebuildOwnedContainer).mock.calls.map(([node]) => node.kind);

const TABLE = '| a | b |\n| - | - |\n| c | d |\n| e | f |\n';

describe('a multi-scope commit rebuilds each node once', () => {
	it('a grid paste over a table and its mounted rows', async () => {
		const { deps, mutations } = makeTableMutations(TABLE, { mountedRows: [0, 1, 2] });

		await mutations.pasteGrid({ rowIdx: 2, colIdx: 1 }, [['x'], ['y']]);

		expect(serialize(deps.doc)).toBe('| a | b |\n| - | - |\n| c | d |\n| e | x |\n|  | y |\n');
		expect(repeatedRebuilds()).toEqual([]);
		expect(rebuiltKinds().filter((kind) => kind === 'table')).toHaveLength(1);
	});

	it('a column insert over a table and its mounted rows', async () => {
		const { deps, mutations } = makeTableMutations(TABLE, { mountedRows: [0, 1, 2] });

		await mutations.insertColumnRight(0);

		expect(serialize(deps.doc)).toBe('| a |  | b |\n| - | - | - |\n| c |  | d |\n| e |  | f |\n');
		expect(repeatedRebuilds()).toEqual([]);
	});

	it('an indent into a sublist, whose scope sits under the outer list’s', async () => {
		const { deps } = makeEditorActionsDeps('- a\n  - x\n- b\n');
		const item = () => deps.doc.children[0].children![0];
		const sublist = () => item().children![1];
		registerBlockListState(item(), makeBlockListState(item));
		registerBlockListState(sublist(), makeBlockListState(sublist));
		const { listContext } = makeListContextAt(deps, 0);

		await listContext.indentItem(1);

		expect(serialize(deps.doc)).toBe('- a\n  - x\n  - b\n');
		expect(repeatedRebuilds()).toEqual([]);
	});
});

describe('a document-scope mutation over several chains rebuilds each node once', () => {
	it('a format toggle across two items of one list', () => {
		const doc = parse('- a\n- b\n', { scope: 'document' });
		const reading = fixtureReading();
		const start = { path: [0, 0, 0], offset: 0 };
		const end = { path: [0, 1, 0], offset: 1 };
		const plan = planCrossBlockFormat(doc, coverRange(doc, start, end), 'strong', reading)!;

		applyCrossBlockFormat(documentBody(doc), plan, createSharingState(), reading.grammar);

		expect(serialize(doc)).toBe('- **a**\n- **b**\n');
		expect(repeatedRebuilds()).toEqual([]);
	});
});

describe('a mutation’s own rebuild stays off the commit’s chain', () => {
	it('warns when a mutation rebuilds its scope, which the commit rebuilds anyway', async () => {
		const { deps } = makeEditorActionsDeps('- a\n  - x\n- b\n');
		const controller = createUndoController(deps);
		const state = makeBlockListState(() => deps.doc.children[0]);

		await controller.commitMultiScope({
			scopes: [{ node: deps.doc.children[0], state, path: [0] }],
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: ([scope]) => {
				scope.rebuild(scope.node);
				return [{ op: 'noop' }];
			}
		});

		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:scope-rebuild-off-chain');
	});
});
