// @vitest-environment jsdom
// A gesture's undo entry stays open until its own editor's author types, whatever happens
// elsewhere on the page.
// Miss-analysis (GH #520): no mounted test put a second editor beside the first.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { UndoEntry } from '#lib/undo/types.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());

afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

function undoStack(editor: MountedEditor): UndoEntry[] {
	return (
		editor.instance as unknown as { __test: { getUndoStack(): { undo: UndoEntry[] } } }
	).__test.getUndoStack().undo;
}

/** An insert below the focused block: a new paragraph, then the paste into it, one entry. */
async function insertBelowWhile(editor: MountedEditor, meanwhile: () => void): Promise<void> {
	placeCaret(surfaceAt(editor, [0]), 3);
	const inserting = editor.instance.insertMarkdown('x', { placement: 'below' });
	meanwhile();
	await inserting;
	await editor.settle();
}

function keydownOn(el: HTMLElement): void {
	el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true }));
}

describe('the author-input end of an open undo entry', () => {
	it('ignores input in another editor on the page', async () => {
		const first = mountEditor({ source: 'one\n' });
		const second = mountEditor({ source: 'two\n' });

		await insertBelowWhile(first, () => keydownOn(surfaceAt(second, [0])));

		expect(first.source()).toBe('one\n\nx\n');
		expect(undoStack(first)).toHaveLength(1);
	});

	it('still ends at input in its own editor', async () => {
		const first = mountEditor({ source: 'one\n' });

		await insertBelowWhile(first, () => keydownOn(surfaceAt(first, [0])));

		expect(first.source()).toBe('one\n\nx\n');
		expect(undoStack(first)).toHaveLength(2);
	});
});
