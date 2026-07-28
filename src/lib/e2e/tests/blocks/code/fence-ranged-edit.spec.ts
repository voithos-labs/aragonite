import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Ranged edits that span a fence line: every gesture that rewrites a range on the
// code surface (delete, forward-delete, type-over, cut, paste-over, select-all)
// applies to the selection's intersection with the BODY, so neither fence line can
// be rewritten into an unclosed fence that absorbs the rest of the document.
// Requirements: fence-ranged-edit.md.

// Fixture display text "```js\nconst x = 1\n```":
// opener text [0,5) · body [6,17) · closer text [18,21).
const SOURCE = '```js\nconst x = 1\n```\n';
const BODY_MID = 12; // inside "const x = 1", before "x"
const INTO_CLOSER = 8; // Shift+ArrowRight presses to reach offset 20

async function selectFrom(editor: EditorPage, start: number, presses: number) {
	await editor.focusBlock(0, start);
	for (let i = 0; i < presses; i++) await editor.page.keyboard.press('Shift+ArrowRight');
}

test.describe('code block — ranged edits spanning a fence line', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(SOURCE);
		await editor.getBlock(0).click();
	});

	test('Backspace over a body-into-closer selection deletes only the body part', async () => {
		await selectFrom(editor, BODY_MID, INTO_CLOSER);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('const \n');

		expect(await editor.bridge.getSource()).toBe('```js\nconst \n```\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});

	test('Delete over a body-into-closer selection deletes only the body part', async () => {
		await selectFrom(editor, BODY_MID, INTO_CLOSER);
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForSourceContains('const \n');

		expect(await editor.bridge.getSource()).toBe('```js\nconst \n```\n');
	});

	test('typing over a body-into-closer selection replaces only the body part', async () => {
		await selectFrom(editor, BODY_MID, INTO_CLOSER);
		await editor.typeText('Z');
		await editor.bridge.waitForSourceContains('const Z');

		expect(await editor.bridge.getSource()).toBe('```js\nconst Z\n```\n');
	});

	test('cut copies the selection verbatim and deletes only the body part', async () => {
		await selectFrom(editor, BODY_MID, INTO_CLOSER);
		await editor.page.keyboard.press('Control+x');
		await editor.bridge.waitForSourceContains('const \n');

		// The asymmetry: the clipboard keeps the literal bytes the user selected,
		// including the fence characters the delete refused to touch.
		expect(await editor.page.evaluate(() => navigator.clipboard.readText())).toBe('x = 1\n``');
		expect(await editor.bridge.getSource()).toBe('```js\nconst \n```\n');
	});

	test('paste over a body-into-closer selection replaces only the body part', async ({ page }) => {
		await page.evaluate(() => navigator.clipboard.writeText('Y'));
		await selectFrom(editor, BODY_MID, INTO_CLOSER);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('const Y');

		expect(await editor.bridge.getSource()).toBe('```js\nconst Y\n```\n');
	});

	test('Backspace over an opener-into-body selection keeps the opener line', async () => {
		await selectFrom(editor, 3, 6); // "js\ncon"
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('st x = 1');

		expect(await editor.bridge.getSource()).toBe('```js\nst x = 1\n```\n');
	});

	test('a selection inside the info string is still editable verbatim', async () => {
		await selectFrom(editor, 3, 2); // "js"
		await editor.typeText('py');
		await editor.bridge.waitForSourceContains('```py');

		expect(await editor.bridge.getSource()).toBe('```py\nconst x = 1\n```\n');
	});

	test('select-all then Backspace empties the body and keeps the code block', async () => {
		await editor.page.keyboard.press('Control+a');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('const x = 1');

		expect(await editor.bridge.getSource()).toBe('```js\n\n```\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});

	test('Backspace at the start of the closer line is inert', async () => {
		await editor.focusBlock(0, 18);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	// The browser, not the user, ranges this one: the caret is collapsed and the
	// pending edit's target range covers the opener's line ending.
	test('word-delete at the body start is inert', async () => {
		await editor.focusBlock(0, 6);
		await editor.page.keyboard.press('Control+Backspace');
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});
});
