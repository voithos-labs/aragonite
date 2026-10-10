import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { holdClipboardRead, releaseClipboardRead } from '../page-probes';

test.describe('source prop change', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('clears cross-block selection when source prop changes', async ({ page }) => {
		await editor.loadContent('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n');

		await editor.focusBlockStart(0);
		await page.keyboard.down('Shift');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.up('Shift');

		await editor.waitForCrossBlock(true);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);

		await editor.loadContent('Totally different content.\n');

		expect(await editor.bridge.isCrossBlockActive()).toBe(false);

		await editor.focusBlockEnd(0);
		await editor.typeText(' appended');
		const src = await editor.bridge.getSource();
		expect(src).toContain('appended');
	});

	test('loading the text the page loaded last, after typing, loads it afresh', async () => {
		const text = 'First paragraph.\n';
		await editor.loadContent(text);
		await editor.focusBlockEnd(0);
		await editor.typeText(' typed');
		await editor.bridge.waitForSourceEquals('First paragraph. typed\n');

		await editor.loadContent(text);

		expect(await editor.bridge.getSource()).toBe(text);
		expect(await editor.bridge.getUndoDepth()).toBe(0);
	});

	test('loading the text the editor holds, after typing back to it, loads it afresh', async ({
		page
	}) => {
		const text = 'First paragraph.\n';
		await editor.loadContent(text);
		await editor.focusBlockEnd(0);
		await editor.typeText('x');
		await editor.bridge.waitForSourceEquals('First paragraph.x\n');
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals(text);
		await expect.poll(() => editor.bridge.getUndoDepth()).toBeGreaterThan(0);

		await editor.loadContent(text);

		expect(await editor.bridge.getUndoDepth()).toBe(0);
	});

	test('a source swap fires sourceSwap once with a rising generation, and no edit', async ({
		page
	}) => {
		await editor.loadContent('First document.\n');
		await page.evaluate(() => {
			(window as any).__test.startSourceSwapCapture();
			(window as any).__test.startEditOpCapture();
		});

		await editor.loadContent('Second document.\n');
		await editor.loadContent('Third document.\n');

		const generations: number[] = await page.evaluate(() =>
			(window as any).__test.stopSourceSwapCapture()
		);
		expect(generations).toHaveLength(2);
		expect(generations[1]).toBe(generations[0] + 1);
		expect(await page.evaluate(() => (window as any).__test.stopEditOpCapture())).toEqual([]);
	});

	test('a key typed just before a swap fires its edit at the key, and the swap fires none', async ({
		page
	}) => {
		await editor.loadContent('a\n');
		await editor.focusBlockEnd(0);
		await page.evaluate(() => (window as any).__test.startEditOpCapture());

		await page.keyboard.type('b');
		const typed = await page.evaluate(() => (window as any).__test.stopEditOpCapture());
		await page.evaluate(() => (window as any).__test.startEditOpCapture());
		await editor.loadContent('other\n');

		expect(typed).toEqual(['input']);
		expect(await page.evaluate(() => (window as any).__test.stopEditOpCapture())).toEqual([]);
		expect(await editor.bridge.getSource()).toBe('other\n');
	});
});

// A write made for the outgoing document, arriving after the swap: a blur's tidy-up, or a menu
// paste that waited on the clipboard read. Each is refused rather than landing in the next one.
test.describe('source prop change: a write that outlives its document', () => {
	let editor: EditorPage;
	const next = 'note b one\n\nnote b two\n';

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function swapThenRelease(page: Page): Promise<void> {
		await page.evaluate((md) => (window as any).__test.setSource(md), next);
		await editor.bridge.waitForSourceEquals(next);
		await releaseClipboardRead(page, 'CLIP');
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();
	}

	test('an empty heading holding the caret at a swap is not demoted into the next document', async ({
		page
	}) => {
		await editor.loadContent('# \n\nafter\n');
		await editor.focusBlockEnd(0);
		await page.evaluate(() => (window as any).__test.startEditOpCapture());

		const title = '# Title\n\nbody\n';
		await page.evaluate((md) => (window as any).__test.setSource(md), title);
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getSource()).toBe(title);
		expect(await page.evaluate(() => (window as any).__test.stopEditOpCapture())).toEqual([]);
	});

	test('the prose menu’s Paste lands nowhere', async ({ page }) => {
		await editor.loadContent('note a one\n\nnote a two\n');
		await holdClipboardRead(page);
		await editor.getBlock(1).click({ button: 'right' });
		await page
			.getByRole('menu', { name: 'Block actions' })
			.getByRole('menuitem', { name: 'Paste', exact: true })
			.click();

		await swapThenRelease(page);

		expect(await editor.bridge.getSource()).toBe(next);
	});

	test('the block menu’s Replace with clipboard lands nowhere', async ({ page }) => {
		await editor.loadContent('note a one\n\n```\ncode\n```\n');
		await holdClipboardRead(page);
		await page.locator('[data-block-kind="fencedCode"]').first().click({ button: 'right' });
		await page
			.getByRole('menu', { name: 'Block actions' })
			.getByRole('menuitem', { name: 'Replace with clipboard' })
			.click();

		await swapThenRelease(page);

		expect(await editor.bridge.getSource()).toBe(next);
	});
});
