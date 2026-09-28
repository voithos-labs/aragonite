// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { handleSharedKeydown, type SharedKeydownContext } from '$lib/selection/shared-keydown';
import type { CrossBlockHandlers } from '$lib/selection/cross-block/dispatch';
import type { FocusActions } from '$lib/action-contracts';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { makeCaretMemory } from '$lib/test/harness/editor-actions';
import { registerGlobalCommand } from '$lib/schema/global-commands';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';
import { commandContext } from '$lib/test/support/command-context';

// The shared keydown must prevent a plugin-global chord's default yet return false, so the block's
// own `dispatchKeyCommand` still runs it; true would swallow every plugin-global chord.

const noCross: CrossBlockHandlers = {
	handleKeyDown: async () => false,
	handlePointerDown: () => false,
	handlePaste: async () => false,
	handleBeforeInput: async () => false,
	insertText: async () => false,
	handleCompositionStart: () => false,
	performCrossBlockDeleteFromEvent: async () => {}
};

function makeCtx(): SharedKeydownContext {
	const el = document.createElement('div');
	return {
		// No plugins stood up here, so every installed one is active.
		commands: commandContext(),
		reading: fixtureReading(),
		getEl: () => el,
		getCursorOffset: () => 0,
		getFocusOffset: () => null,
		getTextLen: () => 0,
		getMyPath: () => [0],
		getIndex: () => 0,
		crossBlock: noCross,
		selection: createSelectionState(),
		caretMemory: makeCaretMemory(),
		history: { requestUndo() {}, requestRedo() {} } as unknown as SharedKeydownContext['history'],
		focus: {} as FocusActions,
		getDoc: () => ({ kind: 'document', children: [] }) as never,
		getBlockElByPath: () => null
	};
}

const keydown = (over: KeyboardEventInit): KeyboardEvent =>
	new KeyboardEvent('keydown', { cancelable: true, ...over });

describe('handleSharedKeydown: plugin-global chord deferral', () => {
	it('preventDefaults a plugin-global chord and returns false so the surface dispatch runs', async () => {
		registerGlobalCommand('demo.chord', () => true, { chord: 'Mod+Shift+7' });
		const e = keydown({ key: '7', ctrlKey: true, shiftKey: true });

		const handled = await handleSharedKeydown(e, makeCtx());

		expect(handled).toBe(false);
		expect(e.defaultPrevented).toBe(true);
	});

	it('leaves an unregistered chord alone: the preventDefault is gated on the predicate', async () => {
		const e = keydown({ key: '7', ctrlKey: true, shiftKey: true });

		const handled = await handleSharedKeydown(e, makeCtx());

		expect(handled).toBe(false);
		expect(e.defaultPrevented).toBe(false);
	});

	// A disabled history chord is still swallowed, since its native default edits behind the CST.
	// Miss-analysis: the file pressed plugin-global chords only, never the built-in history ones.
	it.each(['Mod+Z', 'Mod+Y', 'Mod+Shift+Z'])(
		'%s is preventDefaulted and deferred to the block dispatch',
		async (chord) => {
			const shiftKey = chord.includes('Shift');
			const key = chord.endsWith('Z') ? (shiftKey ? 'Z' : 'z') : 'y';
			const e = keydown({ key, ctrlKey: true, shiftKey });

			const handled = await handleSharedKeydown(e, makeCtx());

			expect(handled).toBe(false);
			expect(e.defaultPrevented).toBe(true);
		}
	);
});
