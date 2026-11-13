// @vitest-environment jsdom
// A paste over a range across blocks is the removal typing makes there, then the paste, both
// answered before either commits: the removal goes only with a paste to land, and a write that
// comes between the two (a listener to the removal's edit) leaves the paste unlanded.
// Miss-analysis: the pair committed its removal before it asked where the paste went, and every
// row pasted into an editor no listener wrote to between the two commits.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
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

/** Set to make the core's answer for a paste throw, as a defect in the paste half would. */
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
const REMOVED = 'alma\n';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
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
	it('reaches a listener as the removal and then the paste, and one undo takes both back', async () => {
		const { editor, ops } = await heldOverBlocks();
		expect(await editor.instance.insertMarkdown('X')).toBe(true);
		await editor.settle();
		expect(sourceOf(editor)).toBe('alXma\n');
		expect(ops).toEqual(['delete', 'paste']);
		await runHistory(editor, 'undo');
		expect(sourceOf(editor)).toBe(SOURCE);
	});

	it('lands nowhere once a listener to the removal writes, which keeps its own write', async () => {
		const { editor, ops } = await heldOverBlocks();
		editor.instance.getEvents().on('edit', (event) => {
			if (event.op === 'delete')
				void editor.instance.edit().replace({ from: 0, to: 0 }, '!').commit();
		});
		await editor.instance.insertMarkdown('X');
		await editor.settle();
		expect(sourceOf(editor)).toBe(`!${REMOVED}`);
		expect(ops).not.toContain('paste');
		expect(ops[0]).toBe('delete');
	});

	it('lands nowhere once a listener to the removal turns reading mode on', async () => {
		const { editor, ops } = await heldOverBlocks();
		editor.instance.getEvents().on('edit', (event) => {
			if (event.op === 'delete') editor.props.presentationMode = 'reading';
		});
		await editor.instance.insertMarkdown('X');
		await editor.settle();
		expect(sourceOf(editor)).toBe(REMOVED);
		expect(ops).toEqual(['delete']);
		takeDevWarns();
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
