import { describe, it, expect, vi } from 'vitest';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { createBlockEditActions } from '#lib/editor-actions/block-edit.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { parse } from '#lib/core/parser.js';
import {
	createInlineCommands,
	type InlineCommandsDeps
} from '#lib/components/blocks/text/inline-commands.js';

// A command's bytes are not typing: a write declared `entry` mid-burst is its own undo step, so one
// Ctrl+Z takes the formatting off and leaves the words.
// Miss-analysis: the undo-granularity suite tested only structural commits, never a command.

function makeEditor(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(deps);
	return { deps, controller, blockEdit: createBlockEditActions(deps, controller) };
}

describe('a command-path text edit owns its undo entry', () => {
	it('a toggle between two keystrokes is its own entry, not folded into the burst', async () => {
		const { deps, controller, blockEdit } = makeEditor('ab\n');

		await blockEdit.updateBlockContent(0, 'abc\n', 'authored', 'join-typing', 2);
		void blockEdit.updateBlockContent(0, '**abc**\n', 'authored', 'entry', 3);
		await blockEdit.updateBlockContent(0, '**abcd**\n', 'authored', 'join-typing', 5);

		expect(deps.undoManager.getStacks().undo).toHaveLength(3);
		controller.flushDebouncedCheckpoint();
	});

	it('the entry below the toggle is the pre-toggle text, so one step undoes the formatting', async () => {
		const { deps, controller, blockEdit } = makeEditor('ab\n');

		await blockEdit.updateBlockContent(0, 'abc\n', 'authored', 'join-typing', 2);
		void blockEdit.updateBlockContent(0, '**abc**\n', 'authored', 'entry', 3);

		const stacks = deps.undoManager.getStacks();
		expect(stacks.undo.at(-1)?.snapshot.children[0].raw).toBe('abc\n');
		controller.flushDebouncedCheckpoint();
	});

	// The entry is closed on both sides: otherwise the next keystroke joins the toggle's batch and
	// one Ctrl+Z would revert the toggle and the typing after it.
	it('typing after the toggle starts a fresh batch', async () => {
		const { deps, controller, blockEdit } = makeEditor('ab\n');

		void blockEdit.updateBlockContent(0, '**ab**\n', 'authored', 'entry', 0);
		await blockEdit.updateBlockContent(0, '**abc**\n', 'authored', 'join-typing', 4);
		await blockEdit.updateBlockContent(0, '**abcd**\n', 'authored', 'join-typing', 5);

		expect(deps.undoManager.getStacks().undo).toHaveLength(2);
		controller.flushDebouncedCheckpoint();
	});

	// `runCommand` answers true while a widget's source is shown; the toggle waits for the source's
	// write-back, then lands as an entry of its own.
	it('a command behind a shown source lands as its own entry after the write-back', async () => {
		const { deps, controller, blockEdit } = makeEditor('a $x$ b\n');
		let showing = true;
		const commands = createInlineCommands({
			controller,
			widgets: {
				isRevealing: () => showing,
				foldRevealBeforeMutation: () => {
					showing = false;
					const written = blockEdit.updateBlockContent(
						0,
						'a $xy$ b\n',
						'authored',
						'join-typing',
						5
					);
					return { caret: 5, settled: written.then(() => {}) };
				}
			}
		} as unknown as InlineCommandsDeps);

		let wrote = false;
		commands.perform(
			'format.toggleStrong',
			() => {
				wrote = true;
				void blockEdit.updateBlockContent(0, '**a $xy$ b**\n', 'authored', 'entry', 0);
			},
			0
		);
		expect(wrote).toBe(false);
		await vi.waitFor(() => expect(wrote).toBe(true));

		const undo = deps.undoManager.getStacks().undo;
		expect(undo.map((e) => e.snapshot.children[0].raw)).toEqual(['a $x$ b\n', 'a $xy$ b\n']);
		controller.flushDebouncedCheckpoint();
	});

	// A command whose bytes change the block's kind lands through a commit, and still owns its entry.
	it('a command that reparses the block is its own entry too', async () => {
		const { deps, controller, blockEdit } = makeEditor('ab\n');

		await blockEdit.updateBlockContent(0, 'abc\n', 'authored', 'join-typing', 2);
		await blockEdit.updateBlockContent(0, '# abc\n', 'authored', 'entry', 3);
		await blockEdit.updateBlockContent(0, '# abcd\n', 'authored', 'join-typing', 6);

		const undo = deps.undoManager.getStacks().undo;
		expect(undo.map((e) => e.snapshot.children[0].raw)).toEqual(['ab\n', 'abc\n', '# abc\n']);
		controller.flushDebouncedCheckpoint();
	});

	// Control: the same three writes declared as typing merge into one entry.
	it('the same writes without the boundary coalesce into one entry', async () => {
		const { deps, controller, blockEdit } = makeEditor('ab\n');

		await blockEdit.updateBlockContent(0, 'abc\n', 'authored', 'join-typing', 2);
		await blockEdit.updateBlockContent(0, '**abc**\n', 'authored', 'join-typing', 3);
		await blockEdit.updateBlockContent(0, '**abcd**\n', 'authored', 'join-typing', 5);

		expect(deps.undoManager.getStacks().undo).toHaveLength(1);
		controller.flushDebouncedCheckpoint();
	});
});
