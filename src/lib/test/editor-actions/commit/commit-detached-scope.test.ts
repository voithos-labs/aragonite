// A commit whose mutation splices one of its own scope nodes out of the tree must not
// rebuild or invariant-check the detached node, and overlapping scopes must not trip the
// identity assert on the commit's own copies.

import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { asDocPath } from '#lib/selection/path-math.js';
import { registerBlockListState } from '#lib/reactivity/state-registry.js';
import { rangeDelete } from '#lib/selection/range-delete.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { trackChildIds } from '#lib/tree-operations/structural-change.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';
import type { MultiScopeTarget } from '#lib/action-contracts.js';
import type { CstNode } from '#lib/core/nodes.js';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt
} from '#lib/test/harness/editor-actions.js';
import { drainDevWarns, takeDevWarns } from '#lib/test/support/warn-gate.js';
import { fixtureReading } from '../../harness/fixture-grammar';

describe('multi-scope commits with a scope detached by the mutation', () => {
	it('unindent of the only nested item fires nothing (nested-list scope dies)', async () => {
		const doc0 = parse('- Item 1\n  - Nested\n- Item 2\n');
		const { deps } = makeEditorActionsDeps(doc0.children);
		const outerList = () => deps.doc.children[0];
		const parentItem = outerList().children![0];
		const nestedList = parentItem.children![1];
		// promoteNestedItem resolves both through expectStateForNode.
		registerBlockListState(
			nestedList,
			makeBlockListState(() => nestedList)
		);
		registerBlockListState(
			parentItem,
			makeBlockListState(() => parentItem)
		);

		const { listContext } = makeListContextAt(deps, 0);

		drainDevWarns();
		await listContext.promoteNestedItem(0, nestedList, 0);

		expect(serialize(deps.doc)).toBe('- Item 1\n- Nested\n- Item 2\n');
		expect(takeDevWarns()).toEqual([]);
	});

	it('cross-container delete consuming the end item fires nothing (item scope dies)', async () => {
		const doc0 = parse('- target one\n- target two\n- target three\n- tail\n');
		const { deps } = makeEditorActionsDeps(doc0.children);
		const controller = createUndoController(deps);
		const list = () => deps.doc.children[0];
		// ops.ts's commitCrossContainerDelete shape: every endpoint ancestor is a scope.
		const scopes: MultiScopeTarget[] = [
			{ node: list(), state: makeBlockListState(list), path: [0] },
			{
				node: list().children![0],
				state: makeBlockListState(() => list().children![0]),
				path: [0, 0]
			},
			{
				node: list().children![1],
				state: makeBlockListState(() => list().children![1]),
				path: [0, 1]
			}
		];
		const start = { path: [0, 0, 0], offset: 0 };
		const end = { path: [0, 1, 0], offset: 'target two'.length };

		drainDevWarns();
		await controller.commitMultiScope({
			scopes,
			snapshot: { path: asDocPath([0, 0, 0]), offset: 0 },
			mutate: (views) => {
				const ledgers = views.map((v) => trackChildIds(v.node));
				rangeDelete(
					deps.doc,
					rangeCoverage(deps.doc, coverRange(deps.doc, start, end)),
					views[0].sharing,
					fixtureReading(),
					'keyless'
				);
				return ledgers.map((ledger) => {
					const change = ledger.read();
					ledger.release();
					return change;
				});
			},
			op: { kind: 'delete', eventPath: asDocPath([0]) }
		});

		expect(serialize(deps.doc)).toBe('- \n- target three\n- tail\n');
		expect(takeDevWarns()).toEqual([]);
	});

	it('cross-container delete consuming a blockquote scope fires nothing (the CI kind)', async () => {
		const doc0 = parse('head\n\n> quoted line\n');
		const { deps } = makeEditorActionsDeps(doc0.children);
		const controller = createUndoController(deps);
		const bq = deps.doc.children[1] as CstNode;
		const scopes: MultiScopeTarget[] = [
			controller.getDocScope(),
			{ node: bq, state: makeBlockListState(() => bq), path: [1] }
		];
		const start = { path: [0], offset: 'head'.length };
		const end = { path: [1, 0], offset: 'quoted line'.length };

		drainDevWarns();
		await controller.commitMultiScope({
			scopes,
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: (views) => {
				// Through the document's view, as every commit's mutation writes.
				const top = documentBody(deps.doc, views[0].children);
				const ledgers = views.map((v, i) => trackChildIds(i === 0 ? top : v.node));
				rangeDelete(
					top,
					rangeCoverage(top, coverRange(top, start, end)),
					views[0].sharing,
					fixtureReading(),
					'keyless'
				);
				return ledgers.map((ledger) => {
					const change = ledger.read();
					ledger.release();
					return change;
				});
			},
			op: { kind: 'delete', eventPath: asDocPath([0]) }
		});

		expect(serialize(deps.doc)).toBe('head\n');
		expect(takeDevWarns()).toEqual([]);
	});
});
