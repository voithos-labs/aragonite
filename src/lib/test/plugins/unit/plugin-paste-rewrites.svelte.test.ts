// @vitest-environment jsdom
// A plugin value's paste rewrites in a mounted editor: the block a rewrite reads, a paste that lands
// as text, the editor's own entry, a rewrite that throws, and each place a paste lands blocks, where
// a rewrite is asked once, beside the text it is never asked about.
// Miss-analysis: paste rewrites were process-wide text transforms, and no row read a pasted block the
// way a plugin reads it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtin, definePlugin, type EditorPlugin } from '#lib/plugin.js';
import { container } from '#lib/components/block-makers/container.js';
import { rewrite, type PasteRewrite } from '#lib/schema/paste-rewrite.js';
import { OWN_CLIPBOARD_TYPE } from '#lib/browser/clipboard.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { PluginError } from '#lib/schema/plugin-unit.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { dispatchBeforeInput, insertBy } from '#lib/test/harness/insertion-routes.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

interface AlertData {
	type: string;
}

/** An alerts plugin whose one rewrite answers with `into`, recording every block it reads: pasted
 *  alerts, or with `ofParagraphs` pasted paragraphs. */
function makeAlerts(into: (block: Block<AlertData>) => string | null, ofParagraphs = false) {
	const read: Block<AlertData>[] = [];
	const alert = container<AlertData>({
		name: 'alert',
		label: 'Alert',
		sample: '%> [!NOTE]\n%> x',
		insert: { none: 'a test block type' },
		lines: {
			shape: 'marked',
			first: '%> ',
			rest: '%> ',
			reads: /^%> ?/,
			lazy: true,
			head: {
				match: /^\[!(\w+)\]$/,
				data: (m: RegExpExecArray) => ({ type: m[1] }),
				write: (data: AlertData) => `[!${data.type}]`
			}
		}
	});
	const from = ofParagraphs ? (builtin.blocks.paragraph as unknown as typeof alert) : alert;
	const rewrites: PasteRewrite<unknown>[] = [
		rewrite({ from, into: (block) => (read.push(block), into(block)) })
	];
	const plugin = definePlugin({
		name: 'alerts',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [alert], rewrites })
	});
	return { plugin, read };
}

/** `source` in an editor running the alerts plugin, after the plugins `beside` it. */
async function mounted(
	into: (block: Block<AlertData>) => string | null,
	source = 'intro\n\nafter\n',
	{ ofParagraphs = false, beside = [] as EditorPlugin[] } = {}
) {
	const errors: PluginError[] = [];
	const alerts = makeAlerts(into, ofParagraphs);
	const editor = mountEditor({
		source,
		plugins: [...beside, alerts.plugin],
		onError: (error: PluginError) => errors.push(error)
	});
	await editor.settle();
	return { editor, errors, ...alerts };
}

type Mounted = Awaited<ReturnType<typeof mounted>>['editor'];

/** Pastes `text` at the end of the first paragraph, carrying `own` as the editor's own entry. */
async function pasteAfterIntro(editor: Mounted, text: string, own?: string) {
	const surface = surfaceAt(editor, [0]);
	placeCaret(surface, 5);
	await pasteOn(editor, surface, text, own);
}

/** Pastes `text` on `surface`, where the caret already is; `plain` sends the plain-paste chord
 *  first, as the browser does. */
async function pasteOn(
	editor: Mounted,
	surface: HTMLElement,
	text: string,
	own?: string,
	plain = false
) {
	if (plain) await pressKey(surface, { key: 'V', ctrlKey: true, shiftKey: true });
	const event = new Event('paste', { bubbles: true, cancelable: true });
	const types = own ? ['text/plain', OWN_CLIPBOARD_TYPE] : ['text/plain'];
	Object.defineProperty(event, 'clipboardData', {
		value: {
			types,
			getData: (type: string) =>
				type === 'text/plain' ? text : type === OWN_CLIPBOARD_TYPE ? (own ?? '') : '',
			files: [],
			items: []
		}
	});
	surface.dispatchEvent(event);
	await editor.settle();
}

describe('a paste rewrite in a mounted editor', () => {
	it('reads the pasted block with its data, children and clipboard positions, and writes its answer', async () => {
		const { editor, read } = await mounted(() => 'REWRITTEN');
		await pasteAfterIntro(editor, 'x\n\n%> [!TIP]\n%> pasted\n');
		expect(editor.source()).toContain('REWRITTEN');
		expect(editor.source()).not.toContain('[!TIP]');
		expect(read).toHaveLength(1);
		const [block] = read;
		expect(block.data.type).toBe('TIP');
		expect(block.children.map((child) => child.text)).toEqual(['pasted\n']);
		expect([block.from, block.to]).toEqual([3, 23]);
	});

	// Miss-analysis: the cross-block row read the bytes, which a rewrite asked twice leaves the same.
	it('asks once over a selection across blocks, and lands the answer in its place', async () => {
		const { editor, read } = await mounted(() => 'REWRITTEN', 'intro\n\nmiddle\n\nafter\n');
		const surface = surfaceAt(editor, [0]);
		placeCaret(surface, 2);
		await pressKey(surface, { key: 'a', ctrlKey: true });
		await pressKey(surface, { key: 'a', ctrlKey: true });
		const held = editor.instance.getSelection()!;
		expect(held.anchor.path).not.toEqual(held.focus.path);
		await pasteOn(editor, surface, 'x\n\n%> [!TIP]\n%> pasted\n');
		expect(read).toHaveLength(1);
		// The bytes a paste of the answer itself lands over the same selection.
		expect(editor.source()).toBe('x\n\nREWRITTEN\n\n');
	});

	it('asks nothing for one line pasted after text, which lands as text', async () => {
		const { editor, read } = await mounted(() => 'REWRITTEN');
		await pasteAfterIntro(editor, '%> [!TIP]');
		expect(editor.source()).toBe('intro%> [!TIP]\n\nafter\n');
		expect(read).toEqual([]);
	});

	it("asks nothing for a paste carrying the editor's own entry", async () => {
		const { editor, read } = await mounted(() => 'REWRITTEN');
		await pasteAfterIntro(editor, '%> [!TIP]\n%> pasted\n', 'an entry that fits nowhere');
		expect(editor.source()).toContain('%> [!TIP]\n%> pasted\n');
		expect(read).toEqual([]);
	});

	// Miss-analysis: the cell's rows pasted blocks a rewrite answered with text; one it leaves out
	// fell through to the cell's text arm, which wrote the alert's own lines into the cell.
	it('writes nothing for an alert pasted in a table cell that its rewrite leaves out', async () => {
		const TABLE = '| a | b |\n| - | - |\n| c | d |\n';
		const { editor, read } = await mounted(() => '', TABLE);
		const cell = editor.target.querySelectorAll<HTMLElement>('.table-cell')[2];
		placeCaret(cell, 1);
		await pasteOn(editor, cell, '%> [!TIP]\n%> pasted\n');
		expect(read).toHaveLength(1);
		expect(editor.source()).toBe(TABLE);
	});

	// Miss-analysis: no row counted what a rewrite's read of a position costs; each pasted block
	// measured the whole clipboard again.
	it('measures the clipboard once, however many blocks a rewrite reads a position of', async () => {
		const { editor, read } = await mounted((block) => (block.from < 0 ? '' : null));
		enablePerfInstruments();
		resetPerfInstruments();
		try {
			await pasteAfterIntro(editor, 'x\n\n' + '%> [!TIP]\n%> pasted\n\n'.repeat(40));
			expect(read).toHaveLength(40);
			// The clipboard holds 81 top-level blocks; measured per alert it would be over 3,000.
			expect(perfSnapshot().topBlocksMeasured).toBeLessThan(600);
		} finally {
			disablePerfInstruments();
		}
	});

	it('reports a rewrite that throws as `rewrite paste`, and lands the block as pasted', async () => {
		const { editor, errors } = await mounted(() => {
			throw new Error('boom');
		});
		await pasteAfterIntro(editor, '%> [!TIP]\n%> pasted\n');
		expect(editor.source()).toContain('%> [!TIP]\n%> pasted\n');
		expect(errors.map(({ plugin, doing }) => [plugin, doing])).toEqual([
			['alerts', 'rewrite paste']
		]);
	});
});

type Place = (editor: Mounted) => Promise<HTMLElement>;
const point = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** The selection from `anchor` to `focus`, a caret where they are one point; resolves to the
 *  element that holds focus, which a paste arrives on. */
const select =
	(anchor: SelectionPoint, focus = anchor): Place =>
	async (editor) => {
		await editor.instance.setSelection({ anchor, focus });
		await editor.settle();
		return document.activeElement as HTMLElement;
	};

/** A caret in the first body cell of the table that is top-level block `table`. */
const inCell = (table: number): Place => select(point([table, 1, 0], 1));

const TEXT = 'intro\n\nmiddle\n\nafter\n';
const DIVIDED = 'intro\n\n***\n\nmid\n\n***\n\nafter\n';
const TABLE = '| a | b |\n| - | - |\n| c | d |\n';
const CLIP = 'x\n\n%> [!TIP]\n%> pasted\n';
const acrossText = select(point([0], 2), point([2], 2));
const overDividers = select(point([1], 0), point([3], 0));

/** An alert again, of another type: asked about its own answer, the rewrite would write `[!TIPXX]`. */
const again = (block: Block<AlertData>) => `%> [!${block.data.type}X]\n%> again`;
const AGAIN = 'x\n\n%> [!TIPX]\n%> again\n';
const three = () => 'one\n\ntwo\n\n- three';
/** A clipboard an empty answer leaves with nothing: an alert, the only block of a list item. */
const EMPTIED = '- %> [!TIP]\n  %> pasted\n';

// Miss-analysis: the rows' answers were no alert, so a second ask on any route left the same bytes;
// only a caret and one selection were pasted over.
describe('a paste rewrite where pasted blocks land', () => {
	const LANDINGS: [string, string, Place, string, typeof again | (() => string), string][] = [
		['at a caret after text', 'intro\n\nafter\n', select(point([0], 5)), CLIP, again, AGAIN],
		[
			'at the end of an open last line',
			'intro\n\nafter',
			select(point([1], 5)),
			CLIP,
			again,
			AGAIN
		],
		['over a selection across blocks', TEXT, acrossText, CLIP, again, AGAIN],
		['from a clipboard ending in a blank line', TEXT, acrossText, CLIP + '\n', again, AGAIN + '\n'],
		['over whole blocks', DIVIDED, overDividers, CLIP, again, AGAIN],
		['in a list item', '- item\n- two\n', select(point([0, 0, 0], 4)), CLIP, again, AGAIN],
		['in a table cell', TABLE, inCell(0), '%> [!TIP]\n%> p\n', again, '%> [!TIPX]\n%> again\n'],
		['as three blocks for one', TEXT, acrossText, CLIP, three, 'x\n\none\n\ntwo\n\n- three\n'],
		[
			'as three blocks inside a pasted quote',
			TEXT,
			acrossText,
			'x\n\n> %> [!TIP]\n> %> pasted\n',
			three,
			'x\n\n> one\n>\n> two\n>\n> - three\n'
		],
		['as nothing, the block left out', TEXT, acrossText, CLIP, () => '', 'x\n'],
		[
			'as nothing, the first block left out with the blank line after it',
			'intro\n\nafter\n',
			select(point([0], 5)),
			'%> [!TIP]\n%> pasted\n\nb\n',
			() => '',
			'b\n'
		],
		[
			'as nothing, the list item it emptied left out',
			'intro\n\nafter\n',
			select(point([0], 5)),
			'x\n\n- %> [!TIP]\n  %> pasted\n- keep\n\ny\n',
			() => '',
			'x\n\n- keep\n\ny\n'
		]
	];

	it.each(LANDINGS)(
		'is asked once and lands what a paste of its answer lands, %s, as one undo step',
		async (_, doc, place, clip, into, answered) => {
			const { editor, read } = await mounted(into, doc);
			await pasteOn(editor, await place(editor), clip);
			const landed = editor.source();
			expect(read).toHaveLength(1);
			expect(landed).not.toBe(doc);
			// Focus follows the caret a tick after the paste, and undo is pressed where it landed.
			await editor.settle();
			await pressKey(document.activeElement!, { key: 'z', ctrlKey: true });
			await editor.settle();
			expect(editor.source()).toBe(doc);
			await destroyMountedEditors();
			const control = await mounted(() => null, doc);
			await pasteOn(control.editor, await place(control.editor), answered);
			expect(landed).toBe(control.editor.source());
		}
	);

	// Miss-analysis: every empty answer left a block beside it, so none emptied the clipboard, and
	// over a selection the core removed the range for a paste of nothing.
	it.each<[string, Place]>([
		['at a caret', select(point([0], 5))],
		['over a selection across blocks', acrossText]
	])(
		'lands nothing %s where its answers empty the clipboard, as a paste of nothing',
		async (_, place) => {
			const { editor, read } = await mounted(() => '', TEXT);
			await pasteOn(editor, await place(editor), EMPTIED);
			const landed = { source: editor.source(), selection: editor.instance.getSelection() };
			expect(read).toHaveLength(1);
			await destroyMountedEditors();
			const control = await mounted(() => null, TEXT);
			await pasteOn(control.editor, await place(control.editor), '');
			expect(landed).toEqual({
				source: control.editor.source(),
				selection: control.editor.instance.getSelection()
			});
		}
	);

	it('leaves undo nothing of its own where its answers empty the clipboard', async () => {
		const { editor } = await mounted(() => '', TEXT);
		await insertBy('hardware key', await select(point([2], 5))(editor), 'Q');
		await editor.settle();
		await pasteOn(editor, await acrossText(editor), EMPTIED);
		await pressKey(document.activeElement!, { key: 'z', ctrlKey: true });
		await editor.settle();
		expect(editor.source()).toBe(TEXT);
	});

	it('writes nothing by Replace with clipboard where its answers empty the clipboard', async () => {
		const doc = 'intro\n\n```\ncode here\n```\n';
		const { editor, read } = await mounted(() => '', doc);
		Object.defineProperty(navigator, 'clipboard', {
			value: { readText: async () => EMPTIED },
			configurable: true
		});
		surfaceAt(editor, [1]).dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
		);
		await editor.settle();
		[...document.querySelectorAll<HTMLElement>('.block-menu .md-menu-item')]
			.find((row) => row.textContent?.trim() === 'Replace with clipboard')!
			.click();
		await editor.settle();
		expect(read).toHaveLength(1);
		expect(editor.source()).toBe(doc);
	});
});

/** What a copy or a cut of the selection puts on the clipboard. */
async function clipboardOf(editor: Mounted, type: 'copy' | 'cut') {
	const data: Record<string, string> = {};
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { types: [], getData: () => '', setData: (t: string, v: string) => void (data[t] = v) }
	});
	document.activeElement!.dispatchEvent(event);
	await editor.settle();
	return { text: data['text/plain'], own: data[OWN_CLIPBOARD_TYPE] };
}

// Miss-analysis: the own-entry row pasted a made-up entry at one caret, and no row typed over a
// range under a rewrite of paragraphs, the only type a key's text reads as.
describe('a paste rewrite is never asked', () => {
	const OWN = 'intro\n\n%> [!NOTE]\n%> inside\n\nafter\n\nlast\n\n' + TABLE;
	const alertRange = select(point([0], 0), point([1, 0], 6));

	it.each<[string, Place]>([
		['at a caret', select(point([2], 5))],
		['over a selection across blocks', select(point([2], 2), point([3], 2))],
		['in a table cell', inCell(4)]
	])("about the editor's own copy pasted %s", async (_, place) => {
		const { editor, read } = await mounted(again, OWN);
		await alertRange(editor);
		const { text, own } = await clipboardOf(editor, 'copy');
		expect(own).toBeTruthy();
		await pasteOn(editor, await place(editor), text, own);
		expect(read).toEqual([]);
		expect(editor.source().match(/%> \[!NOTE\]\n%> inside/g)).toHaveLength(2);
	});

	it("about the editor's own cut pasted elsewhere", async () => {
		const { editor, read } = await mounted(again, OWN);
		await alertRange(editor);
		const { text, own } = await clipboardOf(editor, 'cut');
		expect(editor.source()).not.toContain('[!NOTE]');
		await pasteOn(editor, await select(point([2], 4))(editor), text, own);
		expect(read).toEqual([]);
		expect(editor.source()).toContain('%> [!NOTE]\n%> inside');
	});

	it("about blocks pasted in a callout's title, which takes them as its one line of text", async () => {
		const doc = ':::note Title\nbody\n:::\n';
		const { editor, read } = await mounted(again, doc, { beside: [admonitionsPlugin()] });
		const title = surfaceAt(editor, [0, 0]);
		placeCaret(title, ':::note Ti'.length);
		await pasteOn(editor, title, CLIP);
		expect(read).toEqual([]);
		expect(editor.source()).toBe(':::note Tix %> [!TIP] %> pastedtle\nbody\n:::\n');
	});

	// A rewrite of paragraphs, the type plain text and a key's text read as.
	const shout = (block: Block<AlertData>) => block.text.trimEnd() + '!';

	it.each<[string, string, Place]>([
		['at a caret', TEXT, select(point([0], 5))],
		['over a selection across blocks', TEXT, acrossText],
		['in a table cell', TABLE, inCell(0)]
	])('about a plain paste %s', async (_, doc, place) => {
		const { editor, read } = await mounted(shout, doc, { ofParagraphs: true });
		await pasteOn(editor, await place(editor), 'Q\n\nR', undefined, true);
		expect(read).toEqual([]);
		expect(editor.source()).toContain('Q');
		expect(editor.source()).not.toContain('!');
	});

	const softText = async (el: HTMLElement) =>
		void dispatchBeforeInput(el, 'insertText', { data: 'Q\n\nR' });

	it.each<[string, string, Place, (el: HTMLElement) => Promise<void>]>([
		['a key over whole blocks', DIVIDED, overDividers, (el) => insertBy('hardware key', el, 'Q')],
		["a soft keyboard's lines over a selection across blocks", TEXT, acrossText, softText]
	])('about %s, text a paste there is asked about', async (_, doc, place, type) => {
		const { editor, read } = await mounted(shout, doc, { ofParagraphs: true });
		await type(await place(editor));
		await editor.settle();
		expect(read).toEqual([]);
		expect(editor.source()).toContain('Q');
		expect(editor.source()).not.toContain('!');
		await destroyMountedEditors();
		const pasted = await mounted(shout, doc, { ofParagraphs: true });
		await pasteOn(pasted.editor, await place(pasted.editor), 'Q\n\nR');
		expect(pasted.editor.source()).toContain('Q!');
	});
});
