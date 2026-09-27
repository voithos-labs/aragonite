// `block.moveUp` and `block.moveDown` resolve at the dispatch for every block, against the path the
// focused block reports, so a consumer's rebinding moves any block the same way the default does.
//
// Miss-analysis: each block carried its own copy of the reorder case, so no test pinned the move
// at the dispatch, and the one block without a copy (a plugin container) ignored a rebound chord.
import { describe, it, expect, vi } from 'vitest';
import {
	canRunCommandById,
	dispatchKeyCommand,
	dispatchKindCommand,
	runCommandById,
	type KindCommandTarget
} from '$lib/schema/block-commands';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import { commandContext, commandContextWith } from '../support/command-context';

function mover() {
	return { nudgeReorderUnit: vi.fn(async () => {}) };
}

describe('the reorder chords at the dispatch', () => {
	it.each([
		['Alt+ArrowUp', -1],
		['Alt+ArrowDown', 1]
	] as const)(
		'%s moves the focused block at its path, never asking its runCommand',
		(chord, dir) => {
			const reorder = mover();
			const runCommand = vi.fn(() => true);
			const target: KindCommandTarget = { kind: 'paragraph', runCommand, getPath: () => [2, 0] };

			expect(dispatchKeyCommand(chord, target, commandContext({ reorder }))).toBe(true);

			expect(reorder.nudgeReorderUnit).toHaveBeenCalledWith([2, 0], dir);
			expect(runCommand).not.toHaveBeenCalled();
		}
	);

	it('moves on a chord a consumer rebinds, and not on the default it disabled', () => {
		const reorder = mover();
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Alt+ArrowUp', command: null },
			{ chord: 'Mod+Shift+ArrowUp', command: 'block.moveUp' }
		]);
		const ctx = commandContextWith(overrides, { reorder });
		const target: KindCommandTarget = { kind: 'paragraph', getPath: () => [1] };

		expect(dispatchKeyCommand('Alt+ArrowUp', target, ctx)).toBe(false);
		expect(dispatchKeyCommand('Mod+Shift+ArrowUp', target, ctx)).toBe(true);

		expect(reorder.nudgeReorderUnit.mock.calls).toEqual([[[1], -1]]);
	});

	// The table's own chord for moving the whole table is its cell's, so the cell's path is what
	// reaches the reorder; the unit it resolves to is the reorder action's to decide.
	it("takes the table cell's Mod+Alt chord to the cell's path", () => {
		const reorder = mover();
		const target: KindCommandTarget = { kind: 'tableCell', getPath: () => [0, 1, 1] };

		expect(dispatchKeyCommand('Mod+Alt+ArrowDown', target, commandContext({ reorder }))).toBe(true);

		expect(reorder.nudgeReorderUnit).toHaveBeenCalledWith([0, 1, 1], 1);
	});

	it('waits for a shown source to be written before moving', () => {
		const reorder = mover();
		let written: (() => void) | undefined;
		const target: KindCommandTarget = {
			kind: 'paragraph',
			getPath: () => [0],
			afterSourceCommit: (run) => (written = run)
		};

		expect(runCommandById('block.moveDown', undefined, target, commandContext({ reorder }))).toBe(
			true
		);
		expect(reorder.nudgeReorderUnit).not.toHaveBeenCalled();

		written!();
		expect(reorder.nudgeReorderUnit).toHaveBeenCalledWith([0], 1);
	});

	// A key that bubbled to a container was the leaf's to move, so the container, which reports no
	// path, leaves it to its own `runCommand` and moves nothing.
	it('moves nothing at a container a key bubbled up to', () => {
		const reorder = mover();
		const overrides = normalizeKeybindingOverrides([
			{ chord: 'Mod+Shift+ArrowUp', command: 'block.moveUp' }
		]);
		const runCommand = vi.fn(() => false);

		const ctx = commandContextWith(overrides, { reorder });
		expect(dispatchKindCommand('Mod+Shift+ArrowUp', { kind: 'listItem', runCommand }, ctx)).toBe(
			false
		);

		expect(reorder.nudgeReorderUnit).not.toHaveBeenCalled();
		expect(runCommand).toHaveBeenCalledWith('block.moveUp', undefined);
	});

	it('moves nothing in reading mode', () => {
		const reorder = mover();
		const ctx = commandContext({ reorder, getPresentationMode: () => 'reading' });

		expect(dispatchKeyCommand('Alt+ArrowUp', { kind: 'paragraph', getPath: () => [1] }, ctx)).toBe(
			false
		);

		expect(reorder.nudgeReorderUnit).not.toHaveBeenCalled();
	});

	// A block with no command bodies of its own can still move, and can do nothing else.
	it('answers canRunCommand from the path, not from a runCommand', () => {
		const pathOnly: KindCommandTarget = { kind: 'thematicBreak', getPath: () => [3] };

		expect(canRunCommandById('block.moveUp', pathOnly, commandContext())).toBe(true);
		expect(canRunCommandById('block.split', pathOnly, commandContext())).toBe(false);
		expect(canRunCommandById('block.moveUp', { kind: 'thematicBreak' }, commandContext())).toBe(
			false
		);
	});
});
