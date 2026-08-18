import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Every ranged gesture applies to the selection's intersection with the BODY, so neither fence line
// can be rewritten into an unclosed fence that absorbs the document. Requirements:
// fence-ranged-edit.md.

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

	test('undo restores the whole block after a clamped delete', async () => {
		await selectFrom(editor, BODY_MID, INTO_CLOSER);
		await editor.page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('const \n');

		await editor.undo();
		await editor.bridge.waitForSourceContains('const x = 1');
		expect(await editor.bridge.getSource()).toBe(SOURCE);
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

		// The clipboard keeps the literal bytes the user selected, including the fence characters
		// the delete refused.
		expect(await editor.readClipboard()).toBe('x = 1\n``');
		expect(await editor.bridge.getSource()).toBe('```js\nconst \n```\n');
	});

	test('paste over a body-into-closer selection replaces only the body part', async () => {
		await editor.seedClipboard('Y');
		await selectFrom(editor, BODY_MID, INTO_CLOSER);
		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('const Y');

		expect(await editor.bridge.getSource()).toBe('```js\nconst Y\n```\n');
	});

	// Paste follows the same refusal as typing: a target confined to structure has nowhere to
	// write.
	test('paste with the caret inside a fence run is inert', async () => {
		await editor.seedClipboard('Y');

		for (const offset of [19, 1]) {
			await editor.focusBlock(0, offset);
			await editor.paste('Control+v');
			await editor.waitForNoSourceMutation();

			expect(await editor.bridge.getSource()).toBe(SOURCE);
		}
	});

	test('paste over a closer-only selection is inert', async () => {
		await editor.seedClipboard('Y');
		await selectFrom(editor, 18, 3);
		await editor.paste('Control+v');
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	test('Backspace over an opener-into-body selection keeps the opener line', async () => {
		await selectFrom(editor, 3, 6); // "js\ncon"
		await editor.page.keyboard.press('Backspace');
		// Equality, not a fragment: what survives this edit is a substring of the
		await editor.bridge.waitForSourceEquals('```js\nst x = 1\n```\n');
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

	// The browser ranges this one: the caret is collapsed, but the pending edit's target covers the
	// opener's line ending.
	test('word-delete at the body start is inert', async () => {
		await editor.focusBlock(0, 6);
		await editor.page.keyboard.press('Control+Backspace');
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	// A closed fence's marker runs are structure: one character either way leaves an unclosed fence
	// that swallows the document.
	test('typing inside the closer fence is inert', async () => {
		await editor.focusBlock(0, 19);
		await editor.typeText('x');
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	test('Backspace inside the closer fence is inert', async () => {
		await editor.focusBlock(0, 20);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	test('deleting a selected opener marker run is inert', async () => {
		await selectFrom(editor, 0, 3);
		await editor.page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	test('cut of a closer-only selection copies it but deletes nothing', async () => {
		await selectFrom(editor, 18, 3);
		await editor.page.keyboard.press('Control+x');
		await editor.waitForClipboardWrite();

		expect(await editor.readClipboard()).toBe('```');
		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	// An unclosed fence has no closer to orphan, so its markers stay editable — a just-typed ```
	// must be un-typable.
	test('an unclosed fence keeps its markers editable', async () => {
		await editor.loadContent('```js\nconst x\n');
		await editor.getBlock(0).click();
		await selectFrom(editor, 0, 3);
		await editor.page.keyboard.press('Backspace');
		// Equality again: the post-state is the fixture minus a prefix, so every fragment is
		// already true before the gesture.
		await editor.bridge.waitForSourceEquals('js\nconst x\n');
	});
});
