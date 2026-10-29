import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { edgeKey, WORD_MODIFIER } from '../../platform-keys';

/**
 * A caret key the editor lands shows the caret where it lands, as the browser's own key would:
 * inside a code block scrolled sideways, and on the page (`requirements/caret/motion-reveal.md`).
 */

const LONG_LINE = `para\n\n\`\`\`js\nconst value = ${'x'.repeat(400)};\nshort\n\`\`\`\n`;

/** Where the caret stands against the scroller's box and the window: in view or not. */
function caretInView(page: Page, scroller: string) {
	return page.evaluate((scroller) => {
		const sel = window.getSelection()!;
		const range = document.createRange();
		const node = sel.focusNode!;
		const at = sel.focusOffset;
		const text = node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
		if (text && at > 0) range.setStart(text, at - 1);
		else range.setStart(node, at);
		range.setEnd(node, text && at === 0 && text.length > 0 ? 1 : at);
		const caret = range.getBoundingClientRect();
		const x = text && at > 0 ? caret.right : caret.left;
		const box = document.querySelector(scroller)!.getBoundingClientRect();
		const inBox = x >= box.left - 1 && x <= box.right + 1;
		const inWindow = caret.top >= -1 && caret.bottom <= window.innerHeight + 1;
		return { inBox, inWindow, x: Math.round(x), left: box.left, right: box.right };
	}, scroller);
}

async function parkInLongLine(page: Page): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(LONG_LINE);
	// Column 20 of the long line, past the fence line's `\`\`\`js` and its line break.
	await editor.focusBlockAtPath([1], 26);
	return editor;
}

test.describe('a caret key the editor lands shows the caret', () => {
	test('End in a long code line scrolls the block to the line’s end', async ({ page }) => {
		await parkInLongLine(page);
		await page.keyboard.press(edgeKey('lineEnd'));
		await expect.poll(async () => (await caretInView(page, '.code-block')).inBox).toBe(true);
	});

	test('Home after End scrolls the block back to the line’s start', async ({ page }) => {
		await parkInLongLine(page);
		await page.keyboard.press(edgeKey('lineEnd'));
		await expect.poll(async () => (await caretInView(page, '.code-block')).inBox).toBe(true);
		await page.keyboard.press(edgeKey('lineStart'));
		await expect.poll(async () => (await caretInView(page, '.code-block')).inBox).toBe(true);
	});

	test('a word key across the long word scrolls the block to the word’s end', async ({ page }) => {
		await parkInLongLine(page);
		await page.keyboard.press(`${WORD_MODIFIER}+ArrowRight`);
		await page.keyboard.press(`${WORD_MODIFIER}+ArrowRight`);
		await expect.poll(async () => (await caretInView(page, '.code-block')).inBox).toBe(true);
	});

	test('the block end in a code block taller than the window scrolls the page to it', async ({
		page
	}) => {
		const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(`para\n\n\`\`\`\n${lines}\n\`\`\`\n`);
		await editor.focusBlockAtPath([1], 6);
		await page.keyboard.press(edgeKey('blockEnd'));
		await expect.poll(async () => (await caretInView(page, '.code-block')).inWindow).toBe(true);
	});
});
