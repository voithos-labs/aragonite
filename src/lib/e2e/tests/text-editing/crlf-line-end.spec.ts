import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { pointAtRaw } from '../../text-runs';
import { edgeKey, extendKey } from '../../platform-keys';

// A CRLF pair edits as one character at a line end, whatever the engine lets its caret do there.
// Requirements: e2e/requirements/text-editing/crlf-line-end.md.

const PARAGRAPH = 'abc\r\nAfter\r\n';
const CODE = '```\r\nabc\r\nxyz\r\n```\r\n';
const MODES = ['source', 'live'] as const;

/** The source with `\r` and `\n` spelled out, so a diff shows a lone one. */
const escaped = (source: string) => JSON.stringify(source);

async function expectSource(editor: EditorPage, expected: string): Promise<void> {
	await expect.poll(async () => escaped(await editor.bridge.getSource())).toBe(escaped(expected));
}

/** A click past the end of the block's first line, where the engine puts its own line-end caret. */
async function clickPastFirstLineEnd(editor: EditorPage, page: Page): Promise<void> {
	const line = await pointAtRaw(page, [0], 0);
	const box = await editor.getBlock(0).boundingBox();
	await page.mouse.click(box!.x + box!.width - 4, line.y);
	await editor.waitForRenderFlush();
}

test.describe('text editing, a CRLF line end', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const mode of MODES) {
		test.describe(`(${mode})`, () => {
			test.beforeEach(async () => {
				await editor.setPresentationMode(mode);
			});

			test('a letter typed after End goes before the pair', async ({ page }) => {
				await editor.loadContent(PARAGRAPH);
				await editor.focusBlockStart(0);
				await page.keyboard.press(edgeKey('lineEnd'));
				await page.keyboard.press('Z');
				await expectSource(editor, 'abcZ\r\nAfter\r\n');
			});

			test('a letter typed after a click past the line end goes before the pair', async ({
				page
			}) => {
				await editor.loadContent(PARAGRAPH);
				await clickPastFirstLineEnd(editor, page);
				await page.keyboard.press('Z');
				await expectSource(editor, 'abcZ\r\nAfter\r\n');
			});

			test('a letter typed over Shift+End keeps the pair', async ({ page }) => {
				await editor.loadContent(PARAGRAPH);
				await editor.focusBlockStart(0);
				await page.keyboard.press(extendKey('lineEnd'));
				await page.keyboard.press('Z');
				await expectSource(editor, 'Z\r\nAfter\r\n');
			});

			test('a caret a commit names between the pair lands before it', async ({ page }) => {
				await editor.loadContent(PARAGRAPH);
				await page.evaluate(() => (window as any).__test.spliceSource('abX\r\nAfter\r\n', 4));
				await editor.waitForRenderFlush();
				const inPair = await page.evaluate(() => {
					const { focusNode, focusOffset } = window.getSelection()!;
					const text = focusNode instanceof Text ? focusNode.data : '';
					return text[focusOffset - 1] === '\r' && text[focusOffset] === '\n';
				});
				expect(inPair).toBe(false);
				await page.keyboard.press('Z');
				await expectSource(editor, 'abXZ\r\nAfter\r\n');
			});

			test('a letter typed after End in a code body goes before the pair', async ({ page }) => {
				await editor.loadContent(CODE);
				await editor.focusBlockAtPath([0], 5);
				await page.keyboard.press(edgeKey('lineEnd'));
				await page.keyboard.press('Z');
				await expectSource(editor, '```\r\nabcZ\r\nxyz\r\n```\r\n');
			});
		});
	}
});
