import { type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
import {
	PARAGRAPH,
	PNG,
	getCalls,
	gotoWithHook,
	parseConverged,
	pasteFiles,
	releaseImport,
	setResponses
} from './image-paste-harness';

// The `onPasteImage` host hook where the paste lands inside one block: placement,
// undo, the decline arms, and per-surface parity. Cross-block replacement lives in
// image-paste-cross-block.spec.ts. See requirements/clipboard/image-paste.md.

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

		await page.keyboard.press(`${primaryModifier}+z`);
		await editor.bridge.waitForSourceNotContains('shot.png');
		expect(await editor.bridge.getSource()).toContain('AB');
	});

	test('two images land in clipboard order as one undoable paste', async ({ page }) => {
		await editor.loadContent(PARAGRAPH);
		await setResponses(page, [{ markdown: '![[one.png]]' }, { markdown: '![[two.png]]' }]);
		await caretMidParagraph(editor, page);
		await pasteFiles(page, [
			{ name: 'one.png', type: 'image/png' },
			{ name: 'two.png', type: 'image/png' }
		]);

		await editor.bridge.waitForSourceContains('A![[one.png]]![[two.png]]B');
		await page.keyboard.press(`${primaryModifier}+z`);
		await editor.bridge.waitForSourceNotContains('one.png');
		expect(await editor.bridge.getSource()).not.toContain('two.png');
	});

	// Every other paste route replaces the selection; this one is entry path N+1 and
	// owes the same rule.
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

	test('a caret moved while the import is pending does not redirect the insertion', async ({
		page
	}) => {
		await editor.loadContent(`${PARAGRAPH}\nsecond\n`);
		await setResponses(page, [{ markdown: '![[held.png]]', hold: true }]);
		await caretMidParagraph(editor, page);
		await pasteFiles(page, [{ name: 'held.png', type: 'image/png' }]);

		// A real click into the next block while the host is still uploading.
		await expect.poll(async () => (await getCalls(page)).length).toBe(1);
		await editor.getBlock(1).click();
		await page.keyboard.press('End');
		await releaseImport(page);

		await editor.bridge.waitForSourceContains('A![[held.png]]B');
		expect(await editor.bridge.getSource()).not.toContain('second![[held.png]]');
	});

	test('a null result inserts nothing and does not fall back to the clipboard text', async ({
		page
	}) => {
		await editor.loadContent(PARAGRAPH);
		await setResponses(page, [{ markdown: null }]);
		await caretMidParagraph(editor, page);
		await pasteFiles(page, [PNG], 'PLAIN');

		await expect.poll(async () => (await getCalls(page)).length).toBe(1);
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('PLAIN');
		expect(source).toContain('AB');
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

	test('a non-image attachment leaves the paste on the text path', async ({ page }) => {
		await editor.loadContent(PARAGRAPH);
		await setResponses(page, [{ markdown: '![[wrong.png]]' }]);
		await caretMidParagraph(editor, page);
		await pasteFiles(page, [{ name: 'notes.txt', type: 'text/plain' }], 'PLAIN');

		await editor.bridge.waitForSourceContains('APLAINB');
		expect(await getCalls(page)).toEqual([]);
	});

	// Surface parity: the arm is one seam, but each surface's insertion tail is its
	// own (raw walker + escaping for the cell, `currentRange()` for code). A paragraph
	// pass proves neither.
	test('an image pasted into a table cell lands in that cell', async ({ page }) => {
		await editor.loadContent('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		await setResponses(page, [{ markdown: '![[cell.png]]' }]);
		// nth(2): [role="cell"] covers the header row too, so the body cells start at 2.
		await page.locator('[role="cell"]').nth(2).click();
		await page.keyboard.press('End');
		await pasteFiles(page, [PNG]);

		await editor.bridge.waitForSourceContains('1![[cell.png]]');
		expect(await parseConverged(page)).toBe(true);
	});

	test('an image pasted into a code block lands as literal source', async ({ page }) => {
		await editor.loadContent('```\ncode\n```\n');
		await setResponses(page, [{ markdown: '![[fenced.png]]' }]);
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await pasteFiles(page, [PNG]);

		await editor.bridge.waitForSourceContains('code![[fenced.png]]');
		expect(await parseConverged(page)).toBe(true);
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
