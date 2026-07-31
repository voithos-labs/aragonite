import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins } from '$lib';
import { declarePluginKind, registerBlockKind } from '$lib/plugin';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { asDocPath } from '$lib/selection/path-math';
import { testClosure } from '$lib/test/support/closure';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';

// A commit that unwinds AFTER the chain rebuild re-kinded a container published a
// replacement into a live NESTED children array, which no other rollback register
// reaches: the array swap restores `doc.children` and `savedChildren` restores the
// swapped-out node's own children, not the slot now holding a different node.

let THROWING: AnyBlockKind;

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
	THROWING = declarePluginKind('spec-throwing-rebuild');
	registerBlockKind(THROWING, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		container: {
			contract: 'opaque',
			rebuildRaw: () => {
				throw new Error('rebuildRaw exploded');
			}
		}
	});
});

/** doc → [outer blockquote → inner blockquote → paragraph, throwing container]. */
function makeDoc() {
	const harness = makeEditorActionsDeps([
		parse('> > [!TI\n').children[0],
		{ kind: THROWING, leadingTrivia: '\n', raw: 'boom\n', children: [] } as CstNode
	]);
	const controller = createUndoController(harness.deps);
	const inner = () => harness.deps.doc.children[0].children![0];
	const thrower = () => harness.deps.doc.children[1];
	return { ...harness, controller, inner, thrower };
}

/** Takes the snapshot and unshares the spine, so the joining commit below finds the
 *  outer blockquote already owned and splices into its live children array. */
async function seedUndoUnit(h: ReturnType<typeof makeDoc>): Promise<void> {
	await h.controller.commitMultiScope({
		scopes: [{ node: h.inner(), path: [0, 0], state: createBlockListState(h.inner) }],
		snapshot: { path: asDocPath([0, 0, 0]), offset: 0 },
		mutate: ([innerScope]) => {
			innerScope.children[0].raw = '[!TI\n';
			return [{ op: 'noop' }];
		}
	});
}

/** The inner leaf write completes a `> [!TIP]` marker, so that scope's rebuild re-kinds the
 *  container — and chains sort deepest-first, so the swap lands before the throw. */
async function throwingCommit(h: ReturnType<typeof makeDoc>): Promise<unknown> {
	try {
		await h.controller.commitMultiScope({
			scopes: [
				{ node: h.inner(), path: [0, 0], state: createBlockListState(h.inner) },
				{ node: h.thrower(), path: [1], state: createBlockListState(h.thrower) }
			],
			snapshot: 'skip',
			mutate: ([innerScope]) => {
				innerScope.children[0].raw = '[!TIP]\n';
				return [{ op: 'noop' }, { op: 'noop' }];
			}
		});
		return null;
	} catch (err) {
		return err;
	}
}

describe('a commit that unwinds after a container was re-kinded', () => {
	it('puts the original node back in its slot', async () => {
		const h = makeDoc();
		await seedUndoUnit(h);
		const before = h.inner();
		expect(before.kind).toBe('blockquote');

		const thrown = await throwingCommit(h);

		expect(thrown).toBeInstanceOf(Error);
		expect(h.inner()).toBe(before);
		expect(h.inner().kind).toBe('blockquote');
	});

	// The slot alone is not enough: a swap keeps the bytes, so the replacement would
	// serialize identically. Only the restored body distinguishes the two.
	it('leaves the restored body and the bytes as they were before the commit', async () => {
		const h = makeDoc();
		await seedUndoUnit(h);
		const before = serialize(h.deps.doc);

		await throwingCommit(h);

		expect(h.inner().children?.[0].raw).toBe('[!TI\n');
		expect(serialize(h.deps.doc)).toBe(before);
	});
});
