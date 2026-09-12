import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// The caret's every door into and out of a fence whose lines the mode hides: the landable
// bounds are the body's, and no edge press may reach a hidden fence line.
// Requirements: e2e/requirements/blocks/code/live-navigation.md.

const DOC = 'Before\n\n```js\nconst x = 1;\nfoo();\n```\n\nAfter\n';
// Raw offsets inside block [1]: the opener line is 6 bytes, the body runs 6..25.
const BODY_START = 6;
const LINE_TWO = 19;
const BODY_END = 25;

async function landedIn(editor: EditorPage): Promise<number | undefined> {
	return (await editor.bridge.getSelectionPaths())?.anchor.path[0];
}

test.describe('code block in live mode — arrows at every edge', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await editor.loadContent(DOC);
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'live');
	});

	test('ArrowRight from the block above lands at the body start', async ({ page }) => {
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('```js\nXconst x = 1;');
	});

	test('ArrowLeft at the body start leaves to the end of the block above', async ({ page }) => {
		await editor.focusBlockAtPath([1], BODY_START);
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('BeforeX\n');
	});

	test('ArrowRight at the body end leaves to the start of the block below', async ({ page }) => {
		await editor.focusBlockAtPath([1], BODY_END);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('\nXAfter');
	});

	test('ArrowLeft from the block below lands at the body end', async ({ page }) => {
		await editor.focusBlockStart(2);
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('foo();X\n```');
	});

	test('ArrowDown walks the body lines, then leaves below; ArrowUp mirrors it', async ({
		page
	}) => {
		// A real click seats the caret and settles the sticky column the vertical walk reads;
		// each read then polls for a landing the handler awaits.
		await editor.clickBlockAtPath([0], 6);
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => landedIn(editor)).toBe(1);
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => landedIn(editor)).toBe(1);
		await page.keyboard.press('ArrowDown');
		await expect.poll(() => landedIn(editor)).toBe(2);

		await page.keyboard.press('ArrowUp');
		await expect.poll(() => landedIn(editor)).toBe(1);
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => landedIn(editor)).toBe(1);
		await page.keyboard.press('ArrowUp');
		await expect.poll(() => landedIn(editor)).toBe(0);
	});
});

test.describe('code block in live mode — line extremes and the fence lines', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await editor.loadContent(DOC);
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'live');
	});

	test('Home on the first body line seats at its column 0, not in the hidden opener', async ({
		page
	}) => {
		await editor.focusBlockAtPath([1], BODY_START + 4);
		await page.keyboard.press('Home');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('```js\nXconst x = 1;');
	});

	test('End on the last body line seats after its last byte, not past the hidden closer', async ({
		page
	}) => {
		await editor.focusBlockAtPath([1], LINE_TWO + 2);
		await page.keyboard.press('End');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('foo();X\n```');
	});

	test('Enter at the body end opens a line inside the fence; a second Enter leaves below', async ({
		page
	}) => {
		await editor.focusBlockAtPath([1], BODY_END);
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('foo();\n\n```');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('foo();\nX\n```');

		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Y');
		await editor.bridge.waitForSourceEquals(
			'Before\n\n```js\nconst x = 1;\nfoo();\nX\n```\n\nYAfter\n'
		);
	});

	// The closer is hidden here, so typing one is the reader asking to leave rather than to
	// author bytes: the run never lands, and the caret arrives in the block that was already below.
	test('a closer typed on the empty last line leaves below, writing none of its bytes', async ({
		page
	}) => {
		await editor.focusBlockAtPath([1], BODY_END);
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('foo();\n\n```');

		await page.keyboard.type('```');
		await page.keyboard.type('Y');

		await editor.bridge.waitForSourceEquals(
			'Before\n\n```js\nconst x = 1;\nfoo();\n```\n\nYAfter\n'
		);
	});

	test('Backspace at the body start leaves upward and the fence stays whole', async ({ page }) => {
		await editor.focusBlockAtPath([1], BODY_START);
		await page.keyboard.press('Backspace');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceEquals(
			'BeforeX\n\n```js\nconst x = 1;\nfoo();\n```\n\nAfter\n'
		);
	});

	test('Backspace on the last byte of a one-character body empties it without reaching the fence', async ({
		page
	}) => {
		await editor.loadContent('```js\na\n```\n\nAfter\n');
		await editor.focusBlockAtPath([0], 7);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('```js\n\n```\n\nAfter\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		await expect(page.locator('.code-lang-picker')).toHaveCount(0);
	});

	test('Tab at a body line start indents the line', async ({ page }) => {
		await editor.focusBlockAtPath([1], BODY_START);
		await page.keyboard.press('Tab');
		await editor.bridge.waitForSourceContains('```js\n\tconst x = 1;');
	});
});

test.describe('code block in live mode — an empty fence', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await editor.loadContent('Before\n\n```\n```\n\nAfter\n');
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'live');
	});

	test('ArrowRight from above completes the fence and types into its body line', async ({
		page
	}) => {
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowRight');
		await editor.bridge.waitForSourceEquals('Before\n\n```\n\n```\n\nAfter\n');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceEquals('Before\n\n```\nX\n```\n\nAfter\n');
	});

	test('ArrowLeft from below enters, and ArrowLeft again leaves to the block above', async ({
		page
	}) => {
		await editor.focusBlockStart(2);
		await page.keyboard.press('ArrowLeft');
		await editor.bridge.waitForSourceEquals('Before\n\n```\n\n```\n\nAfter\n');
		expect(await landedIn(editor)).toBe(1);
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('BeforeX\n');
	});
});
