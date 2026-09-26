import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Where the mode hides a code block's fence lines (live mode here), every gesture over a range
// applies only to the part of the selection inside the body, so neither hidden fence line can be
// rewritten into an unclosed fence that absorbs the document. Requirements: `fence-ranged-edit.md`.

// Fixture display text "```js\nconst x = 1\n```":
// opener text [0,5) · body [6,17) · closer text [18,21).
const SOURCE = '```js\nconst x = 1\n```\n';
const BODY_MID = 12; // inside "const x = 1", before "x"
const PAST_BODY = 8; // Shift+ArrowRight presses that run past the body's end

async function selectFrom(editor: EditorPage, start: number, presses: number) {
	await editor.focusBlock(0, start);
	for (let i = 0; i < presses; i++) await editor.page.keyboard.press('Shift+ArrowRight');
}

test.describe('code block: ranged edits reaching a hidden fence line', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.setPresentationMode('live');
		await editor.loadContent(SOURCE);
		await editor.getBlock(0).click();
	});

	test('undo restores the whole block after a clamped delete', async () => {
		await selectFrom(editor, BODY_MID, PAST_BODY);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('const \n');

		await editor.undo();
		await editor.bridge.waitForSourceContains('const x = 1');
		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	test('paste over a selection past the body replaces only the body part', async () => {
		await editor.seedClipboard('Y');
		await selectFrom(editor, BODY_MID, PAST_BODY);
		await editor.paste();
		await editor.bridge.waitForSourceContains('const Y');

		expect(await editor.bridge.getSource()).toBe('```js\nconst Y\n```\n');
	});

	test('select-all then Backspace empties the body and keeps the code block', async () => {
		await editor.page.keyboard.press('ControlOrMeta+a');
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceNotContains('const x = 1');

		expect(await editor.bridge.getSource()).toBe('```js\n\n```\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});
});
