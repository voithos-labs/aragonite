import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import { edgeKey, extendKey } from '../../platform-keys';
import { pointAtRaw, textRunStart } from '../../text-runs';
import { pastLineEnd } from '../selection/multi-click-helpers';
import { multiClick } from '../../multi-click';
import { dragSelection } from '../../selection-drag';

// In live mode a selection over a `:::` row's whole text is the title: a cut takes the title and
// copies it, and a paste puts it back. Each row names the row's path and where its text starts.

interface Row {
	name: string;
	source: string;
	row: number[];
	/** Raw offsets of the row's text, and the bytes a cut of it leaves. */
	text: [number, number];
	cut: string;
}

const ROWS: Row[] = [
	{
		name: 'a callout',
		source: ':::tip Title\nbody\n:::\n',
		row: [0, 0],
		text: [7, 12],
		cut: ':::tip \nbody\n:::\n'
	},
	{
		name: 'a generic container',
		source: ':::foo Title\nbody\n:::\n',
		row: [0, 0],
		text: [7, 12],
		cut: ':::foo \nbody\n:::\n'
	},
	{
		name: 'a callout in a quote',
		source: '> :::tip Title\n> body\n> :::\n',
		row: [0, 0, 0],
		text: [7, 12],
		cut: '> :::tip \n> body\n> :::\n'
	},
	{
		name: 'a callout in a list item',
		source: '- :::tip Title\n  body\n  :::\n',
		row: [0, 0, 0, 0],
		text: [7, 12],
		cut: '- :::tip \n  body\n  :::\n'
	},
	{
		name: 'the inner row of a nested callout',
		source: '::::note Outer\n:::tip Inner\nin\n:::\n::::\n',
		row: [0, 1, 0],
		text: [7, 12],
		cut: '::::note Outer\n:::tip \nin\n:::\n::::\n'
	}
];

type Select = (editor: PluginsPage, row: Row) => Promise<void>;

const SELECTIONS: Record<string, Select> = {
	'End then Shift+Home': async (editor, { row, text }) => {
		await editor.focusBlockAtPath(row, text[0]);
		await editor.page.keyboard.press(edgeKey('lineEnd'));
		await editor.page.keyboard.press(extendKey('lineStart'));
	},
	'a triple click': async (editor, { row, text }) => {
		await multiClick(editor.page, await pointAtRaw(editor.page, row, text[0] + 1), 3);
	},
	'the selection API': async (editor, { row, text }) => {
		const ok = await editor.bridge.setSelection({
			anchor: { path: row, offset: 0 },
			focus: { path: row, offset: text[1] }
		});
		expect(ok).toBe(true);
	}
};

test.describe('a live selection over a title row whole text', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('admonitions');
	});

	async function load(source: string, mode: 'live' | 'source' = 'live'): Promise<void> {
		await editor.setPresentationMode(mode);
		await editor.loadContent(source);
	}

	for (const [how, select] of Object.entries(SELECTIONS))
		test(`${how} on a callout's row, cut then pasted back`, async ({ page }) => {
			const [row] = ROWS;
			await load(row.source);
			await select(editor, row);
			await page.keyboard.press('ControlOrMeta+x');
			await editor.bridge.waitForSourceEquals(row.cut);
			expect(await editor.readClipboard()).toBe('Title');
			await editor.paste();
			await editor.bridge.waitForSourceEquals(row.source);
			expect(await editor.parseConverged()).toBe(true);
		});

	for (const row of ROWS.slice(1))
		test(`${row.name}: the row cut then pasted back`, async ({ page }) => {
			await load(row.source);
			await SELECTIONS['End then Shift+Home'](editor, row);
			await page.keyboard.press('ControlOrMeta+x');
			await editor.bridge.waitForSourceEquals(row.cut);
			await editor.paste();
			await editor.bridge.waitForSourceEquals(row.source);
		});

	test('the row copied, then pasted into a paragraph, lands as its text', async ({ page }) => {
		const source = ':::tip Title\nbody\n:::\n\npara\n';
		await load(source);
		await SELECTIONS['End then Shift+Home'](editor, ROWS[0]);
		await page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardWrite();
		expect(await editor.readClipboard()).toBe('Title');
		await editor.focusBlockAtPath([1], 4);
		await editor.paste();
		await editor.bridge.waitForSourceEquals(':::tip Title\nbody\n:::\n\nparaTitle\n');
	});

	test('the row dragged to the end of a paragraph carries its text', async ({ page }) => {
		await load(':::tip Title\nbody\n:::\n\npara\n');
		await SELECTIONS['End then Shift+Home'](editor, ROWS[0]);
		await dragSelection(page, await textRunStart(page, 'Title'), await pastLineEnd(page, 'para'));
		await editor.bridge.waitForSourceEquals(':::tip \nbody\n:::\n\nparaTitle\n');
	});

	// Today's answers, pinned until a removal that stays on the row is ruled otherwise.
	for (const key of ['Backspace', 'ControlOrMeta+x'])
		test(`source: the row selected whole, ${key}, takes the row`, async ({ page }) => {
			const [row] = ROWS;
			await load(row.source, 'source');
			await editor.focusBlockAtPath(row.row, 0);
			await page.keyboard.press(extendKey('lineEnd'));
			await page.keyboard.press(key);
			await editor.bridge.waitForSourceEquals('\nbody\n:::\n');
			if (key !== 'Backspace') expect(await editor.readClipboard()).toBe(':::tip Title');
		});

	test('live: the marker alone selected, Backspace, takes the marker', async ({ page }) => {
		const [row] = ROWS;
		await load(row.source);
		await editor.focusBlockAtPath(row.row, row.text[0]);
		await page.keyboard.press(extendKey('lineStart'));
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('Title\nbody\n:::\n');
	});
});
