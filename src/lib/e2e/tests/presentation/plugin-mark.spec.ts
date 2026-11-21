import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { multiClick } from '../../multi-click';

/** A plugin mark (`==`, on the harness's `highlight-mark` seed) edits as `**` does in live mode. */

const BLOCK = '[data-block-path="[0]"]';

test.describe('a plugin mark in live mode', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('highlight-mark');
		await editor.setPresentationMode('live');
	});

	const source = () => editor.bridge.getSource();

	test('hides its runs in live mode and shows them in source mode', async ({ page }) => {
		await expect(page.locator(`${BLOCK} mark.harness-highlight`)).toHaveText('bright');
		await expect.poll(() => page.locator(BLOCK).innerText()).toBe('A bright word');
		await editor.setPresentationMode('source');
		await expect.poll(() => page.locator(BLOCK).innerText()).toBe('A ==bright== word');
	});

	test('its chord wraps the selection, and again unwraps it', async ({ page }) => {
		await editor.focusBlockAtPath([1], 6);
		for (let i = 0; i < 'words'.length; i++) await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('ControlOrMeta+Shift+h');
		await expect.poll(source).toContain('plain ==words== here');
		await page.keyboard.press('ControlOrMeta+Shift+h');
		await expect.poll(source).toContain('plain words here');
	});

	test('Enter inside it closes it and reopens it after the cut', async ({ page }) => {
		await editor.focusBlockAtPath([0], 7);
		await page.keyboard.press('Enter');
		await expect.poll(source).toMatch(/^A ==bri==\n\n==ght== word\n\nplain words here\n/);
	});

	test('a letter at its end joins it', async ({ page }) => {
		await editor.focusBlockAtPath([0], 10);
		await page.keyboard.type('x');
		await expect.poll(source).toContain('A ==brightx== word');
	});

	test('its run typed pairs itself, and the text typed next lands inside', async ({ page }) => {
		await editor.focusBlockAtPath([1], 'plain words here'.length);
		await page.keyboard.type(' ==');
		await page.keyboard.type('hi');
		await expect.poll(source).toContain('plain words here ==hi==');
	});

	test('at a caret it nests inside strong, by its place', async ({ page }) => {
		await editor.focusBlockAtPath([1], 'plain words here'.length);
		await page.keyboard.type(' ');
		await page.keyboard.press('ControlOrMeta+Shift+h');
		await page.keyboard.press('ControlOrMeta+b');
		await page.keyboard.type('x');
		await expect.poll(source).toContain('plain words here **==x==**');
	});

	test('its chord wraps a word in a table cell', async ({ page }) => {
		const box = (await page.getByText('cell words').boundingBox())!;
		await multiClick(page, { x: box.x + 4, y: box.y + box.height / 2 }, 2);
		await page.keyboard.press('ControlOrMeta+Shift+h');
		await expect.poll(source).toContain('| ==cell== words |');
	});

	test('its chord wraps a range across two blocks in each', async ({ page }) => {
		await editor.focusBlockAtPath([0], 13);
		for (let i = 0; i < 'word'.length + 1 + 'plain'.length; i++)
			await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('ControlOrMeta+Shift+h');
		await expect.poll(source).toContain('A ==bright== ==word==\n');
		expect(await source()).toContain('\n==plain');
	});
});
