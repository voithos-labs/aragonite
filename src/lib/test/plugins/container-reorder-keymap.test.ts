// @vitest-environment jsdom
// A plugin container focused as a whole moves on whatever chords the keymap binds to
// `block.moveUp` and `block.moveDown`, a consumer's `keybindings` included.
// Miss-analysis: every reorder test pressed the default Alt+Arrow, never a rebound chord.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { installEditorDomStubsForTests } from '$lib/testing';
import {
	normalizeKeybindingOverrides,
	type KeybindingOverride
} from '$lib/schema/keybinding-overrides';
import type { EditorServices } from '$lib/editor-keys';
import { dispatchKey } from '../harness/settle';
import { mountOpaque, registerOpaqueKind, type MountedOpaque } from './fixtures/opaque-container';

let mounted: MountedOpaque | null = null;

beforeEach(() => {
	installEditorDomStubsForTests();
	registerOpaqueKind();
});

afterEach(async () => {
	await mounted?.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

/** Mounts the fixture focused as a whole, with `keybindings` compiled the way the editor does. */
function mountFocused(
	keybindings: KeybindingOverride[] = [],
	presentationMode: 'source' | 'reading' = 'source'
) {
	const reorder = { nudgeReorderUnit: vi.fn(async () => {}), moveReorderUnit: vi.fn() };
	const compiled = normalizeKeybindingOverrides(keybindings);
	mounted = mountOpaque({
		services: { reorder: reorder as unknown as EditorServices['reorder'] },
		policies: { keybindingOverrides: () => compiled, presentationMode: () => presentationMode }
	});
	mounted.containerApi.focus(0);
	flushSync();
	const press = (init: KeyboardEventInit) => dispatchKey(document.activeElement!, init);
	return { nudge: reorder.nudgeReorderUnit, press };
}

describe('whole-block plugin container reorder chords', () => {
	it('moves on the default Alt+Arrow chords', () => {
		const { nudge, press } = mountFocused();

		expect(press({ key: 'ArrowUp', altKey: true }).defaultPrevented).toBe(true);
		press({ key: 'ArrowDown', altKey: true });

		expect(nudge.mock.calls).toEqual([
			[[0], -1],
			[[0], 1]
		]);
	});

	it('stays put when a consumer disables Alt+ArrowUp', () => {
		const { nudge, press } = mountFocused([{ chord: 'Alt+ArrowUp', command: null }]);

		press({ key: 'ArrowUp', altKey: true });

		expect(nudge).not.toHaveBeenCalled();
	});

	it('moves on a chord a consumer rebinds to block.moveUp', () => {
		const { nudge, press } = mountFocused([
			{ chord: 'Mod+Shift+ArrowUp', command: 'block.moveUp' }
		]);

		expect(press({ key: 'ArrowUp', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);

		expect(nudge).toHaveBeenCalledWith([0], -1);
	});

	it('moves nothing in reading mode', () => {
		const { nudge, press } = mountFocused([], 'reading');

		press({ key: 'ArrowUp', altKey: true });

		expect(nudge).not.toHaveBeenCalled();
	});
});
