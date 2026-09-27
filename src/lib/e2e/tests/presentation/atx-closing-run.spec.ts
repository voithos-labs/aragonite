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

// The same gesture on the three heading shapes: the structure past the text goes with the text.
test.describe('live mode: emptying the text', () => {
	for (const source of ['# H\n\nnext\n', '# H #\n\nnext\n', 'H\n===\n\nnext\n']) {
		test(`Backspace over the last character of ${JSON.stringify(source)} leaves an empty paragraph`, async ({
			page
		}) => {
			const ep = await enterPresentationMode(page, 'live', source);
			await ep.focusBlockAtPath([0], 1);
			await page.keyboard.press('End');
			await page.keyboard.press('Backspace');
			await ep.bridge.waitForSourceEquals('\nnext\n');
			await ep.typeSlowly('k');
			await ep.bridge.waitForSourceEquals('k\n\nnext\n');
		});
	}

	test('selecting the text and pressing Backspace leaves an empty paragraph', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await ep.focusBlockAtPath([0], 3);
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Home');
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceEquals('\nnext\n');
		await ep.typeSlowly('k');
		await ep.bridge.waitForSourceEquals('k\n\nnext\n');
	});
});

test.describe('live mode: the closing run stays on the heading', () => {
	for (const [source, written] of [
		['# Hi\n\nnext\n', '# H\\\nwi\n\nnext\n'],
		['# Hi #\n\nnext\n', '# H\\ #\nwi\n\nnext\n']
	]) {
		test(`Shift+Enter inside the text of ${JSON.stringify(source)}, then a key`, async ({
			page
		}) => {
			const ep = await enterPresentationMode(page, 'live', source);
			await ep.focusBlockAtPath([0], 3);
			await page.keyboard.press('Shift+Enter');
			await ep.typeSlowly('w');
			await ep.bridge.waitForSourceEquals(written);
		});
	}

	for (const [source, written] of [
		['# Hi\n\nnext\n', '# Hi\n\nabc\n\ndef\n\nnext\n'],
		['# Hi #\n\nnext\n', '# Hi #\n\nabc\n\ndef\n\nnext\n'],
		['Hi\n===\n\nnext\n', 'Hi\n===\n\nabc\n\ndef\n\nnext\n']
	]) {
		test(`pasting two paragraphs at the end of ${JSON.stringify(source)}`, async ({ page }) => {
			const ep = await enterPresentationMode(page, 'live', source);
			await ep.seedClipboard('abc\n\ndef');
			await ep.focusBlockAtPath([0], 1);
			await page.keyboard.press('End');
			await ep.paste();
			await ep.bridge.waitForSourceEquals(written);
		});
	}
});
