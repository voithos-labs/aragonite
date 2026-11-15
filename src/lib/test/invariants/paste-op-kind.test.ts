// @vitest-environment jsdom
// G2.9: every paste reaches an `edit` listener as one `paste` op whose count is the blocks it
// landed as, whichever commit took it, and a range across blocks is removed first. A cell's rows
// are in `blocks/table/cell-paste-routing.test.ts`.
// Miss-analysis: these rows drove the dispatcher the range-edit core replaced, so they held the
// three op kinds it emitted and nothing read the op a paste in a running editor names.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange, PASTE_ROUTES } from '../range-laws/gestures';

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

/** Each op an `edit` listener hears, with its detail, for `clip` pasted over `⟦…⟧` or at `‸`. */
async function opsOf(marked: string, clip: string, route = PASTE_ROUTES[0]): Promise<unknown[]> {
	const source = marked.replace(/[‸⟦⟧]/g, '');
	const editor = mountCase(source, 'source');
	await editor.settle();
	const doc = measured(editor.instance.__test.getDocument());
	const from = marked.indexOf('‸') >= 0 ? marked.indexOf('‸') : marked.indexOf('⟦');
	const to = marked.indexOf('⟧') >= 0 ? marked.indexOf('⟧') - 1 : from;
	const range = { anchor: pointAtByte(doc, from)!, focus: pointAtByte(doc, to)! };
	expect(await placeRange(editor, range)).toBe(true);
	const ops: unknown[] = [];
	editor.instance.getEvents().on('edit', (event) => ops.push([event.op, event.detail]));
	await pasteGesture(editor, { 'text/plain': clip }, route);
	expect(editor.source()).not.toBe(source);
	return ops;
}

describe('G2.9 a paste is one `paste` op', () => {
	it.each([
		['text in a top-level block, its own write', 'abc‸def\n', 'x', 0],
		['text in a quoted block, a byte splice', '> abc‸def\n', 'x', 0],
		['blocks mid-paragraph', 'abc‸def\n', 'one\n\ntwo', 2],
		['a block on an empty line', 'abc\n\n‸\n', '# h', 1],
		['text over a range inside one block', 'a⟦bc⟧def\n', 'x', 0]
	])('%s', async (_, marked, clip, count) => {
		expect(await opsOf(marked, clip)).toEqual([['paste', { count }]]);
	});

	it.each(PASTE_ROUTES)('by the %s route', async (route) => {
		expect(await opsOf('abc‸def\n', 'one\n\ntwo', route)).toEqual([['paste', { count: 2 }]]);
	});

	it('over a range across blocks, the removal’s `delete` comes first', async () => {
		const ops = await opsOf('al⟦pha\n\nbe⟧ta\n', 'x');
		expect(ops).toEqual([
			['delete', { crossBlock: true }],
			['paste', { count: 0 }]
		]);
	});
});
