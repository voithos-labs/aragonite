// @vitest-environment jsdom
// The selection as a plugin reads it: document bytes, through a container's markers, and nothing
// for a cell selection or no selection.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

const DOC = 'intro\n\n> one\n> two three\n';

async function editorOn(source: string): Promise<{ editor: Editor; m: MountedEditor }> {
	let editor: Editor | undefined;
	const reader = definePluginUnit({
		name: 'unit-reader',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ setup: (e) => void (editor = e) })
	});
	const m = mountEditor({ source, plugins: [reader] });
	await m.settle();
	return { editor: editor!, m };
}

describe('Editor.selectedRange', () => {
	it("reads a caret and a range in document bytes, past a quote's marker", async () => {
		const { editor, m } = await editorOn(DOC);
		const quoted = surfaceAt(m, [1, 0]);
		const two = 'one\ntwo three\n'.indexOf('two');
		selectRange(quoted, two, two);
		await m.settle();
		expect(editor.selectedRange()).toEqual({ from: DOC.indexOf('two'), to: DOC.indexOf('two') });
		selectRange(quoted, two + 4, two);
		await m.settle();
		expect(editor.selectedRange()).toEqual({
			from: DOC.indexOf('two'),
			to: DOC.indexOf('two') + 4
		});
	});

	it('reads null with nothing selected', async () => {
		const { editor } = await editorOn(DOC);
		expect(editor.selectedRange()).toBeNull();
	});
});
