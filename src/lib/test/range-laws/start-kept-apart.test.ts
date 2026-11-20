// @vitest-environment jsdom
// A range that starts in a block's text and takes the blank line under it leaves that block a blank
// line apart from what followed the range, where flush the two would read as one block. Every
// removal route, both modes: Backspace, Delete, a cut, a typed key, a composition, a one-line paste
// and Enter. Without that blank line the pair still runs on, and so does the end's own rest.
// Miss-analysis: no mounted row took the blank line under the start's block, so a paragraph flush
// under a heading the range took ran on into the paragraph above and nothing failed.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	clipboardGesture,
	deleteGesture,
	mountCase,
	pasteGesture,
	placeRange,
	typeGesture,
	type Editor
} from './gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(destroyMountedEditors);

interface Row {
	name: string;
	marked: string;
	/** What Backspace, Delete and a cut leave, and that with `x` typed after. */
	removed: string;
	lettered: string;
	/** What a typed `Q`, a composed one and a pasted one leave. */
	written: string;
	/** What Enter leaves. */
	broken: string;
}

const KEPT_APART: Row[] = [
	{
		name: 'over a heading',
		marked: 'a⟦ b\n\n## h⟧\nc d\n',
		removed: 'a\n\nc d\n',
		lettered: 'ax\n\nc d\n',
		written: 'aQ\n\nc d\n',
		broken: 'a\n\n\nc d\n'
	},
	{
		name: 'in a quote',
		marked: '> a⟦ b\n\n## h⟧\nc d\n',
		removed: '> a\n\nc d\n',
		lettered: '> ax\n\nc d\n',
		written: '> aQ\n\nc d\n',
		broken: '> a\n>\n>\n\nc d\n'
	},
	{
		name: 'in an item',
		marked: '- a⟦ b\n\n## h⟧\nc d\n',
		removed: '- a\n\nc d\n',
		lettered: '- ax\n\nc d\n',
		written: '- aQ\n\nc d\n',
		broken: '- a\n- \n\nc d\n'
	},
	{
		name: 'over a fence',
		marked: 'a⟦ b\n\n```\nx\n```⟧\nc d\n',
		removed: 'a\n\nc d\n',
		lettered: 'ax\n\nc d\n',
		written: 'aQ\n\nc d\n',
		broken: 'a\n\n\nc d\n'
	},
	{
		name: 'to an empty line',
		marked: 'a\n\nb⟦*foo*\n\n⟧\nc\n',
		removed: 'a\n\nb\n\nc\n',
		lettered: 'a\n\nbx\n\nc\n',
		written: 'a\n\nbQ\n\nc\n',
		broken: 'a\n\nb\n\n\nc\n'
	},
	{
		name: 'to a line of spaces, CRLF',
		marked: 'a\r\n\r\nb⟦*foo*\r\n\r\n⟧  \r\nc\r\n',
		removed: 'a\r\n\r\nb  \r\n\r\nc\r\n',
		lettered: 'a\r\n\r\nbx  \r\n\r\nc\r\n',
		written: 'a\r\n\r\nbQ  \r\n\r\nc\r\n',
		broken: 'a\r\n\r\nb\r\n\r\n  \r\nc\r\n'
	},
	{
		name: 'to an empty quote line',
		marked: '> a\n>\n> b⟦*foo*\n>\n> ⟧\n> c\n',
		removed: '> a\n>\n> b\n>\n> c\n',
		lettered: '> a\n>\n> bx\n>\n> c\n',
		written: '> a\n>\n> bQ\n>\n> c\n',
		broken: '> a\n>\n> b\n>\n>\n> c\n'
	}
];

/** Rows the rule doesn't reach, which must not move. */
const RUNNING_ON: Row[] = [
	{
		name: 'a start flush over the heading',
		marked: 'a⟦ b\n## h⟧\nc d\n',
		removed: 'a\nc d\n',
		lettered: 'ax\nc d\n',
		written: 'aQ\nc d\n',
		broken: 'a\n\nc d\n'
	},
	{
		name: 'a blank line further into the range',
		marked: 'a⟦ b\n## h\n\nmid\n## k⟧\nc d\n',
		removed: 'a\nc d\n',
		lettered: 'ax\nc d\n',
		written: 'aQ\nc d\n',
		broken: 'a\n\nc d\n'
	},
	// The rule reads the start's side only: an end leaf's rest in a held block's place runs on.
	{
		name: 'a rest flush under the block above',
		marked: 'first\n⟦***\n\npa⟧ra\n',
		removed: 'first\nra\n',
		lettered: 'first\nxra\n',
		written: 'first\nQra\n',
		broken: 'first\n\nra\n'
	},
	{
		name: 'the line a range emptied',
		marked: 'first\n\n⟦zero\n\npara⟧\n\nnext\n',
		removed: 'first\n\n\nnext\n',
		lettered: 'first\n\nx\n\nnext\n',
		written: 'first\n\nQ\n\nnext\n',
		broken: 'first\n\n\n\nnext\n'
	},
	{
		name: 'the end’s rest joining mid-word',
		marked: 'alpha ⟦bravo\n\ncharlie ⟧delta\n',
		removed: 'alpha delta\n',
		lettered: 'alpha xdelta\n',
		written: 'alpha Qdelta\n',
		broken: 'alpha \n\ndelta\n'
	},
	{
		name: 'the end’s rest from its start',
		marked: 'a⟦ b\n\n⟧c d\n',
		removed: 'ac d\n',
		lettered: 'axc d\n',
		written: 'aQc d\n',
		broken: 'a\n\nc d\n'
	},
	{
		name: 'the end’s rest past a heading',
		marked: 'a⟦ b\n\n## h\n\nc⟧ d\n',
		removed: 'a d\n',
		lettered: 'ax d\n',
		written: 'aQ d\n',
		broken: 'a\n\n d\n'
	}
];

type Route = (editor: Editor) => Promise<unknown>;

const REMOVALS: [string, Route][] = [
	['Backspace', (e) => deleteGesture(e, 'Backspace')],
	['Delete', (e) => deleteGesture(e, 'Delete')],
	['a cut', (e) => clipboardGesture(e, 'cut', 'key')]
];

const WRITES: [string, Route][] = [
	['a typed key', (e) => typeGesture(e, { text: 'Q', route: 'hardware key' })],
	['a composition', (e) => typeGesture(e, { text: 'Q', route: 'composition' })],
	['a one-line paste', (e) => pasteGesture(e, { 'text/plain': 'Q' }, 'key')]
];

/** An editor holding `marked` with its `⟦⟧` range placed. */
async function mounted(marked: string, mode: PresentationMode): Promise<Editor> {
	const editor = mountCase(marked.replace(/[⟦⟧]/g, ''), mode);
	await editor.settle();
	const layout = documentLayout(measured(editor.instance.__test.getDocument()));
	const at = (byte: number) => {
		const point = layout.pointAt(byte);
		if (point) return { path: point.path, offset: point.offset };
		const block = [...layout.within(byte, byte)].find((b) => b.from === byte && !b.container);
		return { path: block!.path, offset: 0 };
	};
	const range = { anchor: at(marked.indexOf('⟦')), focus: at(marked.indexOf('⟧') - 1) };
	expect(await placeRange(editor, range)).toBe(true);
	return editor;
}

for (const [group, rows] of [
	['keeps the start apart', KEPT_APART],
	['runs on', RUNNING_ON]
] as const)
	describe(`a removal ${group}`, () => {
		for (const mode of ['source', 'live'] as const)
			for (const row of rows) {
				for (const [route, run] of REMOVALS)
					it(`${mode}, ${route}: ${row.name}`, async () => {
						const editor = await mounted(row.marked, mode);
						await run(editor);
						expect(editor.source()).toBe(row.removed);
						await pressHardwareKey(document.activeElement as HTMLElement, { key: 'x' });
						await editor.settle();
						expect(editor.source()).toBe(row.lettered);
						expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
					});
				for (const [route, run] of WRITES)
					it(`${mode}, ${route}: ${row.name}`, async () => {
						const editor = await mounted(row.marked, mode);
						await run(editor);
						expect(editor.source()).toBe(row.written);
						expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
					});
				it(`${mode}, Enter: ${row.name}`, async () => {
					const editor = await mounted(row.marked, mode);
					await typeGesture(editor, { key: 'Enter' });
					expect(editor.source()).toBe(row.broken);
					expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
				});
			}
	});
