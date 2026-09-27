import { describe, it, expect, vi } from 'vitest';
import { runGlobalChordOnKind } from '$lib/schema/commands';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import type { AnyBlockKind } from '$lib/core/nodes';
import type { CommandDispatchContext } from '$lib/schema/block-commands';
import { commandContextWith } from '../support/command-context';

// The handler a block focused as a whole carries: no inner leaf runs the global chords for
// it, and the editor root declines while focus sits on the block itself.
//
// Miss-analysis for the rebind cases below: every override case here re-pointed a chord the
// built-in table already owned, so the handler's first check answered true for reasons that
// had nothing to do with the override, and its blindness to overrides was invisible.

function makeDeps(overrides?: Parameters<typeof normalizeKeybindingOverrides>[0]) {
	const requestUndo = vi.fn();
	const requestRedo = vi.fn();
	// No plugins stood up here, so every installed one is active.
	const deps = commandContextWith(normalizeKeybindingOverrides(overrides), {
		history: { requestUndo, requestRedo }
	});
	return { deps, requestUndo, requestRedo };
}

const atWholeBlock = (chord: string, ctx: CommandDispatchContext) =>
	runGlobalChordOnKind(chord, 'thematicBreak' as AnyBlockKind, ctx);

describe('the global chords at a block focused as a whole', () => {
	it.each([
		['Mod+Z', 'undo'],
		['Mod+Shift+Z', 'redo'],
		['Mod+Y', 'redo']
	] as const)('%s runs %s and reports the chord consumed', (chord, which) => {
		const { deps, requestUndo, requestRedo } = makeDeps();
		expect(atWholeBlock(chord, deps)).toBe(true);
		expect(which === 'undo' ? requestUndo : requestRedo).toHaveBeenCalledTimes(1);
	});

	// Declining is what lets the caller fall through to its kind keymap and key handling.
	it.each(['Mod+M', 'Alt+ArrowUp', 'Backspace', 'Mod+Alt+Z'])('declines %s', (chord) => {
		const { deps, requestUndo, requestRedo } = makeDeps();
		expect(atWholeBlock(chord, deps)).toBe(false);
		expect(requestUndo).not.toHaveBeenCalled();
		expect(requestRedo).not.toHaveBeenCalled();
	});

	// Consumed, not declined: without it a read-only document gets the browser's native undo.
	it('consumes the chord in reading mode but runs nothing', () => {
		const { deps, requestUndo } = makeDeps();
		expect(atWholeBlock('Mod+Z', { ...deps, getPresentationMode: () => 'reading' })).toBe(true);
		expect(requestUndo).not.toHaveBeenCalled();
	});

	it('honors a consumer override that disables the chord', () => {
		const { deps, requestUndo } = makeDeps([{ chord: 'Mod+Z', command: null }]);
		expect(atWholeBlock('Mod+Z', deps)).toBe(true);
		expect(requestUndo).not.toHaveBeenCalled();
	});

	it('honors a consumer override that remaps the chord to another global command', () => {
		const { deps, requestUndo, requestRedo } = makeDeps([
			{ chord: 'Mod+Z', command: 'history.redo' }
		]);
		expect(atWholeBlock('Mod+Z', deps)).toBe(true);
		expect(requestRedo).toHaveBeenCalledTimes(1);
		expect(requestUndo).not.toHaveBeenCalled();
	});

	it('runs a global rebind onto a chord the built-in table does not own', () => {
		const { deps, requestUndo } = makeDeps([{ chord: 'Mod+J', command: 'history.undo' }]);
		expect(atWholeBlock('Mod+J', deps)).toBe(true);
		expect(requestUndo).toHaveBeenCalledTimes(1);
	});

	it('runs the same rebind scoped to this kind', () => {
		const { deps, requestUndo } = makeDeps([
			{ chord: 'Mod+J', command: 'history.undo', kind: 'thematicBreak' as AnyBlockKind }
		]);
		expect(atWholeBlock('Mod+J', deps)).toBe(true);
		expect(requestUndo).toHaveBeenCalledTimes(1);
	});

	// A kind keymap binding is not this handler's business: it declines so the caller's own
	// dispatch runs it.
	it('declines a chord the kind keymap binds, leaving it to the kind dispatch', () => {
		const { deps, requestUndo, requestRedo } = makeDeps();
		expect(atWholeBlock('Alt+ArrowUp', deps)).toBe(false);
		expect(requestUndo).not.toHaveBeenCalled();
		expect(requestRedo).not.toHaveBeenCalled();
	});
});
