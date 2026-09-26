// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { handleSharedKeydown, type SharedKeydownContext } from '$lib/selection/shared-keydown';
import type { CrossBlockHandlers } from '$lib/selection/cross-block/dispatch';
import type { FocusActions } from '$lib/action-contracts';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { makeCaretMemory } from '$lib/test/harness/editor-actions';
import { registerGlobalCommand } from '$lib/schema/global-commands';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';

// The shared keydown that runs before every editable block's own dispatch. A plugin-global chord
// must have its default prevented and still be deferred (return false) so the block's own
// `dispatchKeyCommand` runs it; a `return true` here would swallow every plugin-global chord with
// no other test failing.

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
		activePlugins: everyInstalledPlugin,
		reading: fixtureReading(),
		getEl: () => el,
		getCursorOffset: () => 0,
		getFocusOffset: () => null,
		getAmbientLength: () => 0,
		getTextLen: () => 0,
		getMyPath: () => [0],
		getIndex: () => 0,
		crossBlock: noCross,
		selection: createSelectionState(),
		caretMemory: makeCaretMemory(),
		getKeybindingOverrides: () => normalizeKeybindingOverrides([]),
		history: { requestUndo() {}, requestRedo() {} } as unknown as SharedKeydownContext['history'],
		focus: {} as FocusActions,
		getDoc: () => ({ kind: 'document', children: [] }) as never,
		getBlockElByPath: () => null
	};
}

const keydown = (over: KeyboardEventInit): KeyboardEvent =>
	new KeyboardEvent('keydown', { cancelable: true, ...over });

beforeEach(() => {
	__resetSchemaRegistriesForTests();
});

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

	// The swallow the consumer guide promises: a disabled history chord runs nothing and is still
	// consumed, because the native default it would fall through to rewrites the document behind
	// the CST's back. This branch reads the default chord table, so it swallows before any
	// override is consulted, whatever the override left the chord bound to.
	// Miss-analysis: the file drove plugin-global chords only, so the branch's own reason for
	// existing, the three built-in history chords, was never pressed at this level.
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
