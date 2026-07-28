import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Where Enter splices its newline inside a fenced code block: clamped out of
// both fence lines (a splice inside the opener made sliceFencedCode render a
// phantom fence; one inside the closer broke the fence outright), and applied to
// the selection's body span when there is a selection. Requirements: enter-splice.md.

test.describe('code block — Enter on the opener fence line', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter at raw offset 0 of a closed fence — opener intact, blank first body line', async () => {
		await editor.loadContent('```js\nconst x = 1;\n```\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\n\nconst x = 1;\n```\n');

		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		// Rendered text must match the raw — a phantom fence adds bytes the raw lacks.
		expect(await editor.getBlockText(0)).toBe('```js\n\nconst x = 1;\n```');

		// Caret stays with the content, now the second body line.
		await editor.typeSlowly('y');
		await editor.bridge.waitForSourceEquals('```js\n\nyconst x = 1;\n```\n');
	});

	test('Enter at raw offset 0 of an unclosed fence — same clamp, opener intact', async () => {
		await editor.loadContent('```js\nconst x = 1\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\n\nconst x = 1\n');
	});

	test('Enter mid-opener clamps to the body start — never splits the opener text', async () => {
		await editor.loadContent('```js\nconst x = 1;\n```\n');
		await editor.focusBlock(0, 3);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\n\nconst x = 1;\n```\n');
	});

	test('repeated Enter at the top does not cascade', async () => {
		await editor.loadContent('```js\nconst x = 1;\n```\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\n\nconst x = 1;\n```\n');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\n\n\nconst x = 1;\n```\n');

		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		expect(await editor.page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	test('Enter at the end of the opener line keeps its behavior — caret on the new blank line', async ({
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

test.describe('code block — Enter on the closer fence line', () => {
	let editor: EditorPage;

	// display "```js\nconst x = 1\n```": body ends at 17, closer text runs [18,21).
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('```js\nconst x = 1\n```\n');
	});

	test('Enter inside the closer text clamps to the body end — fence intact', async () => {
		await editor.focusBlock(0, 19);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\nconst x = 1\n\n```\n');

		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		expect(await editor.page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
	});

	test('Enter at the start of the closer line keeps its blank-line behavior', async () => {
		await editor.focusBlock(0, 18);
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\nconst x = 1\n\n```\n');
	});
});

test.describe('code block — Enter over a selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('```js\nconst x = 1\n```\n');
	});

	test('Enter replaces the selected text with the newline', async () => {
		await editor.focusBlock(0, 12);
		for (let i = 0; i < 5; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\nconst \n\n```\n');
	});

	test('Enter over a selection reaching into the closer keeps the fence', async () => {
		await editor.focusBlock(0, 12);
		for (let i = 0; i < 8; i++) await editor.page.keyboard.press('Shift+ArrowRight');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```js\nconst \n\n```\n');

		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});
});
