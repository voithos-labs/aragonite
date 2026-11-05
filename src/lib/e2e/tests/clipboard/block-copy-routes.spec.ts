import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { wholeBlockInput } from '../../whole-block-input';
import { refuseClipboardWrites } from '../../clipboard-arm';

// Every route that puts a whole block on the clipboard writes the same text, and a clipboard that
// refuses the write leaves the document and the page as they were.
// Requirements: `requirements/clipboard/block-copy-routes.md`.

const DOC = 'above\n\n---\n\n```js\nx\n```\n\nbelow\n';

const breakBlock = (page: Page) => page.locator('.thematic-break-block');

async function focusBreak(editor: EditorPage): Promise<void> {
	await editor.focusBlockEnd(0);
	await editor.page.keyboard.press('ArrowDown');
	await expect(wholeBlockInput(breakBlock(editor.page))).toBeFocused();
}

async function menuCopy(page: Page, block: string, row: string): Promise<void> {
	await page.locator(block).first().click({ button: 'right' });
	await page.getByRole('menuitem', { name: row }).click();
}

test.describe("a block's clipboard text", () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await editor.loadContent(DOC);
	});

	test("the menu's Copy writes what Mod+C writes for the same block", async ({ page }) => {
		await focusBreak(editor);
		await page.keyboard.press('ControlOrMeta+c');
		await editor.waitForClipboardContains('---', 5000);
		const byKey = await editor.readClipboard();

		await editor.seedClipboard('');
		await menuCopy(page, '.thematic-break-block', 'Copy divider');
		await editor.waitForClipboardContains('---', 5000);
		expect(await editor.readClipboard()).toBe(byKey);
		expect(byKey).toBe('---');
	});

	test("the menu's Copy writes a code block without its closing line ending", async ({ page }) => {
		await menuCopy(page, '[data-block-kind="fencedCode"]', 'Copy code block');
		await editor.waitForClipboardContains('```js', 5000);
		// The Windows clipboard hands back CRLF for the LF it was given.
		expect((await editor.readClipboard()).replace(/\r\n/g, '\n')).toBe('```js\nx\n```');
	});

	test("the code block's Copy code button writes the code without its closing line ending", async ({
		page
	}) => {
		await editor.loadContent('```js\nlet a = 1\n```\n');
		const code = page.locator('[data-block-kind="fencedCode"]').first();
		await code.hover();
		await code.getByRole('button', { name: 'Copy code' }).click();
		await editor.waitForClipboardContains('let a = 1', 5000);
		expect(await editor.readClipboard()).toBe('let a = 1');
	});
});

// Miss-analysis: every copy test ran with a clipboard that accepts, and the menu's Copy had no
// catch, so a webview refusing the write raised an unhandled rejection no row ever provoked.
test.describe('a refused clipboard write changes nothing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await editor.loadContent(DOC);
		await refuseClipboardWrites(page);
	});

	test("the menu's Copy", async ({ page }) => {
		await menuCopy(page, '.thematic-break-block', 'Copy divider');
		await editor.waitForClipboardWrite();
		expect(await editor.bridge.getSource()).toBe(DOC);
	});

	for (const chord of ['ControlOrMeta+c', 'ControlOrMeta+x']) {
		test(`${chord} on a focused block`, async ({ page }) => {
			await focusBreak(editor);
			await page.keyboard.press(chord);
			await editor.waitForNoSourceMutation();
			expect(await editor.bridge.getSource()).toBe(DOC);
		});
	}

	test("the code block's Copy code button reports nothing copied", async ({ page }) => {
		const code = page.locator('[data-block-kind="fencedCode"]').first();
		await code.hover();
		await code.getByRole('button', { name: 'Copy code' }).click();
		await editor.waitForClipboardWrite();
		await expect(code.getByRole('button', { name: 'Code copied' })).toHaveCount(0);
	});
});
