import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Contract: copy from a code block produces a literal clipboard (Obsidian-
// style). Previously the copy path stripped fence-only lines from partial
// selections to avoid orphan fences leaking into documents on paste; that
// policy silently dropped content the user had selected. The fence-conflict
// concern now lives entirely on the paste side — when the target is a code
// block, `computeCodePaste` bumps the outer fence to a longer run so any
// pasted fence stays literal inside the block. Paste into a paragraph of
// content containing a lone fence will produce an unclosed code block, by
// design (matches what the user asked to paste).

test.describe('code block partial copy: literal clipboard', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+A copy of full code block preserves both fences verbatim', async () => {
		await editor.loadContent('```\n1\n2\n```\n');
		await editor.getBlock(0).click();
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toBe('```\n1\n2\n```');
	});

	test('partial copy including opening fence preserves it on clipboard', async ({ page }) => {
		await editor.loadContent('```\n1\n2\n```\n');
		await editor.getBlock(0).click();
		// textContent = "```\n1\n2\n```": select [0..7) — "```\n1\n2\n".
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('Shift+ArrowRight');
		}
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		// Clipboard must retain the opening fence — no silent drop.
		expect(clip).toContain('```');
		expect(clip).toContain('1');
		expect(clip).toContain('2');
	});

	test('partial copy including closing fence preserves it on clipboard', async ({ page }) => {
		await editor.loadContent('```\n1\n2\n```\n');
		await editor.getBlock(0).click();
		// Select from offset 4 ('1') through offset 11 (end of closing fence).
		await editor.focusBlock(0, 4);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('Shift+ArrowRight');
		}
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toContain('```');
		expect(clip).toContain('1');
		expect(clip).toContain('2');
	});

	test('lone-fence selection copies the fence literally (not empty string)', async ({ page }) => {
		await editor.loadContent('```\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 3; i++) {
			await page.keyboard.press('Shift+ArrowRight');
		}
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		const clip = await editor.page.evaluate(() => navigator.clipboard.readText());
		expect(clip).toBe('```');
	});

	test('full code block copy, paste into another code block: outer fence bumps, body stays literal', async () => {
		await editor.loadContent('```\nhello\n```\n\n```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.pressKey('Control+a');
		await editor.page.waitForTimeout(100);
		await editor.pressKey('Control+c');
		await editor.page.waitForTimeout(200);

		// Drop caret inside the second (empty) code block, between its fences.
		await editor.getBlock(1).click();
		await editor.focusBlockStart(1);
		for (let i = 0; i < 4; i++) await editor.pressKey('ArrowRight');
		await editor.pressKey('Control+v');
		await editor.page.waitForTimeout(300);

		const source = await editor.getSource();
		// Original block survives untouched.
		expect(source).toMatch(/^```\nhello\n```$/m);
		// Target block's outer fence bumped to ```` (4 backticks) and the body
		// contains the pasted content verbatim — the inner ``` lines display
		// as literal body text, not as parser-consumed fences.
		expect(source).toContain('````\n```\nhello\n```\n````');
	});
});
