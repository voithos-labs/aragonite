// @vitest-environment jsdom
// A plugin container runs a global chord (undo) only while it holds focus as a whole. A chord
// bubbling up from a block inside it already ran there, so running it again would undo twice.
// Miss-analysis: every undo test pressed the chord with focus on the container itself.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { dispatchKey } from '../harness/settle';
import { mountOpaque, registerOpaqueKind, type MountedOpaque } from './fixtures/opaque-container';

let mounted: MountedOpaque | null = null;

beforeEach(() => {
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
	registerOpaqueKind();
});

afterEach(async () => {
	await mounted?.dispose();
	mounted = null;
	document.body.innerHTML = '';
	resetPluginPlatformForTests();
});

function mountWithHistory() {
	const history = { requestUndo: vi.fn(), requestRedo: vi.fn() };
	mounted = mountOpaque({ history });
	return history;
}

describe('a global chord at a plugin container', () => {
	it('runs once when the container holds focus as a whole', () => {
		const history = mountWithHistory();
		mounted!.containerApi.focus(0);
		flushSync();

		dispatchKey(document.activeElement!, { key: 'z', ctrlKey: true });

		expect(history.requestUndo).toHaveBeenCalledTimes(1);
	});

	it('leaves a chord bubbling from a block inside it to that block', () => {
		const history = mountWithHistory();
		const inner = document.createElement('div');
		inner.contentEditable = 'true';
		mounted!.box.appendChild(inner);
		inner.focus();

		dispatchKey(inner, { key: 'z', ctrlKey: true });

		expect(history.requestUndo).not.toHaveBeenCalled();
	});
});
