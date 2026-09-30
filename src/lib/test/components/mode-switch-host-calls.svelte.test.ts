// @vitest-environment jsdom
// What a `presentationMode` switch means for the host calls around it: a call acts in the mode
// just asked for (the outgoing mode is held only while the switch commits its edits), and
// `insertMarkdown` answers true only when bytes moved. `menu-close-all.test.ts` has the menus.

// Miss-analysis: every mode-switch test settled between the prop write and the next call.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import type { PresentationMode } from '$lib/presentation-mode';

beforeEach(() => {
	installLayoutStubs();
});

afterEach(async () => {
	await destroyMountedEditors();
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

// Miss-analysis: every insertMarkdown test wrote or was refused before its first await.
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
