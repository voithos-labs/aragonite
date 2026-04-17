import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Regression: partial single-block selections of a fenced code block used to
// put orphan fence markers on the clipboard. Copying "```\n1\n2" (without the
// closing fence) and pasting elsewhere produced an unclosed code block that
// swallowed everything below it. Copying "1\n2\n```" produced an orphan
// closing fence that parsed into a spurious empty code block.

test.describe('code block partial copy: fence boundary stripping', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+A copy of full code block yields clipboard with symmetric fences', async () => {
		await editor.loadContent('```\n1\n2\n```\n');
		await editor.getBlock(0).click();
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		const lines = clip.split('\n').map((l) => l.trim());
		const firstIsFence = /^`{3,}/.test(lines[0]);
		const lastIsFence = /^`{3,}$/.test(lines[lines.length - 1]);
		// Symmetric: either full fence pair preserved, or both stripped.
		expect(firstIsFence).toBe(lastIsFence);
	});

	test('partial copy (lines 1-3, includes opening fence) never leaves an unpaired fence on the clipboard', async ({
		page
	}) => {
		await editor.loadContent('```\n1\n2\n```\n');
		await editor.getBlock(0).click();
		// textContent = "```\n1\n2\n```": offsets 0-3 = "```\n", 4 = '1', 5 = '\n',
		// 6 = '2', 7 = '\n', 8-10 = '```'. Select [0..7) — "```\n1\n2\n".
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('Shift+ArrowRight');
		}
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		const fenceLineCount = clip.split('\n').filter((l) => /^`{3,}$/.test(l.trim())).length;
		// Orphan opening fence is the bug. Must be zero (stripped) or paired (≥2).
		expect(fenceLineCount % 2).toBe(0);
	});

	test('partial copy (lines 2-4, includes closing fence) never leaves an unpaired fence on the clipboard', async ({
		page
	}) => {
		await editor.loadContent('```\n1\n2\n```\n');
		await editor.getBlock(0).click();
		// Select from offset 4 ('1') through offset 11 (end of closing '```').
		await editor.focusBlock(0, 4);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('Shift+ArrowRight');
		}
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		const fenceLineCount = clip.split('\n').filter((l) => /^`{3,}$/.test(l.trim())).length;
		expect(fenceLineCount % 2).toBe(0);
	});

	test('paste of partial code block copy does not produce orphan fences in the document', async ({
		page
	}) => {
		await editor.loadContent('```\n1\n2\n```\n\nafter\n');
		await editor.getBlock(0).click();
		// Select from the '1' through the closing fence — includes the orphan
		// closing ``` that used to break re-parsing on paste.
		await editor.focusBlock(0, 4);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('Shift+ArrowRight');
		}
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		// Paste after the existing "after" paragraph as a brand-new block.
		await editor.focusBlockEnd(1);
		await editor.pressEnter();
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		// Total fence lines in the document must stay even — the original pair
		// still matches, and the paste must not introduce a lone fence.
		const fenceLineCount = source.split('\n').filter((l) => /^`{3,}$/.test(l.trim())).length;
		expect(fenceLineCount % 2).toBe(0);
	});
});
