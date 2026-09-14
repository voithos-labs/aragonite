import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { nativeSelectionText, pastLineEnd, runCenter } from './multi-click-helpers';

// The word rung of the click ladder (requirements/selection/multi-click-word.md), driven with
// real double-clicks on the plugins page so a rendered formula stands beside the word.

test.describe('multi-click: the word rung', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('math');
	});

	async function doubleClickOn(needle: string): Promise<void> {
		const at = await runCenter(editor.page, needle);
		await editor.page.mouse.dblclick(at.x, at.y);
	}

	for (const mode of ['source', 'live'] as const) {
		test(`${mode}: a word before an inline formula is taken alone`, async ({ page }) => {
			await editor.loadContent('word $x^2$ after\n');
			await editor.setPresentationMode(mode);
			await expect(page.locator('[data-inline-widget]')).toHaveCount(1);
			await doubleClickOn('word');
			await expect.poll(() => nativeSelectionText(page)).toBe('word');
		});

		test(`${mode}: a word before an entity glyph drops its trailing space`, async ({ page }) => {
			await editor.loadContent('a word &copy; after\n');
			await editor.setPresentationMode(mode);
			await doubleClickOn('word');
			await expect.poll(() => nativeSelectionText(page)).toBe('word');
		});
	}

	test('live: the markers around a word never join it', async ({ page }) => {
		await editor.loadContent('some _ital_ words\n');
		await editor.setPresentationMode('live');
		await doubleClickOn('ital');
		await expect.poll(() => nativeSelectionText(page)).toBe('ital');
	});

	test('a word in a table cell is taken alone', async ({ page }) => {
		await editor.loadContent('| a | b |\n| --- | --- |\n| one two | c |\n');
		await doubleClickOn('two');
		await expect.poll(() => nativeSelectionText(page)).toBe('two');
	});

	test("a word in a code block's body is taken alone", async ({ page }) => {
		await editor.loadContent('```\nconst value = 1\n```\n');
		await doubleClickOn('value');
		await expect.poll(() => nativeSelectionText(page)).toBe('value');
	});

	test('a double-click past the end of a line takes its last word', async ({ page }) => {
		await editor.loadContent('alpha beta gamma\n');
		const at = await pastLineEnd(page, 'gamma');
		await page.mouse.dblclick(at.x, at.y);
		await expect.poll(() => nativeSelectionText(page)).toBe('gamma');
	});

	test('typing over the word replaces it and nothing else', async ({ page }) => {
		await editor.loadContent('alpha beta gamma\n');
		await doubleClickOn('beta');
		await expect.poll(() => nativeSelectionText(page)).toBe('beta');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceEquals('alpha X gamma\n');
	});
});
