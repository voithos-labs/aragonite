// The invariant predicates are exhaustively unit-tested as pure functions, but
// no test proved the COMMIT ceremony actually invokes them over the nodes it
// touched. Two probe-verified holes stayed green under every suite: the
// container-branch `touchedNodes` thunk collapsed to `() => []`, and a deleted
// `assertCommittedNodes` call. These controls plant a real staleness THROUGH a
// commit and assert the ceremony's invariant channel fires — the belt-is-buckled
// test. Each commit FAMILY (multi-scope container branch, top-level metadata-noop
// document branch) gets its own control, since they carry the wiring separately.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { asDocPath } from '$lib/selection/path-math';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';
import type { MultiScopeTarget } from '$lib/editor-actions/deps';
import type { CstNode } from '$lib/core/nodes';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';

// devWarn mutes itself under Vitest, so the invariant channel is silent by
// default — un-mute it and capture only the `[invariant:` lines the e2e watcher
// also fails on. (Mirrors commit-detached-scope.test.ts, which asserts the
// channel stays SILENT; these controls assert it FIRES.)
function armInvariantChannel(): string[] {
	const fires: string[] = [];
	configureEditorEnv({ isTest: false });
	vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
		const head = typeof args[0] === 'string' ? args[0] : '';
		if (head.includes('[invariant:')) fires.push(`${head} ${JSON.stringify(args[1] ?? '')}`);
	});
	return fires;
}

function firesStaleRaw(fires: string[]): boolean {
	return fires.some((f) => f.includes('[invariant:stale-raw'));
}

// A blockquote holding a nested blockquote: corrupting the nested child's raw
// leaves it stale vs its own children. The commit ceremony rebuilds the OUTER
// spine (reading the nested raw verbatim, strip contract) but never re-derives
// the nested child, so the plant survives to assertCommittedNodes — where
// checkStaleRaw recurses into strip descendants and fires.
const NESTED_BQ = '> outer\n>\n> > nested one\n> > nested two\n';

function corruptNestedBlockquote(outer: CstNode): void {
	const nested = outer.children?.find((c) => c.kind === 'blockquote');
	if (!nested) throw new Error('fixture has no nested blockquote to corrupt');
	nested.raw = '> DESYNCED\n';
}

afterEach(() => {
	resetEditorEnv();
	vi.restoreAllMocks();
});

describe('commit ceremony fires the node invariants over its touched nodes', () => {
	// ── Family 1: multi-scope container branch (the `touchedNodes` thunk) ────────
	it('a container-branch commit that leaves a nested raw stale fires stale-raw', async () => {
		const { deps } = makeEditorActionsDeps(parse(NESTED_BQ).children);
		const controller = createUndoController(deps);
		const outer = () => deps.doc.children[0];
		const scopes: MultiScopeTarget[] = [
			{ node: outer(), state: makeBlockListState(outer), path: [0] }
		];

		const fires = armInvariantChannel();
		await controller.commitMultiScope({
			scopes,
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: (views) => {
				corruptNestedBlockquote(views[0].node as CstNode);
				return [{ op: 'noop' }];
			},
			op: { kind: 'metadataUpdate', eventPath: asDocPath([0]), detail: { fields: ['quoteDepth'] } }
		});

		expect(
			firesStaleRaw(fires),
			`expected an [invariant:stale-raw] fire, got ${JSON.stringify(fires)}`
		).toBe(true);
	});

	// ── Family 2: top-level metadata-noop document branch (explicit touchedNodes) ─
	// updateBlockMetadata returns `op: 'noop'`, so the ceremony cannot infer the
	// resynced node from the StructuralChange — the C-F5 fix names it explicitly.
	// Without that name the bogus node sits unvalidated (the exact audit hole).
	it('a top-level updateBlockMetadata over a stale nested raw fires stale-raw', async () => {
		const { deps } = makeEditorActionsDeps(parse(NESTED_BQ).children);
		const controller = createUndoController(deps);
		const blockEdit = createBlockEditActions(deps, controller);
		corruptNestedBlockquote(deps.doc.children[0]);

		const fires = armInvariantChannel();
		await blockEdit.updateBlockMetadata(0, { quoteDepth: 1 });

		expect(
			firesStaleRaw(fires),
			`expected an [invariant:stale-raw] fire, got ${JSON.stringify(fires)}`
		).toBe(true);
	});
});
