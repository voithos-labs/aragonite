import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import {
	PARAGRAPH,
	PNG,
	getCalls,
	gotoWithHook,
	pasteFiles,
	setResponses
} from './image-paste-harness';

// The `onPasteImage` host hook where the paste lands inside one block: placement, undo, the
// cases it declines, and the same behavior on every editable element. Cross-block replacement
// lives in `image-paste-cross-block.spec.ts`. See `requirements/clipboard/image-paste.md`.

/** Caret between `A` and `B` of the first paragraph, placed by click + keys. */
async function caretMidParagraph(editor: EditorPage, page: Page): Promise<void> {
	await editor.getBlock(0).click();
	await page.keyboard.press('Home');
	await page.keyboard.press('ArrowRight');
}

test.describe('image paste: host hook installed', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = await gotoWithHook(page);
	});

	test('the returned markdown lands at the caret and undoes in one step', async ({ page }) => {
		await editor.loadContent(PARAGRAPH);
		await setResponses(page, [{ markdown: '![[shot.png]]' }]);
		await caretMidParagraph(editor, page);
		await pasteFiles(page, [PNG]);

		await editor.bridge.waitForSourceContains('A![[shot.png]]B');
		expect(await getCalls(page)).toEqual([
			{ mimeType: 'image/png', suggestedName: 'shot.png', bytes: 4 }
		]);

		await page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceNotContains('shot.png');
		expect(await editor.bridge.getSource()).toContain('AB');
	});

	// Every other paste route replaces the selection, and this one is another way in that
	// has to follow the same rule.
	test('an image pasted over a selection replaces it', async ({ page }) => {
		await editor.loadContent(PARAGRAPH);
		await setResponses(page, [{ markdown: '![[shot.png]]' }]);
		await editor.getBlock(0).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await pasteFiles(page, [PNG]);

		await editor.bridge.waitForSourceContains('![[shot.png]]');
		expect((await editor.bridge.getSource()).trim()).toBe('![[shot.png]]');
	});

	test('a rejected import reports an error, its sibling still lands, editing continues', async ({
		page
	}) => {
		await editor.loadContent(PARAGRAPH);
		await page.evaluate(() => (window as any).__test.startErrorCapture());
		await setResponses(page, [{ reject: true }, { markdown: '![[two.png]]' }]);
		await caretMidParagraph(editor, page);
		await pasteFiles(page, [
			{ name: 'one.png', type: 'image/png' },
			{ name: 'two.png', type: 'image/png' }
		]);

		await editor.bridge.waitForSourceContains('A![[two.png]]B');
		expect(await page.evaluate(() => (window as any).__test.getCapturedErrors())).toContain(
			'clipboard'
		);

		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('![[two.png]]XB');
	});

	// Each editable element finishes the shared insertion its own way (a raw traversal plus escaping
	// for a cell, `currentRange()` for code), so a passing paragraph proves neither.
	test('an image pasted into a table cell lands in that cell', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		await setResponses(page, [{ markdown: '![[cell.png]]' }]);
		// nth(2): .table-cell covers the header row too, so the body cells start at 2.
		await page.locator('.table-cell').nth(2).click();
		await page.keyboard.press('End');
		await pasteFiles(page, [PNG]);

		await editor.bridge.waitForSourceContains('1![[cell.png]]');
		expect(await editor.parseConverged()).toBe(true);
	});

	test('an image pasted into a code block lands as literal source', async ({ page }) => {
		await editor.loadContent('```\ncode\n```\n');
		await setResponses(page, [{ markdown: '![[fenced.png]]' }]);
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await pasteFiles(page, [PNG]);

		await editor.bridge.waitForSourceContains('code![[fenced.png]]');
		expect(await editor.parseConverged()).toBe(true);
	});
});

test.describe('image paste: no host hook', () => {
	test('an image-bearing paste pastes the clipboard text, as before the hook existed', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(PARAGRAPH);
		await caretMidParagraph(editor, page);
		await pasteFiles(page, [PNG], 'PLAIN');

		await editor.bridge.waitForSourceContains('APLAINB');
	});
});
