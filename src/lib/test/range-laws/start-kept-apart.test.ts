// @vitest-environment jsdom
// The two blocks a removal leaves touching stay a blank line apart where the range took a blank line
// right under the upper one or right over the lower one, and flush they would read as one block.
// Every removal route, both modes: Backspace, Delete, a cut, a typed key, a composition, a one-line
// paste and Enter. Flush on both sides of what the range took, the pair rejoins as prose.
// Miss-analysis: no mounted row took the blank line under the start's block, so a paragraph flush
// under a heading the range took ran on into the paragraph above and nothing failed; the lower side
// was pinned as running on, so a paragraph's rest ran into the paragraph above the range.
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
	},
	{
		name: 'a rest flush under the block above, past a divider',
		marked: 'first\n⟦***\n\npa⟧ra\n',
		removed: 'first\n\nra\n',
		lettered: 'first\n\nxra\n',
		written: 'first\n\nQra\n',
		broken: 'first\n\n\nra\n'
	},
	{
		name: 'a rest flush under the block above, past a fence',
		marked: 'Run this:\n⟦```sh\nnpm i\n```\n\nThen ⟧do that.\n',
		removed: 'Run this:\n\ndo that.\n',
		lettered: 'Run this:\n\nxdo that.\n',
		written: 'Run this:\n\nQdo that.\n',
		broken: 'Run this:\n\n\ndo that.\n'
	},
	{
		name: 'a rest flush under the block above, past a heading',
		marked: 'first\n⟦# head\n\npa⟧ra\n',
		removed: 'first\n\nra\n',
		lettered: 'first\n\nxra\n',
		written: 'first\n\nQra\n',
		broken: 'first\n\n\nra\n'
	},
	{
		name: 'a rest flush under the block above, in a quote',
		marked: '> first\n> ⟦***\n>\n> pa⟧ra\n',
		removed: '> first\n>\n> ra\n',
		lettered: '> first\n>\n> xra\n',
		written: '> first\n>\n> Qra\n',
		broken: '> first\n>\n>\n> ra\n'
	},
	{
		name: 'a rest flush under the block above, in an item',
		marked: '- first\n  ⟦***\n\n  pa⟧ra\n',
		removed: '- first\n\n  ra\n',
		lettered: '- first\n\n  xra\n',
		written: '- first\n\n  Qra\n',
		broken: '- first\n\n  \n- ra\n'
	},
	{
		name: 'a rest flush under the block above, in a callout',
		marked: ':::note\nfirst\n⟦***\n\npa⟧ra\n:::\n',
		removed: ':::note\nfirst\n\nra\n:::\n',
		lettered: ':::note\nfirst\n\nxra\n:::\n',
		written: ':::note\nfirst\n\nQra\n:::\n',
		broken: ':::note\nfirst\n\n\nra\n:::\n'
	}
];

/** The hosts the lower side moved: a cut over each, pasted back with its own entry, is exact. */
const MOVED: string[] = [
	'first\n⟦***\n\npa⟧ra\n',
	'first\n⟦```\ncode\n```\n\npa⟧ra\n',
	'first\n⟦# head\n\npa⟧ra\n',
	'- first\n⟦```\ncode\n```\n\npa⟧ra\n',
	'first\r\n⟦***\r\n\r\npa⟧ra\r\n',
	'> first\n> ⟦***\n>\n> pa⟧ra\n',
	'first\n⟦***\n\n# he⟧ad\n',
	'first\n⟦***\n\n- it⟧em\n'
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
	// Flush on both sides of what the range took, the pair rejoins as prose.
	{
		name: 'a rest flush under a divider flush under the block above',
		marked: 'first\n⟦***\npa⟧ra\n',
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

describe('a cut that leaves the pair apart pastes back exact', () => {
	for (const mode of ['source', 'live'] as const)
		for (const marked of MOVED)
			it(`${mode}: ${JSON.stringify(marked)}`, async () => {
				const editor = await mounted(marked, mode);
				const wrote = await clipboardGesture(editor, 'cut', 'key');
				await pasteGesture(editor, wrote, 'key');
				expect(editor.source()).toBe(marked.replace(/[⟦⟧]/g, ''));
				expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
			});
});
