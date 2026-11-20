// @vitest-environment jsdom
// G1.219 for a paste: with the kept record holding a block's bytes from before a write that named
// no block, a paste reads its place and the document again from the tree, and a paste answered
// before such a write is refused; each tells the `error` channel once and lands nothing wrong.
// Miss-analysis: the record's rows ran over copies, removals and drafts, and the paste branch read
// its place and the document apart from them, so no row pasted beside a block the record held wrong.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { takeDevWarns, takeDevWarnsOf } from '#lib/test/support/warn-gate.js';
import { mountCase, placeRange, type Editor } from '../../range-laws/gestures';

const N = 12;
const SOURCE = Array.from({ length: N }, (_, i) => `line ${i}\n`).join('\n');
// Longer than the blocks below it, so an offset in it lies past them in the kept record.
const GROWN = 'LINE 2 grown well past the blocks that stand below it\n';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** An editor whose record is measured, its errors collected. */
async function measured(source: string): Promise<{ editor: Editor; errors: unknown[] }> {
	const editor = mountCase(source, 'source');
	await editor.settle();
	const errors: unknown[] = [];
	editor.instance.getEvents().on('error', (error) => errors.push(error));
	// A block past the first, whose start is a sum the record is measured for.
	void editor.instance.__test.byteOf([editor.instance.__test.getDocument().children.length - 1], 0);
	return { editor, errors };
}

/** Writes `raw` into top-level block `index` with no write announced. */
const writeUnannounced = (editor: Editor, index: number, raw: string) => {
	(editor.instance.__test.getDocument().children[index] as { raw: string }).raw = raw;
};

/** The record's guard fired, and no other guard did. */
const keptGuardAlone = () => {
	expect(takeDevWarnsOf('invariant:kept-starts-current')).not.toEqual([]);
	expect(takeDevWarns()).toEqual([]);
};

describe('G1.219 a paste beside a block the record holds wrong', () => {
	it.each([
		['text, written as the block’s own write', 'Q', 'Q'],
		['blocks, written as a splice', 'one\n\ntwo', 'one\n\ntwo']
	])('%s past the kept length of a grown block lands at the tree’s byte', async (_, md, text) => {
		const { editor, errors } = await measured(SOURCE);
		writeUnannounced(editor, 2, GROWN);
		await editor.settle();
		expect(
			await placeRange(editor, {
				anchor: { path: [2], offset: 30 },
				focus: { path: [2], offset: 30 }
			})
		).toBe(true);

		expect(await editor.instance.insertMarkdown(md)).toBe(true);
		await editor.settle();

		expect(editor.source()).toContain(`${GROWN.slice(0, 30)}${text}`);
		expect(editor.source()).toContain('line 3\n\nline 4\n');
		expect(errors).toHaveLength(1);
		keptGuardAlone();
	});

	it('a paste answered before a write that named no block is refused, which keeps that write', async () => {
		const { editor, errors } = await measured('alpha\n\nbeta\n\ngamma\n');
		await placeRange(editor, { anchor: { path: [0], offset: 2 }, focus: { path: [2], offset: 3 } });
		const ops: string[] = [];
		editor.instance.getEvents().on('edit', (event) => {
			ops.push(event.op);
			if (event.op === 'delete') writeUnannounced(editor, 0, 'ALMA\n');
		});

		await editor.instance.insertMarkdown('X');
		await editor.settle();

		expect(editor.source()).toBe('ALMA\n');
		expect(ops).toEqual(['delete']);
		expect(errors).toHaveLength(1);
		keptGuardAlone();
	});
});
