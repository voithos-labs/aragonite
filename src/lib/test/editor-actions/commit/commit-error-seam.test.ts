// The `error` event reports every contained failure, and `origin: 'commit'` is the commit's
// share of it. Every throw site here runs plugin code: the snapshot push's ref walk, the post-tick
// callback, and a block opener reading a byte splice's new bytes.
import { describe, it, expect, afterEach } from 'vitest';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { asDocPath } from '#lib/core/coordinate-spaces.js';
import type { BlockComponent } from '#lib/block-component.js';
import type { EditorError } from '#lib/editor-events.js';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	stubBlockComponent
} from '#lib/test/harness/editor-actions.js';
import { allowDevWarns } from '#lib/test/support/warn-gate.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';

const BOOM = '@@boom';

/** A block kind whose opener throws on any line starting with {@link BOOM}. */
function registerThrowingOpener(): void {
	testLeaf('splice-boom', {
		opener: {
			priority: 1,
			interruptsParagraph: false,
			tryOpen: (ctx) => {
				if (ctx.line.text.startsWith(BOOM)) throw new Error('plugin opener blew up');
				return null;
			}
		}
	});
}

// The container fixtures are hand-built, not parser output, so the dev-mode stale-raw check
// reads them as stale.
afterEach(() => allowDevWarns(['invariant:stale-raw']));

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

describe('the commit sequence contains and attributes every throw site', () => {
	it('reports a throwing landing without unwinding the committed tree', async () => {
		const { deps, errors, controller, state } = harness();

		await controller.commitMultiScope({
			scopes: [{ node: deps.doc.children[0], state, path: [0] }],
			snapshot: { path: asDocPath([0]), offset: 0 },
			op: { kind: 'appendBlock', detail: { itemIndex: 0 }, eventPath: asDocPath([0]) },
			mutate: ([scope]) => {
				// A copy: the undo entry still holds the item itself.
				scope.children[0] = { ...scope.children[0], raw: '- edited\n' };
				return [{ op: 'noop' }];
			},
			landing: () => {
				throw new Error('plugin landing blew up');
			}
		});

		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('commit');
		expect(errors[0].context?.op).toBe('appendBlock');
		// A failing view callback is not a reason to unwind a correct tree.
		expect(serialize(deps.doc)).toContain('- edited\n');
	});

	it('reports a throwing cursor read from the snapshot push and rejects the commit', async () => {
		const { deps, errors, controller, state } = harness();
		deps.setBlockRefs([
			stubBlockComponent({
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

	// Missed while the splice read its bytes before the frame opened: the throw left the call
	// unreported, so no row drove a plugin opener through `commitSource`.
	it('reports an opener throwing on the bytes a byte splice reads, and writes nothing', async () => {
		registerThrowingOpener();
		const { deps, events } = makeEditorActionsDeps('one\n\ntwo\n');
		const errors: EditorError[] = [];
		events.on('error', (e) => errors.push(e));
		const controller = createUndoController(deps);
		let thrown: unknown = null;
		try {
			await controller.commitSource({
				changes: [{ from: 5, to: 8, insert: BOOM }],
				caret: { at: 5, holds: 'text' },
				op: { kind: 'delete', detail: { crossBlock: true } },
				snapshot: { path: asDocPath([1]), offset: 0 }
			});
		} catch (err) {
			thrown = err;
		}

		expect((thrown as Error | null)?.message).toBe('plugin opener blew up');
		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('commit');
		expect(errors[0].context?.op).toBe('delete');
		expect(serialize(deps.doc)).toBe('one\n\ntwo\n');
		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
	});
});
