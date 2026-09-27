import { test, expect } from '../../fixtures';
import { enterPresentationMode } from './helpers';

// An ATX heading's closing `#` run is drawn as a marker after the text: dimmed in source mode,
// hidden in live mode, where the keys at the text's end keep it after the text.
// Requirements: e2e/requirements/presentation/atx-closing-run.md.

const DOC = '# Hi #\n\nnext\n';

test.describe('the closing run on screen', () => {
	test('source mode shows it after the text', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		expect(await ep.getBlock(0).innerText()).toBe('# Hi #');
	});

	test('live mode hides it', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		expect(await ep.getBlock(0).innerText()).toBe('Hi');
	});
});

test.describe('live mode: keys at the end of the text', () => {
	test('a typed key lands before the closing run', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await ep.focusBlockAtPath([0], 3);
		await page.keyboard.press('End');
		await ep.typeSlowly('x');
		await ep.bridge.waitForSourceEquals('# Hix #\n\nnext\n');
	});

	test('Backspace takes the last character and keeps the run', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await ep.focusBlockAtPath([0], 3);
		await page.keyboard.press('End');
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceEquals('# H #\n\nnext\n');
	});

	test('a typed space stays text, and the next key follows it', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await ep.focusBlockAtPath([0], 3);
		await page.keyboard.press('End');
		await ep.typeSlowly(' ');
		await ep.bridge.waitForSourceEquals('# Hi  #\n\nnext\n');
		await ep.typeSlowly('x');
		await ep.bridge.waitForSourceEquals('# Hi x #\n\nnext\n');
	});

	test('a typed closing run turns back into text with the next key', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', '# Hi\n\nnext\n');
		await ep.focusBlockAtPath([0], 3);
		await page.keyboard.press('End');
		await ep.typeSlowly(' #');
		await ep.bridge.waitForSourceEquals('# Hi #\n\nnext\n');
		await ep.typeSlowly('t');
		await ep.bridge.waitForSourceEquals('# Hi #t\n\nnext\n');
	});
});
