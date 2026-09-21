import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { roundTripStable } from '../../plugins/helpers';

// A splice inside the opener renders a fence that is not in the bytes; one inside the closer
// breaks the fence outright. Requirements: `enter-splice.md`.

test.describe('code block: Enter on the opener fence line', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at raw offset 0 of a closed fence: opener intact, blank first body line', async () => {
		await editor.loadContent('```js\nconst x = 1;\n```\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\n\nconst x = 1;\n```\n');

		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		// Rendered text must match the raw: an extra fence adds bytes the raw does not have.
		expect(await editor.getBlockText(0)).toBe('```js\n\nconst x = 1;\n```');

		await editor.typeSlowly('y');
		await editor.bridge.waitForSourceEquals('```js\n\nyconst x = 1;\n```\n');
	});

	test('repeated Enter at the top does not cascade', async () => {
		await editor.loadContent('```js\nconst x = 1;\n```\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\n\nconst x = 1;\n```\n');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\n\n\nconst x = 1;\n```\n');

		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		expect(await roundTripStable(editor.page)).toBe(true);
	});

	test('Enter at the end of the opener line keeps its behavior: caret on the new blank line', async ({
		page
	}) => {
		await editor.loadContent('```js\nconst x = 1;\n```\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
		await editor.page.keyboard.press('Enter');
		await editor.typeSlowly('z');
		await editor.bridge.waitForSourceEquals('```js\nz\nconst x = 1;\n```\n');
	});
});

test.describe('code block: Enter on the closer fence line', () => {
	let editor: EditorPage;

	// display "```js\nconst x = 1\n```": body ends at 17, closer text runs [18,21).
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('```js\nconst x = 1\n```\n');
	});

	test('Enter inside the closer text clamps to the body end: fence intact', async () => {
		await editor.focusBlock(0, 19);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\nconst x = 1\n\n```\n');

		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		expect(await roundTripStable(editor.page)).toBe(true);
	});
});
