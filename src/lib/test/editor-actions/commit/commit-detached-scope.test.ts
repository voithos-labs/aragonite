// A multi-scope commit whose mutation splices one of its own scope nodes out
// of the tree (an emptied nested list under promoteNestedItem, a consumed
// endpoint item or blockquote under a cross-container rangeDelete) must not
// rebuild or invariant-check the detached node — and preparing overlapping
// scopes must not false-fire the identity assert on the ceremony's own copies.
// The armed channel below is the same console channel the e2e watcher fails on.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { asDocPath } from '$lib/selection/path-math';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { rangeDelete } from '$lib/selection/range-delete';
import { __computeScopeDescriptorForTests } from '$lib/selection/cross-block/ops';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';
import type { MultiScopeTarget } from '$lib/editor-actions/deps';
import type { CstNode } from '$lib/core/nodes';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt
} from '$lib/test/harness/editor-actions';

// devWarn mutes itself under Vitest, which is why no unit test ever saw these
// fires; un-mute for the duration and capture invariant lines only.
function armInvariantChannel(): string[] {
	const fires: string[] = [];
	configureEditorEnv({ isTest: false });
	vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
		const head = typeof args[0] === 'string' ? args[0] : '';
		if (head.includes('[invariant:')) fires.push(`${head} ${JSON.stringify(args[1] ?? '')}`);
	});
	return fires;
}

afterEach(() => {
	resetEditorEnv();
	vi.restoreAllMocks();
});

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

		const fires = armInvariantChannel();
		await listContext.promoteNestedItem(0, nestedList, 0);

		expect(serialize(deps.doc)).toBe('- Item 1\n- Nested\n- Item 2\n');
		expect(fires).toEqual([]);
	});

	it('cross-container delete consuming the end item fires nothing (item scope dies)', async () => {
		const doc0 = parse('- target one\n- target two\n- target three\n- tail\n');
		const { deps } = makeEditorActionsDeps(doc0.children);
		const controller = createUndoController(deps);
		const list = () => deps.doc.children[0];
		// ops.ts's commitCrossContainerDelete shape: every endpoint ancestor is a scope.
		const paths = [[0], [0, 0], [0, 1]];
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

		const fires = armInvariantChannel();
		await controller.commitMultiScope({
			scopes,
			snapshot: { path: asDocPath([0, 0, 0]), offset: 0 },
			mutate: (views) => {
				const beforeLens = views.map((v) => v.children.length);
				rangeDelete(deps.doc, start, end, views[0].sharing, undefined);
				return views.map((v, i) =>
					__computeScopeDescriptorForTests(
						paths[i],
						start.path,
						end.path,
						beforeLens[i],
						v.children.length
					)
				);
			},
			op: { kind: 'delete', eventPath: asDocPath([0]) }
		});

		expect(serialize(deps.doc)).toBe('- \n- target three\n- tail\n');
		expect(fires).toEqual([]);
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
		const paths = [[], [1]];
		const start = { path: [0], offset: 'head'.length };
		const end = { path: [1, 0], offset: 'quoted line'.length };

		const fires = armInvariantChannel();
		await controller.commitMultiScope({
			scopes,
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: (views) => {
				const beforeLens = views.map((v) => v.children.length);
				rangeDelete(deps.doc, start, end, views[0].sharing, undefined);
				return views.map((v, i) =>
					__computeScopeDescriptorForTests(
						paths[i],
						start.path,
						end.path,
						beforeLens[i],
						v.children.length
					)
				);
			},
			op: { kind: 'delete', eventPath: asDocPath([0]) }
		});

		expect(serialize(deps.doc)).toBe('head\n');
		expect(fires).toEqual([]);
	});
});
