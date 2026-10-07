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

// Every step edits, so each loads its document afresh and clicks into the block. The editor ignores
// a source equal to the last one it was given, so a blank swap goes between.
async function openFence(editor: EditorPage, source = SOURCE) {
	await editor.loadContent('');
	await editor.loadContent(source);
	await editor.getBlock(0).click();
}

async function sourceEditor(page: EditorPage['page']): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto();
	return editor;
}

test.describe('code block: fence lines the mode paints', () => {
	test('a delete in a fence line keeps one opener, one closer and the block below', async ({
		page
	}) => {
		const editor = await sourceEditor(page);

		await test.step('a delete from the body into the closer lands, and a closer comes back', async () => {
			await openFence(editor);
			await selectFrom(editor, BODY_MID, INTO_CLOSER);
			await editor.page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals('```js\nconst `\n```\n\nafter\n');
			expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');

			await editor.undo();
			await editor.bridge.waitForSourceEquals(SOURCE);
		});

		await test.step('Backspace in the closer run keeps one closer and the block below', async () => {
			await openFence(editor);
			await editor.focusBlock(0, 20);
			await editor.page.keyboard.press('Backspace');

			await editor.bridge.waitForSourceEquals('```js\nconst x = 1\n``\n```\n\nafter\n');
			expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		});

		await test.step('an opener backtick deleted demotes the block, and its closer goes with it', async () => {
			await openFence(editor);
			await editor.focusBlock(0, 3);
			await editor.page.keyboard.press('Backspace');

			await editor.bridge.waitForSourceEquals('``js\nconst x = 1\n\nafter\n');
			expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
			expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		});

		// The demotion reparses the block into a paragraph, so the caret the edit left has to land in
		// that paragraph where the typed character went, or the next key lands somewhere else.
		await test.step('the caret stays put after a character typed before the opener demotes the block', async () => {
			await openFence(editor);
			await editor.focusBlock(0, 0);
			await editor.page.keyboard.type('x');
			await expect.poll(() => editor.bridge.getBlockKind(0)).toBe('paragraph');
			await editor.page.keyboard.type('Q');

			await expect.poll(() => editor.bridge.getSource()).toContain('xQ```js');
		});

		await test.step('the caret stays put after a Backspace in the opener run demotes the block', async () => {
			await openFence(editor);
			await editor.focusBlock(0, 3);
			await editor.page.keyboard.press('Backspace');
			await expect.poll(() => editor.bridge.getBlockKind(0)).toBe('paragraph');
			await editor.page.keyboard.type('Q');

			await expect.poll(() => editor.bridge.getSource()).toContain('``Qjs');
		});

		// An unclosed fence has no closer to orphan, so deleting its run just demotes it: that's how a
		// just-typed ``` is taken back.
		await test.step('an unclosed fence’s marker run deletes back to a paragraph', async () => {
			await openFence(editor, '```js\nconst x\n');
			await selectFrom(editor, 0, 3);
			await editor.page.keyboard.press('Backspace');

			await editor.bridge.waitForSourceEquals('js\nconst x\n');
		});
	});

	// A bare opener has nothing after its run, where a typed backtick would otherwise auto-pair.
	test('a backtick at the end of the opener run widens both fence lines by one', async ({
		page
	}) => {
		const editor = await sourceEditor(page);

		await test.step('typed after an opener with an info string', async () => {
			await openFence(editor);
			await editor.focusBlock(0, 3);
			await editor.page.keyboard.type('`');

			await expect
				.poll(() => editor.bridge.getSource())
				.toBe('````js\nconst x = 1\n````\n\nafter\n');
		});

		await test.step('typed after a bare opener', async () => {
			await openFence(editor, '```\nx\n```\n\nafter\n');
			await editor.focusBlock(0, 3);
			await editor.page.keyboard.type('`');

			await expect.poll(() => editor.bridge.getSource()).toBe('````\nx\n````\n\nafter\n');
		});

		await test.step('pasted at the end of the opener run', async () => {
			await openFence(editor);
			await editor.seedClipboard('`');
			await editor.focusBlock(0, 3);
			await editor.paste();

			await expect
				.poll(() => editor.bridge.getSource())
				.toBe('````js\nconst x = 1\n````\n\nafter\n');
		});

		await test.step('a paste over the closer keeps a closer below the pasted text', async () => {
			await openFence(editor);
			await editor.seedClipboard('Y');
			await selectFrom(editor, 18, 3);
			await editor.paste();

			await editor.bridge.waitForSourceEquals('```js\nconst x = 1\nY\n```\n\nafter\n');
			expect(await editor.bridge.getBlockKind(1)).toBe('paragraph');
		});
	});

	test('an arrow from the body reaches the opener, and typing there writes the info', async ({
		page
	}) => {
		const editor = await sourceEditor(page);
		await openFence(editor);
		await editor.focusBlock(0, BODY_MID);
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('ArrowUp');
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('x');

		await editor.bridge.waitForSourceEquals('```jsx\nconst x = 1\n```\n\nafter\n');
	});

	test('a selection inside the info string is edited verbatim', async ({ page }) => {
		const editor = await sourceEditor(page);
		await openFence(editor);
		await selectFrom(editor, 3, 2); // "js"
		await editor.typeText('py');

		await editor.bridge.waitForSourceEquals('```py\nconst x = 1\n```\n\nafter\n');
	});

	test('the preview modes take the edit on a focused block too', async ({ page }) => {
		const editor = await sourceEditor(page);
		await editor.loadContent(SOURCE);
		await editor.setPresentationMode('preview-block');
		await editor.getBlock(0).click();
		await editor.focusBlock(0, 20);
		await editor.page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceEquals('```js\nconst x = 1\n``\n```\n\nafter\n');
	});
});
