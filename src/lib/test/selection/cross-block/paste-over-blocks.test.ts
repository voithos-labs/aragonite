// @vitest-environment jsdom
// A paste over a range across blocks is one answer of the range-edit core: one commit, one `paste`
// edit, one undo step back to the range; a fault in that answer commits nothing.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gesture } from '#lib/range-edit/edit-range.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, placeRange, runHistory, type Editor } from '../../range-laws/gestures';

/** Set to make the core's answer for a paste throw, as a defect in it would. */
const fault = vi.hoisted(() => ({ paste: false }));

vi.mock('#lib/range-edit/edit-range.js', async (original) => {
	const actual = await original<typeof import('#lib/range-edit/edit-range.js')>();
	const editRange: typeof actual.editRange = (source, range, gesture: Gesture, mode, host) => {
		if (fault.paste && typeof gesture === 'object' && 'paste' in gesture)
			throw new Error('the paste half failed');
		return actual.editRange(source, range, gesture, mode, host);
	};
	return { ...actual, editRange };
});

const SOURCE = 'alpha\n\nbeta\n\ngamma\n';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	fault.paste = false;
	await destroyMountedEditors();
	takeDevWarns();
});

/** The editor holding a range from `alpha`'s third letter to `gamma`'s fourth, and the ops each
 *  `edit` it emits names, in order. */
async function heldOverBlocks(): Promise<{ editor: Editor; ops: string[] }> {
	const editor = mountCase(SOURCE, 'source');
	await editor.settle();
	await placeRange(editor, {
		anchor: { path: [0], offset: 2 },
		focus: { path: [2], offset: 3 }
	});
	const ops: string[] = [];
	editor.instance.getEvents().on('edit', (event) => ops.push(event.op));
	return { editor, ops };
}

const sourceOf = (editor: Editor) => editor.instance.getSource();

describe('a paste over a range across blocks', () => {
	it('reaches a listener as one paste, and one undo takes it back', async () => {
		const { editor, ops } = await heldOverBlocks();
		expect(await editor.instance.insertMarkdown('X')).toBe(true);
		await editor.settle();
		expect(sourceOf(editor)).toBe('alXma\n');
		expect(ops).toEqual(['paste']);
		await runHistory(editor, 'undo');
		expect(sourceOf(editor)).toBe(SOURCE);
	});

	it('commits nothing where the paste half fails', async () => {
		const { editor, ops } = await heldOverBlocks();
		fault.paste = true;
		await expect(editor.instance.insertMarkdown('X')).rejects.toThrow('the paste half failed');
		await editor.settle();
		expect(sourceOf(editor)).toBe(SOURCE);
		expect(ops).toEqual([]);
	});
});
