import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

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

test('undo after erasing a title puts the title and its underline back', async ({ page }) => {
	const ep = await open(page, 'live', 'Plan\n===\n');
	await ep.clickBlock(0);
	await page.keyboard.press('End');
	await backspace(page, 4);
	await expectSource(ep, '\n');

	await ep.undo();
	await expectSource(ep, 'Plan\n===\n');
	expect(await ep.bridge.getBlockKind(0)).toBe('setextHeading');
});
