// @vitest-environment jsdom
// What a `presentationMode` switch means for the host calls and menus around it: a call acts in
// the mode just asked for (the outgoing mode is held only while the switch commits its edits), a
// menu closes, and `insertMarkdown` answers true only when bytes moved.

// Miss-analysis: every mode-switch test settled between the prop write and the next call, so a
// mode that followed the prop one flush late read correctly in all of them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerDefaultContextActions } from '$lib/components/menu/default-context-actions';
import type { PresentationMode } from '$lib/presentation-mode';

beforeEach(() => {
	resetPluginPlatformForTests();
	installLayoutStubs();
});

afterEach(async () => {
	await destroyMountedEditors();
	resetPluginPlatformForTests();
});

/** An editor holding `paraXX\n`, whose last edit (the `XX`) is on the undo stack. */
async function editedEditor(mode: PresentationMode = 'source') {
	const mounted = mountEditor({ source: 'para\n' });
	await mounted.settle();
	placeCaret(surfaceAt(mounted, [0]), 4);
	expect(await mounted.instance.insertMarkdown('XX')).toBe(true);
	await mounted.settle();
	if (mode !== 'source') {
		mounted.props.presentationMode = mode;
		await mounted.settle();
	}
	return mounted;
}

describe('a call in the same task as a mode switch', () => {
	it('insertMarkdown right after switching to reading writes nothing and answers false', async () => {
		const mounted = mountEditor({ source: 'para\n' });
		await mounted.settle();
		placeCaret(surfaceAt(mounted, [0]), 4);

		mounted.props.presentationMode = 'reading';
		const inserted = await mounted.instance.insertMarkdown('XX');
		await mounted.settle();

		expect(inserted).toBe(false);
		expect(mounted.source()).toBe('para\n');
	});

	it('an undo right after switching to reading is refused', async () => {
		const mounted = await editedEditor();

		mounted.props.presentationMode = 'reading';
		const ran = mounted.instance.runCommand('history.undo');
		await mounted.settle();

		expect(ran).toBe(false);
		expect(mounted.source()).toBe('paraXX\n');
	});

	it('an undo right after switching out of reading runs', async () => {
		const mounted = await editedEditor('reading');

		mounted.props.presentationMode = 'source';
		const ran = mounted.instance.runCommand('history.undo');
		await mounted.settle();

		expect(ran).toBe(true);
		expect(mounted.source()).toBe('para\n');
	});
});

// Miss-analysis: the block menu was the one editor menu no mode switch closed, and no test left
// a menu open across a switch (#517's route).
describe('a menu open across a switch to reading', () => {
	it('closes, so none of its rows is offered in reading mode', async () => {
		registerDefaultContextActions();
		const mounted = mountEditor({ source: '```\ncode\n```\n\nprose\n' });
		await mounted.settle();
		const fence = mounted.target.querySelector('pre') ?? surfaceAt(mounted, [0]);
		fence.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await mounted.settle();
		expect(document.querySelector('[role="menu"]'), 'the block menu opened').not.toBeNull();

		mounted.props.presentationMode = 'reading';
		await mounted.settle();

		expect(document.querySelector('[role="menu"]')).toBeNull();
	});
});

// Miss-analysis: every insertMarkdown test either wrote or was refused before its first await,
// so `true` never had to mean that bytes moved.
describe('insertMarkdown across a switch to reading', () => {
	it('answers false when the switch lands before its write, which is refused', async () => {
		const mounted = mountEditor({ source: 'para\n' });
		await mounted.settle();
		placeCaret(surfaceAt(mounted, [0]), 4);

		const inserting = mounted.instance.insertMarkdown('XX');
		mounted.props.presentationMode = 'reading';
		const inserted = await inserting;
		await mounted.settle();

		expect(mounted.source()).toBe('para\n');
		expect(inserted).toBe(false);
	});
});
