import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from './helpers';

// Enter at the end of a lone `$$` completes the fence pair the adjacent-line grammar could never be
// typed into — the plugin-surface twin of the built-in table registrant. The source bytes are the
// oracle, and where the caret landed is read by typing into it rather than by asking for it.
// Requirements: e2e/requirements/plugins/latex-typed-formation.md.

const COMPLETED = '$$\n\n$$\n';

interface ModeProbe {
	__test: { setPresentationMode(mode: string): void };
}

async function setMode(page: Page, mode: 'live' | 'reading'): Promise<void> {
	await page.evaluate((m) => (window as unknown as ModeProbe).__test.setPresentationMode(m), mode);
}

/** Type `text` at the end of block `index` and press Enter there. */
async function typeAndEnter(editor: EditorPage, index: number, text: string): Promise<void> {
	await editor.clickBlock(index);
	await editor.page.keyboard.press('End');
	await editor.waitForRenderFlush();
	await editor.typeSlowly(text);
	await editor.bridge.waitForSourceContains(text);
	await editor.waitForRenderFlush();
	await editor.page.keyboard.press('Enter');
}

test.describe('block math: typed formation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mathblock');
		await editor.loadContent('\n');
	});

	test('a lone $$ plus Enter becomes one math block around an empty body', async () => {
		await typeAndEnter(editor, 0, '$$');

		await editor.bridge.waitForSourceEquals(COMPLETED);
		expect(await editor.bridge.getBlockKind(0)).toBe('mathBlock');
		expect(await editor.bridge.getBlockCount()).toBe(1);
	});

	// A revealed source commits on blur, so the block above is both the blur target and the proof
	// that the completion replaced only its own slot.
	test('the caret lands on the body line, so the typed expression lands there', async ({
		page
	}) => {
		await editor.loadContent('Before\n\n\n');
		await typeAndEnter(editor, 1, '$$');
		await editor.bridge.waitForSourceContains(COMPLETED);

		await page.keyboard.type('x^2');
		await editor.getBlock(0).click();

		await editor.bridge.waitForSourceContains('$$\nx^2\n$$\n');
	});

	test('one undo restores the paragraph byte-for-byte with the caret at its end', async ({
		page
	}) => {
		await typeAndEnter(editor, 0, '$$');
		await editor.bridge.waitForSourceEquals(COMPLETED);

		await editor.undo();
		await editor.bridge.waitForSourceEquals('$$\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');

		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceEquals('$$Z\n');
	});

	// An opener line carrying body text implies no multi-line form, so it leaves the shape any
	// tail-block split leaves rather than a shape of its own.
	test('an opener carrying body text falls through to the ordinary split', async () => {
		await typeAndEnter(editor, 0, '$$ x');

		await editor.bridge.waitForBlockCount(2);
		await editor.bridge.waitForSourceEquals('$$ x\n\n\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
	});

	test('live mode mints the same block and lands the expression in its body', async ({ page }) => {
		await editor.loadContent('Before\n\n\n');
		await setMode(page, 'live');
		await editor.waitForRenderFlush();
		await typeAndEnter(editor, 1, '$$');
		await editor.bridge.waitForSourceContains(COMPLETED);

		await page.keyboard.type('x^2');
		await editor.getBlock(0).click();

		await editor.bridge.waitForSourceContains('$$\nx^2\n$$\n');
	});

	test('reading mode leaves the bytes alone', async ({ page }) => {
		await editor.loadContent('$$\n');
		await setMode(page, 'reading');
		await editor.waitForRenderFlush();
		await editor.clickBlock(0);
		await page.keyboard.press('Enter');
		await editor.waitForRenderFlush();

		await editor.bridge.waitForSourceEquals('$$\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
	});
});

// Recognition is gated on installation, and so is completion: the editor harness loads no plugins,
// so the same keystrokes must leave bare GFM's own shape.
test.describe('block math: typed formation without the plugin', () => {
	test('$$ plus Enter splits like any other paragraph', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('\n');

		await typeAndEnter(editor, 0, '$$');

		await editor.bridge.waitForBlockCount(2);
		await editor.bridge.waitForSourceEquals('$$\n\n\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
	});
});
