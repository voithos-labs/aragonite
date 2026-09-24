import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';

// A pending join ends at the author's next input, so a pick whose onCommit awaits something slow
// cannot fold the author's typing into its entry. Miss-analysis: the join cases only ever wrote
// from inside the run, and none held a run open while something else wrote.

function makeEditor(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(deps);
	return { deps, controller, blockEdit: createBlockEditActions(deps, controller) };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
}

describe('a join ends at the author’s next input', () => {
	it('a run that never resolves: two writes after the input open their own entries', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');
		void controller.joinUndoEntries(async () => {
			await blockEdit.insertParagraph(1, 'b');
			await new Promise(() => {});
		});
		await tick();

		controller.endUndoJoin();
		await blockEdit.insertParagraph(2, 'c');
		await blockEdit.insertParagraph(3, 'd');

		expect(deps.undoManager.getStacks().undo).toHaveLength(3);
	});

	it('the run’s own late write opens its entry, not folding under the author’s', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');
		const hold = deferred();
		const run = controller.joinUndoEntries(async () => {
			await blockEdit.insertParagraph(1, 'b');
			await hold.promise;
			await blockEdit.insertParagraph(3, 'late');
		});
		await tick();

		controller.endUndoJoin();
		await blockEdit.insertParagraph(2, 'typed');
		hold.resolve();
		await run;

		const undo = deps.undoManager.getStacks().undo;
		expect(undo.map((entry) => serialize(entry.snapshot))).toEqual([
			'a\n',
			'a\n\nb\n',
			'a\n\nb\n\ntyped\n'
		]);
	});

	it('a join opened after the input joins its own writes again', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');
		void controller.joinUndoEntries(async () => {
			await blockEdit.insertParagraph(1, 'b');
			await new Promise(() => {});
		});
		await tick();
		controller.endUndoJoin();

		await controller.joinUndoEntries(async () => {
			await blockEdit.insertParagraph(2, 'c');
			await blockEdit.insertParagraph(3, 'd');
		});

		expect(deps.undoManager.getStacks().undo).toHaveLength(2);
	});

	it('an input with no join pending changes nothing', async () => {
		const { deps, controller, blockEdit } = makeEditor('a\n');
		controller.endUndoJoin();

		await controller.joinUndoEntries(async () => {
			await blockEdit.insertParagraph(1, 'b');
			await blockEdit.insertParagraph(2, 'c');
		});

		expect(deps.undoManager.getStacks().undo).toHaveLength(1);
	});
});
