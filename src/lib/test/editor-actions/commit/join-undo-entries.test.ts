import { describe, it, expect } from 'vitest';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { asDocPath } from '$lib/selection/path-math';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';

// An async run of several writes is one undo entry: an inline-menu pick that clears its query and
// then inserts a block below undoes in one press. Miss-analysis: the undo suites pinned each write's
// own entry and the synchronous `'join'` flag, and no case ran writes spread across awaits.

function makeEditor(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(deps);
	return { deps, controller, blockEdit: createBlockEditActions(deps, controller) };
}

const undoDepth = (deps: ReturnType<typeof makeEditor>['deps']) =>
	deps.undoManager.getStacks().undo.length;

describe('joinUndoEntries', () => {
	it('three writes inside one run are one entry holding the state before the first', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');

		await controller.joinUndoEntries(async () => {
			await blockEdit.insertParagraph(1, 'b');
			await blockEdit.insertParagraph(2, 'c');
			await blockEdit.insertParagraph(3, 'd');
		});

		const undo = deps.undoManager.getStacks().undo;
		expect(undo).toHaveLength(1);
		expect(serialize(undo[0].snapshot)).toBe('a\n');
	});

	it('a write after the run has ended opens a new entry', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');

		await controller.joinUndoEntries(async () => {
			await blockEdit.insertParagraph(1, 'b');
			await blockEdit.insertParagraph(2, 'c');
		});
		await blockEdit.insertParagraph(3, 'd');

		expect(undoDepth(deps)).toBe(2);
	});

	it('a nested run stays inside the outer one, even for writes after the inner ends', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');

		await controller.joinUndoEntries(async () => {
			await blockEdit.insertParagraph(1, 'b');
			await controller.joinUndoEntries(async () => {
				await blockEdit.insertParagraph(2, 'c');
			});
			await blockEdit.insertParagraph(3, 'd');
		});

		expect(undoDepth(deps)).toBe(1);
	});

	it('clears the redo stack once, on the first write of the run', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');
		await blockEdit.insertParagraph(1, 'b');
		const undone = deps.undoManager.undo(controller.captureCurrentState());
		expect(undone).not.toBeNull();
		expect(deps.undoManager.canRedo).toBe(true);

		await controller.joinUndoEntries(async () => {
			await blockEdit.insertParagraph(1, 'c');
			await blockEdit.insertParagraph(2, 'd');
		});

		expect(deps.undoManager.canRedo).toBe(false);
		expect(undoDepth(deps)).toBe(1);
	});

	it('a first write that rolls back leaves the next write to open the entry', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');

		await controller.joinUndoEntries(async () => {
			await controller
				.commitStructural({
					snapshot: { path: asDocPath([0]), offset: 0 },
					mutate: () => {
						throw new Error('refused');
					}
				})
				.catch(() => {});
			await blockEdit.insertParagraph(1, 'b');
		});

		const undo = deps.undoManager.getStacks().undo;
		expect(undo).toHaveLength(1);
		expect(serialize(undo[0].snapshot)).toBe('a\n');
	});

	it('a run that throws still ends, so later writes get their own entries', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');

		await expect(
			controller.joinUndoEntries(async () => {
				await blockEdit.insertParagraph(1, 'b');
				throw new Error('plugin failed');
			})
		).rejects.toThrow('plugin failed');
		await blockEdit.insertParagraph(2, 'c');

		expect(undoDepth(deps)).toBe(2);
	});
});
