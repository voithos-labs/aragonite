import { test, expect } from '../../fixtures';
import { capturePageErrors } from '../../page-probes';
import { EditorPage } from '../../editor-page';
import {
	count,
	findInput,
	openFind,
	openReplace,
	overlays,
	replaceInput,
	typeQuery
} from './helpers';

test.describe('search: open and close', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('alpha beta\n\ngamma alpha\n');
	});

	test('Ctrl+F opens the bar and focuses the find input', async ({ page }) => {
		await openFind(editor);
		await expect(findInput(page)).toBeFocused();
	});

	test('Ctrl+H opens the bar with the replace row expanded', async ({ page }) => {
		await openReplace(editor);
		await expect(replaceInput(page)).toBeVisible();
	});

	// CapsLock uppercases e.key without a Shift modifier; pressing an uppercase
	// letter reproduces exactly that event shape.
	test('Ctrl+F and Ctrl+H still open with CapsLock on', async ({ page }) => {
		await editor.clickBlock(0);
		await page.keyboard.press('ControlOrMeta+F');
		await expect(findInput(page)).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(findInput(page)).toHaveCount(0);

		await page.keyboard.press('ControlOrMeta+H');
		await expect(replaceInput(page)).toBeVisible();
	});

	test('Esc closes the bar, clears highlights, and returns focus to the document', async ({
		page
	}) => {
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(overlays(page)).toHaveCount(2);

		await page.keyboard.press('Escape');
		await expect(findInput(page)).toHaveCount(0);
		await expect(overlays(page)).toHaveCount(0);
		// Focus returns to the document (the editor root), not stranded on <body>.
		await expect
			.poll(() => page.evaluate(() => !!document.activeElement?.closest('.editor')))
			.toBe(true);
	});

	test('reopening after Esc with an unchanged query re-paints the highlights', async ({ page }) => {
		await openFind(editor);
		await typeQuery(editor, 'alpha');
		await expect(overlays(page)).toHaveCount(2);

		await page.keyboard.press('Escape');
		await expect(overlays(page)).toHaveCount(0);

		// Reopen with no edits between: the retained query must re-scan and re-paint,
		// not serve the closed bar's cleared match set through a stale scan memo.
		await openFind(editor);
		await expect(overlays(page)).toHaveCount(2);
		await expect(count(page)).toHaveText(/1\s*\/\s*2/);
	});
});

test.describe('search: closing returns to the caret', () => {
	const LONG =
		Array.from({ length: 45 }, (_, i) =>
			i === 42 ? 'The zebra lives far below.' : `Line ${i} with some words on it.`
		).join('\n\n') + '\n';

	test('Esc after stepping to a far match scrolls back to the caret, and typing lands there', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(LONG);
		const home = page.locator("[data-block-path='[12]']");
		await home.locator('[contenteditable="true"]').click();
		await page.keyboard.press('End');
		await page.keyboard.press('ControlOrMeta+f');
		await findInput(page).waitFor({ state: 'visible' });
		await typeQuery(editor, 'zebra');
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		await page.keyboard.press('Enter');
		await expect(home).not.toBeInViewport();

		await page.keyboard.press('Escape');
		await expect(findInput(page)).toHaveCount(0);
		await expect(home).toBeInViewport();

		await editor.typeText('x');
		await editor.bridge.waitForSourceContains('Line 12 with some words on it.x');
	});

	test('Esc after a match so far away that the caret’s block left the window still puts it back', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(
			Array.from({ length: 200 }, (_, i) =>
				i === 190 ? 'The zebra lives far below.' : `Line ${i} with some words on it.`
			).join('\n\n') + '\n'
		);
		const home = page.locator("[data-block-path='[1]']");
		await home.locator('[contenteditable="true"]').click();
		await page.keyboard.press('End');
		await page.keyboard.press('ControlOrMeta+f');
		await findInput(page).waitFor({ state: 'visible' });
		await typeQuery(editor, 'zebra');
		await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		await page.keyboard.press('Enter');
		await expect(home).toHaveCount(0);

		await page.keyboard.press('Escape');
		await expect(findInput(page)).toHaveCount(0);
		await expect(home).toBeInViewport();

		await editor.typeText('x');
		await editor.bridge.waitForSourceContains('Line 1 with some words on it.x');
	});
});

test.describe('search: toggles', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// The bar stays open across steps and each toggle stays on, so every step clears the query and
	// reads its own document under the options the steps before it left.
	test('each toggle reshapes the match set, and an invalid regex shows an error state', async ({
		page
	}) => {
		const pageErrors = capturePageErrors(page);

		await test.step('case toggle narrows the match set to the case-sensitive subset', async () => {
			await editor.loadContent('Alpha and alpha and ALPHA\n');
			await openFind(editor);
			await findInput(page).fill('');
			await typeQuery(editor, 'alpha');
			await expect(count(page)).toHaveText(/1\s*\/\s*3/);

			await page.getByRole('button', { name: 'Match case' }).click();
			await expect(count(page)).toHaveText(/1\s*\/\s*1/);
		});

		await test.step('whole-word toggle drops substring-only matches', async () => {
			await editor.loadContent('cat catalog scatter cat\n');
			await openFind(editor);
			await findInput(page).fill('');
			await typeQuery(editor, 'cat');
			await expect(count(page)).toHaveText(/1\s*\/\s*4/);

			await page.getByRole('button', { name: 'Whole word' }).click();
			await expect(count(page)).toHaveText(/1\s*\/\s*2/);
		});

		await test.step('regex toggle interprets the query as a pattern', async () => {
			await editor.loadContent('a1 b2 c3 plain\n');
			await openFind(editor);
			await findInput(page).fill('');
			await typeQuery(editor, '[a-c][0-9]');
			// As a literal, the bracket query matches nothing.
			await expect(count(page)).toHaveText(/No results/);

			await page.getByRole('button', { name: 'Regex' }).click();
			await expect(count(page)).toHaveText(/1\s*\/\s*3/);
		});

		await test.step('invalid regex shows an error state with no count and no highlights', async () => {
			await editor.loadContent('some text here\n');
			await openFind(editor);
			await findInput(page).fill('');
			await typeQuery(editor, '(');

			// Positively assert the error state (the readout carries the `error` class and
			// the compiler's message), not merely the absence of a count.
			await expect(count(page)).toHaveClass(/error/);
			await expect(count(page)).not.toHaveText(/\d+\s*\/\s*\d+/);
			await expect(count(page)).not.toHaveText(/No results/);
			await expect(overlays(page)).toHaveCount(0);
		});

		expect(pageErrors).toEqual([]);
	});
});
