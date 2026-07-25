// editor.md §12 promises the `error` channel is one seam for every contained
// failure, and `origin: 'commit'` is the ceremony's arm of it. Two throw sites
// sat outside the containment: the pre-mutation snapshot push (which walks live
// block refs, including plugin-authored leaves) and the post-tick callback the
// public `updateOwnMetadata(patch, afterTick)` threads a plugin closure into.
// Both reported nothing and rejected a promise every caller voids.
import { describe, it, expect } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { asDocPath } from '$lib/selection/path-math';
import type { BlockComponent } from '$lib/block-component';
import type { EditorError } from '$lib/editor-events';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	mockRef
} from '$lib/test/harness/editor-actions';

function harness() {
	const { deps, events } = makeEditorActionsDeps(parse('- a\n- b\n').children);
	const errors: EditorError[] = [];
	events.on('error', (e) => errors.push(e));
	return {
		deps,
		errors,
		controller: createUndoController(deps),
		state: makeBlockListState(() => deps.doc.children[0])
	};
}

describe('the commit ceremony contains and attributes every throw site', () => {
	it('reports a throwing afterTick without unwinding the committed tree', async () => {
		const { deps, errors, controller, state } = harness();

		await controller.commitMultiScope({
			scopes: [{ node: deps.doc.children[0], state, path: [0] }],
			snapshot: { path: asDocPath([0]), offset: 0 },
			op: { kind: 'appendBlock', detail: { itemIndex: 0 }, eventPath: asDocPath([0]) },
			mutate: ([scope]) => {
				scope.children[0].raw = '- edited\n';
				return [{ op: 'noop' }];
			},
			afterTick: () => {
				throw new Error('plugin afterTick blew up');
			}
		});

		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('commit');
		expect(errors[0].context?.op).toBe('appendBlock');
		// The commit itself succeeded: a failing view callback is not a reason to
		// unwind a correct tree.
		expect(serialize(deps.doc)).toContain('- edited\n');
	});

	it('reports a throwing cursor read from the snapshot push and rejects the commit', async () => {
		const { deps, errors, controller, state } = harness();
		deps.setBlockRefs([
			mockRef({
				getCursorPosition: (): never => {
					throw new Error('plugin getCursorPosition blew up');
				}
			}) as BlockComponent
		]);
		const treeBefore = serialize(deps.doc);

		await expect(
			controller.commitMultiScope({
				scopes: [{ node: deps.doc.children[0], state, path: [0] }],
				snapshot: { path: asDocPath([0]), offset: 0 },
				mutate: ([scope]) => {
					scope.children.pop();
					return [{ op: 'delete', at: 1, count: 1 }];
				}
			})
		).rejects.toThrow('plugin getCursorPosition blew up');

		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('commit');
		// The throw precedes every mutation, so the tree never moved.
		expect(serialize(deps.doc)).toBe(treeBefore);
	});
});
