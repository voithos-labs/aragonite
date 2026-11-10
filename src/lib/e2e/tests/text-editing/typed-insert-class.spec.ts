import type { Page } from '@playwright/test';
import { test } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { gotoReady } from '../../goto-ready';
import { insertText } from '../../insert-text';
import { edgeKey } from '../../platform-keys';
import { addReplaceIsland, addWidgetIsland } from '../../decoration-sources';
import { waitForAllImagesLoaded } from '../blocks/image/helpers';

/**
 * A collapsed typed insert lands at the editor's caret on every engine, by key or by a soft
 * keyboard's `insertText` alone, in source and live mode
 * (`requirements/text-editing/typed-insert-class.md`).
 */

const IMAGE = '![x](/test-fixtures/sample.png)';
const LEAD_IMAGE = `lead ${IMAGE}\n`;
const MODES = ['source', 'live'] as const;
type Mode = (typeof MODES)[number];
type Route = 'key' | 'soft keyboard';

/** How a row puts the caret down: the editor's own placement, a key, or a click past a widget. */
type Reach =
	| { by: 'place'; path: number[]; at: number }
	| { by: 'block-end' }
	| { by: 'line-end' }
	| { by: 'click-right'; widget: string };

interface Setup {
	/** The plugins harness page with this seed's plugin: a formula, a chip. */
	plugin?: 'math' | 'chips';
	decorate?: (page: Page) => Promise<void>;
}

/** How a row selects a widget whole before the text arrives. */
interface SelectedRow extends Setup {
	name: string;
	source: string;
	select: (editor: EditorPage, page: Page) => Promise<void>;
	after: string;
}

async function clickPicture(_editor: EditorPage, page: Page): Promise<void> {
	const box = await page.locator('[data-image-widget]').boundingBox();
	if (!box) throw new Error('the picture has no box');
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const arrowOnto =
	(path: number[], before: number, key = 'ArrowRight') =>
	async (editor: EditorPage, page: Page): Promise<void> => {
		await editor.focusBlockAtPath(path, before);
		await page.keyboard.press(key);
	};

const CHIPS = 'Prose {{alpha}} here\n\n| Note | B |\n| --- | --- |\n| x {{beta}} y | z |\n';

const SELECTED: SelectedRow[] = [
	{ name: 'a click on a picture', source: LEAD_IMAGE, select: clickPicture, after: 'lead Z\n' },
	{
		name: 'a click on a picture alone in its block',
		source: `${IMAGE}\n`,
		select: clickPicture,
		after: 'Z\n'
	},
	{
		name: 'ArrowRight onto a picture',
		source: `lead ${IMAGE} tail\n`,
		select: arrowOnto([0], 5),
		after: 'lead Z tail\n'
	},
	{
		name: 'ArrowLeft onto a picture',
		source: `lead ${IMAGE} tail\n`,
		select: arrowOnto([0], 5 + IMAGE.length, 'ArrowLeft'),
		after: 'lead Z tail\n'
	},
	{
		name: 'ArrowRight onto a line break',
		source: 'ab<br>cd\n',
		select: arrowOnto([0], 2),
		after: 'abZcd\n'
	},
	{
		name: 'a click on a picture inside strong',
		source: `lead **${IMAGE}** tail\n`,
		select: clickPicture,
		after: 'lead **Z** tail\n'
	},
	{
		name: 'a click on a picture, then a resize key',
		source: `lead ${IMAGE} tail\n`,
		select: async (editor, page) => {
			await clickPicture(editor, page);
			await editor.waitForRenderFlush();
			await page.keyboard.press('Shift+ArrowRight');
			await editor.bridge.waitForSourceContains('![x|');
		},
		after: 'lead Z tail\n'
	},
	{
		name: 'Mod+K beside a chip in a paragraph',
		source: CHIPS,
		select: arrowOnto([0], 15, 'ControlOrMeta+k'),
		after: CHIPS.replace('{{alpha}}', 'Z'),
		plugin: 'chips'
	},
	{
		name: 'Mod+K beside a chip in a table cell',
		source: CHIPS,
		select: arrowOnto([1, 1, 0], 10, 'ControlOrMeta+k'),
		after: CHIPS.replace('{{beta}}', 'Z'),
		plugin: 'chips'
	}
];

interface Row extends Setup {
	name: string;
	source: string;
	reach: Reach;
	after: string;
}

const ROWS: Row[] = [
	{
		name: 'Ctrl+End past a trailing picture',
		source: LEAD_IMAGE,
		reach: { by: 'block-end' },
		after: `lead ${IMAGE}Z\n`
	},
	{
		name: 'End past a trailing picture',
		source: LEAD_IMAGE,
		reach: { by: 'line-end' },
		after: `lead ${IMAGE}Z\n`
	},
	{
		name: "the editor's caret at the end, after a trailing picture",
		source: LEAD_IMAGE,
		reach: { by: 'place', path: [0], at: 5 + IMAGE.length },
		after: `lead ${IMAGE}Z\n`
	},
	{
		name: 'a click right of a trailing picture',
		source: LEAD_IMAGE,
		reach: { by: 'click-right', widget: '[data-image-widget]' },
		after: `lead ${IMAGE}Z\n`
	},
	{
		name: 'a click right of a picture alone on its line',
		source: `${IMAGE}\n`,
		reach: { by: 'click-right', widget: '[data-image-widget]' },
		after: `${IMAGE}Z\n`
	},
	{
		name: 'before a picture that opens the block',
		source: `${IMAGE} tail\n`,
		reach: { by: 'place', path: [0], at: 0 },
		after: `Z${IMAGE} tail\n`
	},
	{
		name: 'a click right of a trailing entity',
		source: 'lead &copy;\n',
		reach: { by: 'click-right', widget: '[data-inline-widget]' },
		after: 'lead &copy;Z\n'
	},
	{
		name: 'a click right of a trailing formula',
		source: 'lead $x^2$\n',
		reach: { by: 'click-right', widget: '[data-inline-widget]' },
		after: 'lead $x^2$Z\n',
		plugin: 'math'
	},
	{
		name: 'Ctrl+End past a trailing replace decoration',
		source: 'lead HIDDEN\n',
		reach: { by: 'block-end' },
		after: 'lead HIDDENZ\n',
		decorate: (page) => addReplaceIsland(page, [0], 5, 11)
	},
	{
		name: 'Ctrl+End past a trailing widget decoration',
		source: 'hello\n',
		reach: { by: 'block-end' },
		after: 'helloZ\n',
		decorate: (page) => addWidgetIsland(page, [0], 5)
	},
	{
		name: 'before a line break that ends a paragraph',
		source: 'lead<br>\n',
		reach: { by: 'place', path: [0], at: 4 },
		after: 'leadZ<br>\n'
	},
	{
		name: 'before a line break that ends a table cell',
		source: '| H |\n| :- |\n| Left<br> |\n',
		reach: { by: 'place', path: [0, 1, 0], at: 4 },
		after: '| H |\n| :- |\n| LeftZ<br> |\n'
	}
];

async function open(
	editor: EditorPage,
	page: Page,
	mode: Mode,
	source: string,
	setup: Setup = {}
): Promise<void> {
	if (setup.plugin) {
		await gotoReady(page, `/test/plugins?seed=${setup.plugin}`);
		if (mode === 'live') await editor.setPresentationMode('live');
	} else {
		await editor.goto(mode === 'live' ? '?presentationMode=live' : '');
	}
	await setup.decorate?.(page);
	await editor.loadContent(source);
	await waitForAllImagesLoaded(page);
}

async function reach(editor: EditorPage, page: Page, how: Reach): Promise<void> {
	if (how.by === 'place') return editor.focusBlockAtPath(how.path, how.at);
	if (how.by === 'click-right') {
		const box = await page.locator(how.widget).last().boundingBox();
		if (!box) throw new Error(`${how.widget} has no box`);
		await page.mouse.click(box.x + box.width + 30, box.y + box.height / 2);
		return editor.waitForRenderFlush();
	}
	await editor.clickBlockAtPath([0], 1);
	await page.keyboard.press(edgeKey(how.by === 'block-end' ? 'blockEnd' : 'lineEnd'));
	await editor.waitForRenderFlush();
}

const type = (page: Page, route: Route, text: string) =>
	route === 'key' ? page.keyboard.type(text) : insertText(page, text);

for (const mode of MODES) {
	for (const route of ['key', 'soft keyboard'] as const) {
		test.describe(`a typed insert by ${route}, ${mode} mode`, () => {
			for (const row of ROWS) {
				test(row.name, async ({ page }) => {
					const editor = new EditorPage(page);
					await open(editor, page, mode, row.source, row);
					await reach(editor, page, row.reach);
					await type(page, route, 'Z');
					await editor.bridge.waitForSourceEquals(row.after);
				});
			}

			for (const row of SELECTED) {
				test(`over a widget selected whole by ${row.name}, the text replaces it`, async ({
					page
				}) => {
					const editor = new EditorPage(page);
					await open(editor, page, mode, row.source, row);
					await row.select(editor, page);
					await editor.waitForRenderFlush();
					await type(page, route, 'Z');
					await editor.bridge.waitForSourceEquals(row.after);
				});
			}

			// Chromium and WebKit aim this letter back inside the link text; the caret is past `)`.
			test('a letter just after a link typed to completion', async ({ page }) => {
				const editor = new EditorPage(page);
				await open(editor, page, mode, 'plain tail\n');
				await editor.clickBlockAtPath([0], 3);
				await page.keyboard.press(edgeKey('lineEnd'));
				await page.keyboard.type(' [ab](u)');
				await editor.waitForRenderFlush();
				await type(page, route, 'z');
				await editor.bridge.waitForSourceEquals('plain tail [ab](u)z\n');
			});

			test('on the line Shift+Enter opened', async ({ page }) => {
				const editor = new EditorPage(page);
				await open(editor, page, mode, 'abc\n');
				await editor.focusBlockAtPath([0], 3);
				await page.keyboard.press('Shift+Enter');
				await editor.waitForRenderFlush();
				await type(page, route, 'Z');
				await editor.bridge.waitForSourceEquals('abc\\\nZ\n');
			});
		});
	}
}
