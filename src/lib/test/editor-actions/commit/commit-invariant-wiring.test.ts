// The invariant predicates are exhaustively unit-tested as pure functions, but nothing
// proved the COMMIT ceremony invokes them over the nodes it touched — a collapsed
// `touchedNodes` thunk and a deleted `assertCommittedNodes` call both stayed green.
// Each commit family carries the wiring separately, so each gets its own control.

import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { asDocPath } from '$lib/selection/path-math';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import type { MultiScopeTarget } from '$lib/action-contracts';
import type { CstNode } from '$lib/core/nodes';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { drainDevWarns, takeDevWarns } from '$lib/test/support/warn-gate';

function firesStaleRaw(): boolean {
	return takeDevWarns().some((fire) => fire.tag === 'invariant:stale-raw');
}

// The ceremony rebuilds the OUTER spine but never re-derives the nested child, so a
// staleness planted there survives to assertCommittedNodes, where checkStaleRaw recurses.
const NESTED_BQ = '> outer\n>\n> > nested one\n> > nested two\n';

function corruptNestedBlockquote(outer: CstNode): void {
	const nested = outer.children?.find((c) => c.kind === 'blockquote');
	if (!nested) throw new Error('fixture has no nested blockquote to corrupt');
	nested.raw = '> DESYNCED\n';
}

describe('commit ceremony fires the node invariants over its touched nodes', () => {
	// ── Family 1: multi-scope container branch (the `touchedNodes` thunk) ────────
	it('a container-branch commit that leaves a nested raw stale fires stale-raw', async () => {
		const { deps } = makeEditorActionsDeps(parse(NESTED_BQ).children);
		const controller = createUndoController(deps);
		const outer = () => deps.doc.children[0];
		const scopes: MultiScopeTarget[] = [
			{ node: outer(), state: makeBlockListState(outer), path: [0] }
		];

		drainDevWarns();
		await controller.commitMultiScope({
			scopes,
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: (views) => {
				corruptNestedBlockquote(views[0].node as CstNode);
				return [{ op: 'noop' }];
			},
			op: { kind: 'metadataUpdate', eventPath: asDocPath([0]), detail: { fields: ['quoteDepth'] } }
		});

		expect(firesStaleRaw(), 'expected an invariant:stale-raw fire').toBe(true);
	});

	// ── Family 2: top-level metadata-noop document branch (explicit touchedNodes) ─
	// `op: 'noop'` leaves the ceremony unable to infer the resynced node, so this branch
	// must name it explicitly or the node sits unvalidated.
	it('a top-level updateBlockMetadata over a stale nested raw fires stale-raw', async () => {
		const { deps } = makeEditorActionsDeps(parse(NESTED_BQ).children);
		const controller = createUndoController(deps);
		const blockEdit = createBlockEditActions(deps, controller);
		corruptNestedBlockquote(deps.doc.children[0]);

		drainDevWarns();
		await blockEdit.updateBlockMetadata(0, { quoteDepth: 1 });

		expect(firesStaleRaw(), 'expected an invariant:stale-raw fire').toBe(true);
	});
});
