// A `rebuildRaw` throw or a `discardIfNoop` bail must unwind the bytes as well as
// the structure, or the restored children disagree with the serialized raw and the
// next `serialize()` emits a half-applied document. Both cases need a node the
// top-level array swap cannot recover: one already unshared in the same undo unit,
// or a direct child the shallow copy still aliases.
import { describe, it, expect, afterEach } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { asDocPath } from '$lib/selection/path-math';
import type { CstNode } from '$lib/core/nodes';
import type { EditorActionsDeps, MultiScopeTarget, UndoController } from '$lib/editor-actions/deps';
import { augmentBuiltin, tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { expectDevWarns } from '$lib/test/support/warn-gate';

// The scope fixtures are minimal hand-built containers, not parser output, so the container-raw
// oracle reads them as stale.
afterEach(() => expectDevWarns(['invariant:stale-raw']));

/** `serialize()` reads only top-level raws, so it cannot see an inner container
 *  whose bytes the rebuild rewrote before the throw. */
function collectRaws(nodes: readonly CstNode[]): string[] {
	const out: string[] = [];
	for (const n of nodes) {
		out.push(n.raw);
		if (n.children) out.push(...collectRaws(n.children));
	}
	return out;
}

const originalListRebuild = tryGetBlockKindDescriptor('list')!.rebuildRaw!;
afterEach(() => {
	augmentBuiltin('list', { container: { rebuildRaw: originalListRebuild } });
});

function throwListRebuildAfter(okCalls: number): void {
	let seen = 0;
	augmentBuiltin('list', {
		container: {
			rebuildRaw: (node: CstNode) => {
				if (seen++ < okCalls) {
					originalListRebuild(node);
					return;
				}
				throw new Error('plugin rebuildRaw blew up');
			}
		}
	});
}

function listItemNode(raw: string): CstNode {
	return {
		kind: 'listItem',
		leadingTrivia: '',
		raw,
		metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
	} as CstNode;
}

/** Outer list whose first item holds a nested list: two scopes, two chain depths. */
function nestedListHarness(): {
	deps: EditorActionsDeps;
	controller: UndoController;
	scopes: () => MultiScopeTarget[];
} {
	const { deps } = makeEditorActionsDeps(parse('- a\n  - x\n- b\n').children);
	const getOuter = () => deps.doc.children[0];
	const getInner = () => deps.doc.children[0].children![0].children![1];
	const outerState = makeBlockListState(getOuter);
	const innerState = makeBlockListState(getInner);
	return {
		deps,
		controller: createUndoController(deps),
		// Re-read per commit: copy-path-on-write replaces the spine nodes assertScopeIdentity checks against.
		scopes: () => [
			{ node: getOuter(), state: outerState, path: [0] },
			{ node: getInner(), state: innerState, path: [0, 0, 1] }
		]
	};
}

describe('commit ceremony — byte rollback across the chain rebuild', () => {
	it('restores every raw the rebuild wrote when a later rebuildRaw throws', async () => {
		const { deps, controller, scopes } = nestedListHarness();

		// Own the whole spine at the current epoch, so the second commit's
		// copy-path-on-write no-ops and its rebuild writes in place.
		await controller.commitMultiScope({
			scopes: scopes(),
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: ([, innerScope]) => {
				innerScope.children.push(listItemNode('  - y\n'));
				return [{ op: 'noop' }, { op: 'insert', at: 1, count: 1 }];
			}
		});

		const rawsBefore = collectRaws(deps.doc.children);

		// Chains sort deepest-first, so the outer list is reached twice — the throw
		// lands on the third rebuild, after two writes.
		throwListRebuildAfter(2);

		await expect(
			controller.commitMultiScope({
				scopes: scopes(),
				snapshot: 'skip',
				mutate: ([, innerScope]) => {
					innerScope.children.push(listItemNode('  - z\n'));
					return [{ op: 'noop' }, { op: 'insert', at: 2, count: 1 }];
				}
			})
		).rejects.toThrow('plugin rebuildRaw blew up');

		expect(collectRaws(deps.doc.children)).toEqual(rawsBefore);
	});

	// The byte register spans each scope's whole spine while the rebuild loop skips
	// chain nodes the mutation detached — `promoteNestedItem`'s shape is where they disagree.
	it('restores overlapping scopes whose chains include a node the mutation detached', async () => {
		const { deps, controller, scopes } = nestedListHarness();
		const parentItemState = makeBlockListState(() => deps.doc.children[0].children![0]);

		await controller.commitMultiScope({
			scopes: scopes(),
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: ([, innerScope]) => {
				innerScope.children.push(listItemNode('  - y\n'));
				return [{ op: 'noop' }, { op: 'insert', at: 1, count: 1 }];
			}
		});

		const rawsBefore = collectRaws(deps.doc.children);
		const treeBefore = serialize(deps.doc);

		// Three chains reach the outer list; the throw lands on the third, after two wrote.
		throwListRebuildAfter(2);

		const [outer, inner] = scopes();
		await expect(
			controller.commitMultiScope({
				scopes: [
					outer,
					inner,
					{
						node: deps.doc.children[0].children![0],
						state: parentItemState,
						path: [0, 0]
					}
				],
				snapshot: 'skip',
				mutate: ([outerScope, innerScope, parentItemScope]) => {
					// Emptying then splicing out the nested list detaches the inner scope's own
					// chain tail while two other scopes still hold it in theirs.
					const [promoted] = innerScope.children.splice(0, 1);
					const nestedIdx = parentItemScope.children.indexOf(innerScope.node);
					parentItemScope.children.splice(nestedIdx, 1);
					outerScope.children.splice(1, 0, promoted);
					return [
						{ op: 'insert', at: 1, count: 1 },
						{ op: 'delete', at: 0, count: 1 },
						{ op: 'delete', at: nestedIdx, count: 1 }
					];
				}
			})
		).rejects.toThrow('plugin rebuildRaw blew up');

		expect(collectRaws(deps.doc.children)).toEqual(rawsBefore);
		expect(serialize(deps.doc)).toBe(treeBefore);
	});

	// The same residual with no plugin and no throw: `discardIfNoop` rolls back AFTER
	// the rebuild loop wrote bytes, into a direct child the shallow spine copy still aliases.
	it('restores the raws a discarded commit wrote before it bailed', async () => {
		const { deps } = makeEditorActionsDeps(parse('- a\n- b\n').children);
		const controller = createUndoController(deps);
		const getList = () => deps.doc.children[0];
		const state = makeBlockListState(getList);

		const rawsBefore = collectRaws(deps.doc.children);

		await controller.commitMultiScope({
			scopes: [{ node: getList(), state, path: [0] }],
			snapshot: { path: asDocPath([0]), offset: 0 },
			discardIfNoop: true,
			mutate: ([scope]) => {
				// A byte write preceding the discovery that nothing structural changed —
				// the precondition `DiscardIfNoop` states in prose only.
				scope.children[0].raw = '- CHANGED\n';
				return [{ op: 'noop' }];
			}
		});

		expect(collectRaws(deps.doc.children)).toEqual(rawsBefore);
	});
});
