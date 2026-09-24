import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { runCenter, runStart } from '../selection/multi-click-helpers';

type Point = { x: number; y: number };

// Erasing a setext heading's title takes its underline with it: an underline under nothing would
// show up as a block of its own (`requirements/text-editing/erase-setext-title.md`).

async function open(page: Page, mode: 'source' | 'live', doc: string): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto(mode === 'live' ? '?presentationMode=live' : '');
	await ep.loadContent(doc);
	return ep;
}

// Polled rather than waited on, so a red prints the bytes the editor wrote.
const expectSource = (ep: EditorPage, expected: string) =>
	expect.poll(() => ep.bridge.getSource(), { timeout: 5000 }).toBe(expected);

async function kinds(ep: EditorPage): Promise<string[]> {
	const count = await ep.bridge.getBlockCount();
	return Promise.all(Array.from({ length: count }, (_, i) => ep.bridge.getBlockKind(i)));
}

async function caret(ep: EditorPage) {
	const focus = (await ep.bridge.getSelectionPaths())?.focus;
	return focus && { path: focus.path, offset: focus.offset };
}

async function backspace(page: Page, times: number): Promise<void> {
	for (let i = 0; i < times; i++) await page.keyboard.press('Backspace');
}

/** Every write that can empty the title, each reaching the source by its own route. */
const ERASES: {
	name: string;
	erase: (ep: EditorPage, page: Page) => Promise<void>;
	source: string;
	kinds: string[];
	caretPath?: number[];
	caretOffset: number;
}[] = [
	{
		name: 'Backspace from the title end',
		erase: async (_ep, page) => {
			await page.keyboard.press('End');
			await backspace(page, 4);
		},
		source: '\nnext\n',
		kinds: ['paragraph', 'paragraph'],
		caretOffset: 0
	},
	{
		name: 'a range from the title start into the next block, then Backspace',
		erase: async (ep, page) => {
			await page.keyboard.press('Home');
			await ep.shiftClickBlock([1], 4);
			await page.keyboard.press('Backspace');
		},
		source: '\n',
		kinds: ['paragraph'],
		caretOffset: 0
	},
	{
		name: 'Ctrl+X over the whole title',
		erase: async (_ep, page) => {
			await page.keyboard.press('End');
			await page.keyboard.press('Shift+Home');
			await page.keyboard.press('ControlOrMeta+x');
		},
		source: '\nnext\n',
		kinds: ['paragraph', 'paragraph'],
		caretOffset: 0
	},
	{
		name: 'a space pasted over the whole title',
		erase: async (ep, page) => {
			await ep.seedClipboard(' ');
			await page.keyboard.press('End');
			await page.keyboard.press('Shift+Home');
			await ep.paste();
		},
		source: ' \nnext\n',
		kinds: ['paragraph', 'paragraph'],
		caretOffset: 1
	},
	{
		name: 'the whole title dragged to the start of the next line',
		erase: async (_ep, page) => {
			const title = await runCenter(page, 'Plan');
			await page.mouse.dblclick(title.x, title.y);
			await dragSelection(page, title, await runStart(page, 'next'));
		},
		source: '\nPlannext\n',
		kinds: ['paragraph', 'paragraph'],
		caretPath: [1],
		caretOffset: 4
	}
];

/** Press on the selected text and drag it to `to`: the browser's own selection drag. */
async function dragSelection(page: Page, from: Point, to: Point): Promise<void> {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 4, from.y, { steps: 2 });
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.mouse.move(to.x + 1, to.y, { steps: 2 });
	await page.mouse.up();
}

for (const mode of ['source', 'live'] as const) {
	test.describe(`${mode} mode: erasing a setext title`, () => {
		for (const underline of ['===', '---', '----------']) {
			test(`under a ${underline} underline leaves an empty paragraph`, async ({ page }) => {
				const ep = await open(page, mode, `Plan\n${underline}\n\nnext\n`);
				await ep.clickBlock(0);
				await page.keyboard.press('End');
				await backspace(page, 4);

				await expect.poll(() => kinds(ep)).toEqual(['paragraph', 'paragraph']);
				await expectSource(ep, '\nnext\n');
				expect(await caret(ep)).toEqual({ path: [0], offset: 0 });
			});
		}

		for (const { name, erase, source, kinds: left, caretPath, caretOffset } of ERASES) {
			test(`${name} leaves no divider, and one undo restores the title`, async ({ page }) => {
				const ep = await open(page, mode, 'Plan\n---\n\nnext\n');
				await ep.clickBlock(0);
				await erase(ep, page);

				await expect.poll(() => kinds(ep)).toEqual(left);
				await expectSource(ep, source);
				expect(await caret(ep)).toEqual({ path: caretPath ?? [0], offset: caretOffset });

				await ep.undo();
				await expectSource(ep, 'Plan\n---\n\nnext\n');
				expect(await ep.bridge.getBlockKind(0)).toBe('setextHeading');
			});
		}

		test('the last line of a two-line title leaves a paragraph and no rule', async ({ page }) => {
			const ep = await open(page, mode, 'Plan\nmore\n---\n');
			await ep.clickBlockAtPath([0], 7);
			await page.keyboard.press('End');
			await backspace(page, 4);

			await expect.poll(() => kinds(ep)).toEqual(['paragraph']);
			await expectSource(ep, 'Plan\n\n');
		});
	});
}
