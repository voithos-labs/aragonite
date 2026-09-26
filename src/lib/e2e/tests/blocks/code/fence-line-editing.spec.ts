import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Where the mode paints a code block's fence lines (source mode, and the preview modes on the
// focused block), they're editable text, and the fence write rule keeps exactly one opener and
// one closer, so the paragraph below always stays its own. Requirements: `fence-line-editing.md`.

// Block 0's display text "```js\nconst x = 1\n```":
// opener text [0,5) · body [6,17) · closer text [18,21).
const SOURCE = '```js\nconst x = 1\n```\n\nafter\n';
const BODY_MID = 12; // inside "const x = 1", before "x"
const INTO_CLOSER = 8; // Shift+ArrowRight presses to reach offset 20

async function selectFrom(editor: EditorPage, start: number, presses: number) {
	await editor.focusBlock(0, start);
	for (let i = 0; i < presses; i++) await editor.page.keyboard.press('Shift+ArrowRight');
}

test.describe('code block: fence lines the mode paints', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(SOURCE);
		await editor.getBlock(0).click();
	});

	test('a delete from the body into the closer lands, and a closer comes back', async () => {
		await selectFrom(editor, BODY_MID, INTO_CLOSER);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('```js\nconst `\n```\n\nafter\n');
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(SOURCE);
	});

	test('Backspace in the closer run keeps one closer and the block below', async () => {
		await editor.focusBlock(0, 20);
		await editor.page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('```js\nconst x = 1\n``\n```\n\nafter\n');
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
	});

	test('an opener backtick deleted demotes the block, and its closer goes with it', async () => {
		await editor.focusBlock(0, 3);
		await editor.page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('``js\nconst x = 1\n\nafter\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
	});

	test('paste over the closer keeps a closer below the pasted text', async () => {
		await editor.seedClipboard('Y');
		await selectFrom(editor, 18, 3);
		await editor.paste();

		await editor.bridge.waitForSourceEquals('```js\nconst x = 1\nY\n```\n\nafter\n');
		expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
	});

	test('a selection inside the info string is edited verbatim', async () => {
		await selectFrom(editor, 3, 2); // "js"
		await editor.typeText('py');

		await editor.bridge.waitForSourceEquals('```py\nconst x = 1\n```\n\nafter\n');
	});

	// An unclosed fence has no closer to orphan, so deleting its run just demotes it: that's how a
	// just-typed ``` is taken back.
	test('an unclosed fence’s marker run deletes back to a paragraph', async () => {
		await editor.loadContent('```js\nconst x\n');
		await editor.getBlock(0).click();
		await selectFrom(editor, 0, 3);
		await editor.page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('js\nconst x\n');
	});

	test('the preview modes take the edit on a focused block too', async () => {
		await editor.setPresentationMode('preview-block');
		await editor.getBlock(0).click();
		await editor.focusBlock(0, 20);
		await editor.page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('```js\nconst x = 1\n``\n```\n\nafter\n');
	});
});
