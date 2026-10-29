import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { clickEnd, clickWordSettled } from '../presentation/helpers';
import { waitForFirstImageLoaded } from '../blocks/image/helpers';
import { edgeKey, isMacOS } from '../../platform-keys';

// Cmd+Arrow is read as an edge key, never a step across blocks; the chords are sent literally on
// every engine. Where each edge key lands is `caret/motion-class.spec.ts`. Requirements:
// `requirements/keyboard-navigation/edge-chords.md`.

const IMAGE = '![pic](/test-fixtures/sample.png)';

async function open(page: Page, doc: string): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto();
	await ep.loadContent(doc);
	return ep;
}

const focusOf = (ep: EditorPage) => ep.bridge.getSelectionPaths().then((sel) => sel?.focus);

test.describe('Cmd+Arrow is an edge key, never a step across blocks', () => {
	test("Cmd+Up on a paragraph's first line keeps the caret in its block", async ({ page }) => {
		const ep = await open(page, 'one\n\ntwo\n');
		await clickWordSettled(ep, page, 'two');
		await page.keyboard.press('Meta+ArrowUp');
		await ep.waitForRenderFlush();
		expect((await focusOf(ep))?.path).toEqual([1]);
	});

	test("Cmd+Left at a block's start keeps the caret in its block", async ({ page }) => {
		const ep = await open(page, 'one\n\ntwo\n');
		await clickWordSettled(ep, page, 'two');
		await page.keyboard.press(edgeKey('lineStart'));
		await ep.waitForRenderFlush();
		await page.keyboard.press('Meta+ArrowLeft');
		await ep.waitForRenderFlush();
		expect(await focusOf(ep)).toEqual({ path: [1], offset: 0 });
	});

	test('Cmd+Up in a table cell keeps the caret in its cell', async ({ page }) => {
		const ep = await open(page, '| a | b |\n| - | - |\n| c | d |\n');
		await clickWordSettled(ep, page, 'd');
		const before = (await focusOf(ep))?.path;
		await page.keyboard.press('Meta+ArrowUp');
		await ep.waitForRenderFlush();
		expect((await focusOf(ep))?.path).toEqual(before);
	});

	// The reader reads the raw Meta flag: a folded Ctrl-or-Cmd would make this the line start the
	// leading image's site places.
	test('Ctrl+Left still steps a word on Windows and Linux', async ({ page }) => {
		test.skip(isMacOS, 'Ctrl+Arrow is no word step on macOS');
		const ep = await open(page, `${IMAGE} alpha beta\n`);
		await waitForFirstImageLoaded(page);
		await clickEnd(ep, page, 'beta');
		await page.keyboard.press('Control+ArrowLeft');
		await page.keyboard.press('Z');
		await expect.poll(() => ep.bridge.getSource()).toBe(`${IMAGE} alpha Zbeta\n`);
	});
});
