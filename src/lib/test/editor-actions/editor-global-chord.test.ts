import { describe, it, expect, vi } from 'vitest';
import {
	handleEditorGlobalChord,
	type EditorGlobalChordDeps
} from '$lib/editor-actions/container-block-component';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import type { AnyBlockKind } from '$lib/core/nodes';

// The arm a block that IS its own focus target carries: no inner leaf runs the global tier
// for it, and the editor root declines while focus sits on the block itself.

function makeDeps(overrides?: Parameters<typeof normalizeKeybindingOverrides>[0]) {
	const requestUndo = vi.fn();
	const requestRedo = vi.fn();
	const compiled = normalizeKeybindingOverrides(overrides);
	const deps: EditorGlobalChordDeps = {
		getKind: () => 'thematicBreak' as AnyBlockKind,
		history: { requestUndo, requestRedo },
		getKeybindingOverrides: () => compiled,
		isReading: () => false
	};
	return { deps, requestUndo, requestRedo };
}

describe('handleEditorGlobalChord', () => {
	it.each([
		['Mod+Z', 'undo'],
		['Mod+Shift+Z', 'redo'],
		['Mod+Y', 'redo']
	] as const)('%s runs %s and reports the chord consumed', (chord, which) => {
		const { deps, requestUndo, requestRedo } = makeDeps();
		expect(handleEditorGlobalChord(chord, deps)).toBe(true);
		expect(which === 'undo' ? requestUndo : requestRedo).toHaveBeenCalledTimes(1);
	});

	// Declining is what lets the caller fall through to its kind keymap and key tail.
	it.each(['Mod+M', 'Alt+ArrowUp', 'Backspace', 'Mod+Alt+Z'])('declines %s', (chord) => {
		const { deps, requestUndo, requestRedo } = makeDeps();
		expect(handleEditorGlobalChord(chord, deps)).toBe(false);
		expect(requestUndo).not.toHaveBeenCalled();
		expect(requestRedo).not.toHaveBeenCalled();
	});

	// Consumed, not declined: without it a read-only document gets the browser's native undo.
	it('consumes the chord in reading mode but runs nothing', () => {
		const { deps, requestUndo } = makeDeps();
		expect(handleEditorGlobalChord('Mod+Z', { ...deps, isReading: () => true })).toBe(true);
		expect(requestUndo).not.toHaveBeenCalled();
	});

	it('honors a consumer override that disables the chord', () => {
		const { deps, requestUndo } = makeDeps([{ chord: 'Mod+Z', command: null }]);
		expect(handleEditorGlobalChord('Mod+Z', deps)).toBe(true);
		expect(requestUndo).not.toHaveBeenCalled();
	});

	it('honors a consumer override that remaps the chord to another global command', () => {
		const { deps, requestUndo, requestRedo } = makeDeps([
			{ chord: 'Mod+Z', command: 'history.redo' }
		]);
		expect(handleEditorGlobalChord('Mod+Z', deps)).toBe(true);
		expect(requestRedo).toHaveBeenCalledTimes(1);
		expect(requestUndo).not.toHaveBeenCalled();
	});
});
