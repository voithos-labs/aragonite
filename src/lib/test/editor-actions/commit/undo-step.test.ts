import { describe, it, expect } from 'vitest';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { asDocPath } from '$lib/selection/path-math';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';

// An async run of several writes is one undo entry: an inline-menu pick that clears its query and
// then inserts a block below undoes in one press.
// Miss-analysis: no undo case ran a step's writes spread across awaits.

function makeEditor(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(deps);
	return { deps, controller, blockEdit: createBlockEditActions(deps, controller) };
}

const SEED = { path: asDocPath([0]), offset: 1 };

const undoDepth = (deps: ReturnType<typeof makeEditor>['deps']) =>
	deps.undoManager.getStacks().undo.length;

// Miss-analysis (GH #30): grouping was tested only on runs that wrote, never a declined gesture.
describe('undoStep: a step that writes nothing', () => {
	it('leaves no entry and keeps the redo stack', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');
		await blockEdit.insertParagraph(1, 'b');
		deps.undoManager.undo(controller.captureCurrentState());

		await controller.undoStep(SEED, async () => {});

		expect(undoDepth(deps)).toBe(0);
		expect(deps.undoManager.canRedo).toBe(true);
	});

	it('leaves no entry when its only commit is declined as a no-op', async () => {
		const { deps, controller } = makeEditor('a\n');

		await controller.undoStep(SEED, () =>
			controller.commitStructural({
				snapshot: SEED,
				mutate: () => ({ op: 'noop' }),
				discardIfNoop: true
			})
		);

		expect(undoDepth(deps)).toBe(0);
	});
});

describe('undoStep: the entry it records', () => {
	it('holds the selection the step opened with, not the one its first write sees', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n\nb\n');
		const range = { anchor: { path: [0], offset: 0 }, focus: { path: [1], offset: 1 } };
		deps.selectionState.enterCrossBlock(range.anchor, range.focus);

		await controller.undoStep(SEED, async () => {
			deps.selectionState.collapse();
			await blockEdit.insertParagraph(2, 'c');
		});

		expect(deps.undoManager.getStacks().undo[0].selection).toEqual(range);
	});

	it('falls back to the seed when nothing is focused', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');

		await controller.undoStep(SEED, async () => {
			await blockEdit.insertParagraph(1, 'b');
		});

		expect(deps.undoManager.getStacks().undo[0].selection).toEqual({
			anchor: { path: [0], offset: 1 },
			focus: { path: [0], offset: 1 }
		});
	});

	it('takes a keystroke inside it into the same entry, and the next keystroke out of it', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');

		await controller.undoStep(SEED, async () => {
			await blockEdit.insertParagraph(1, 'b');
			await blockEdit.updateBlockContent(1, 'bc\n', 'authored', 1);
		});
		await blockEdit.updateBlockContent(1, 'bcd\n', 'authored', 2);

		expect(undoDepth(deps)).toBe(2);
		controller.flushDebouncedCheckpoint();
	});
});

describe('joinTypingBatch', () => {
	it('keeps a keystroke that reparses into several blocks in the burst it ends', async () => {
		const { deps, controller, blockEdit } = makeEditor('ab\n');

		await blockEdit.updateBlockContent(0, 'abc\n', 'authored', 2);
		await blockEdit.updateBlockContent(0, 'abc\n\nd\n', 'authored', 3);

		const undo = deps.undoManager.getStacks().undo;
		expect(deps.doc.children).toHaveLength(2);
		expect(undo).toHaveLength(1);
		expect(serialize(undo[0].snapshot)).toBe('ab\n');
		controller.flushDebouncedCheckpoint();
	});
});

describe('undoStep', () => {
	it('three writes inside one run are one entry holding the state before the first', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');

		await controller.undoStep(SEED, async () => {
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

		await controller.undoStep(SEED, async () => {
			await blockEdit.insertParagraph(1, 'b');
			await blockEdit.insertParagraph(2, 'c');
		});
		await blockEdit.insertParagraph(3, 'd');

		expect(undoDepth(deps)).toBe(2);
	});

	it('a nested run stays inside the outer one, even for writes after the inner ends', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');

		await controller.undoStep(SEED, async () => {
			await blockEdit.insertParagraph(1, 'b');
			await controller.undoStep(SEED, async () => {
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

		await controller.undoStep(SEED, async () => {
			await blockEdit.insertParagraph(1, 'c');
			await blockEdit.insertParagraph(2, 'd');
		});

		expect(deps.undoManager.canRedo).toBe(false);
		expect(undoDepth(deps)).toBe(1);
	});

	it('a first write that rolls back leaves the next write to open the entry', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');

		await controller.undoStep(SEED, async () => {
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
			controller.undoStep(SEED, async () => {
				await blockEdit.insertParagraph(1, 'b');
				throw new Error('plugin failed');
			})
		).rejects.toThrow('plugin failed');
		await blockEdit.insertParagraph(2, 'c');

		expect(undoDepth(deps)).toBe(2);
	});
});
