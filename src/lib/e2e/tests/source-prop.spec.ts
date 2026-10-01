import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

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

	test('an empty heading holding the caret at a swap is not demoted into the next document', async ({
		page
	}) => {
		await editor.loadContent('# \n\nafter\n');
		await editor.focusBlockEnd(0);
		await page.evaluate(() => (window as any).__test.startEditOpCapture());

		const next = '# Title\n\nbody\n';
		await page.evaluate((md) => (window as any).__test.setSource(md), next);
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getSource()).toBe(next);
		expect(await page.evaluate(() => (window as any).__test.stopEditOpCapture())).toEqual([]);
	});
});
