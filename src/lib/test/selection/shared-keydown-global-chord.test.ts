// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { handleSharedKeydown, type SharedKeydownContext } from '$lib/selection/shared-keydown';
import type { CrossBlockHandlers } from '$lib/selection/cross-block/dispatch';
import type { FocusActions } from '$lib/action-contracts';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { makeStickyColumn, makeEdgeAffinity } from '$lib/test/harness/editor-actions';
import {
	registerGlobalCommand,
	__resetPluginGlobalCommandsForTests
} from '$lib/schema/global-commands';
import {
	__resetPluginGlobalKeymapForTests,
	__removePluginCommandsForTests
} from '$lib/schema/commands';
import { __resetMintedCommandIdsForTests } from '$lib/schema/command-id';

// The prelude that runs before every editable surface's own dispatch. A plugin-global chord must
// be preventDefaulted AND deferred (return false) so the surface's own dispatchKeyCommand runs it;
// a `return true` here would swallow every plugin-global chord with no other test failing.

const noCross: CrossBlockHandlers = {
	handleKeyDown: async () => false,
	handlePointerDown: () => false,
	handlePaste: async () => false,
	handleBeforeInput: async () => false,
	handleCompositionStart: () => false,
	performCrossBlockDeleteFromEvent: async () => {}
};

function makeCtx(): SharedKeydownContext {
	const el = document.createElement('div');
	return {
		getEl: () => el,
		getCursorOffset: () => 0,
		getFocusOffset: () => null,
		getAmbientLength: () => 0,
		getTextLen: () => 0,
		getMyPath: () => [0],
		getIndex: () => 0,
		crossBlock: noCross,
		selection: createSelectionState(),
		stickyColumn: makeStickyColumn(),
		edgeAffinity: makeEdgeAffinity(),
		history: { requestUndo() {}, requestRedo() {} } as unknown as SharedKeydownContext['history'],
		focus: {} as FocusActions,
		getDoc: () => ({ kind: 'document', children: [] }) as never,
		getBlockElByPath: () => null
	};
}

const keydown = (over: KeyboardEventInit): KeyboardEvent =>
	new KeyboardEvent('keydown', { cancelable: true, ...over });

beforeEach(() => {
	__resetPluginGlobalCommandsForTests();
	__resetPluginGlobalKeymapForTests();
	__removePluginCommandsForTests();
	__resetMintedCommandIdsForTests();
});

describe('handleSharedKeydown — plugin-global chord deferral', () => {
	it('preventDefaults a plugin-global chord and returns false so the surface dispatch runs', async () => {
		registerGlobalCommand('demo.chord', () => true, { chord: 'Mod+Shift+7' });
		const e = keydown({ key: '7', ctrlKey: true, shiftKey: true });

		const handled = await handleSharedKeydown(e, makeCtx());

		expect(handled).toBe(false);
		expect(e.defaultPrevented).toBe(true);
	});

	it('leaves an unregistered chord alone — the preventDefault is gated on the predicate', async () => {
		const e = keydown({ key: '7', ctrlKey: true, shiftKey: true });

		const handled = await handleSharedKeydown(e, makeCtx());

		expect(handled).toBe(false);
		expect(e.defaultPrevented).toBe(false);
	});

	// The swallow the consumer guide now promises: a disabled history chord runs nothing and is
	// still taken, because the native default it would fall through to rewrites the document past
	// the CST stack. This arm reads the DEFAULT table, so it swallows before any override is
	// consulted — which is why the press is consumed whatever the override left it bound to.
	// Miss-analysis: the file drove plugin-global chords only, so the arm's own reason for
	// existing — the three built-in history chords — was never pressed at this level.
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
