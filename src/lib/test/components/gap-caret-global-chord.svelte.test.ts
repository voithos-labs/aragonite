// @vitest-environment jsdom
//
// The gap caret's proxy is focused DOM of its own, so the editor root's arm declines and this
// surface resolves the global tier itself. Miss-analysis: the gap caret had no keydown test at
// all, so the one surface whose whole reason for existing is "the root cannot answer here" was
// never asked what it does with a rebound global chord.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import GapCaret from '$lib/components/GapCaret.svelte';
import { normalizeKeybindingOverrides } from '$lib/schema/keybinding-overrides';
import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
import { editorMountContext } from '../harness/mount-context';

interface Mounted {
	proxy: HTMLElement;
	requestUndo: ReturnType<typeof vi.fn>;
	press(key: string, init?: KeyboardEventInit): KeyboardEvent;
	dispose(): void;
}

function mountGapCaret(overrides?: KeybindingOverride[]): Mounted {
	const requestUndo = vi.fn();
	const compiled = normalizeKeybindingOverrides(overrides);
	const target = document.createElement('div');
	document.body.append(target);
	const instance = mount(GapCaret, {
		target,
		props: { index: 0, focusActions: undefined, blockEdit: undefined },
		context: editorMountContext({
			history: { requestUndo, requestRedo: vi.fn() },
			policies: { keybindingOverrides: () => compiled }
		})
	});
	flushSync();
	const proxy = target.querySelector<HTMLElement>('.gap-caret-proxy')!;
	return {
		proxy,
		requestUndo,
		press(key, init) {
			const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
			proxy.dispatchEvent(event);
			return event;
		},
		dispose() {
			void unmount(instance);
			target.remove();
		}
	};
}

let mounted: Mounted | null = null;
afterEach(() => {
	mounted?.dispose();
	mounted = null;
});

describe('gap caret — global chord resolution', () => {
	it('runs the built-in undo chord and consumes the press', () => {
		mounted = mountGapCaret();
		const event = mounted.press('z', { ctrlKey: true });
		expect(mounted.requestUndo).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it('runs a rebind onto a chord the built-in table does not own', () => {
		mounted = mountGapCaret([{ chord: 'Mod+J', command: 'history.undo' }]);
		const event = mounted.press('j', { ctrlKey: true });
		expect(mounted.requestUndo).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	// The disable releases the command, never the press: native undo on the proxy would
	// bypass the CST stack entirely.
	it('consumes a disabled built-in chord and runs nothing', () => {
		mounted = mountGapCaret([{ chord: 'Mod+Z', command: null }]);
		const event = mounted.press('z', { ctrlKey: true });
		expect(mounted.requestUndo).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
	});

	it('leaves an unbound modified chord to whatever owns it above', () => {
		mounted = mountGapCaret();
		const event = mounted.press('j', { ctrlKey: true });
		expect(mounted.requestUndo).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});
});
