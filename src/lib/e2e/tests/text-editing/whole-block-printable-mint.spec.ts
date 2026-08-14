import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
import { wholeBlockInput } from '../../whole-block-input';

// Requirements: e2e/requirements/text-editing/whole-block-printable-mint.md.

const DOC = 'Before\n\n---\n\nAfter\n';

const rule = (editor: EditorPage) => editor.page.locator('.thematic-break-block');

/** Focus the rule the way a user reaches it: Backspace at the start of the paragraph below,
 *  which the whole-block model answers by focusing the block instead of deleting it. */
async function focusTheRule(editor: EditorPage): Promise<void> {
	await editor.focusBlockStart(2);
	await editor.page.keyboard.press('Backspace');
	await expect(wholeBlockInput(rule(editor))).toBeFocused();
}

test.describe('whole-block focus — a typed character mints a paragraph below', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
	});

	test('typing `x` then `y` leaves a paragraph `xy` between the rule and the block below', async ({
		page
	}) => {
		await focusTheRule(editor);

		await page.keyboard.press('x');
		await editor.bridge.waitForSourceContains('x');
		await page.keyboard.press('y');

		await editor.bridge.waitForSourceMatches(/---\n\nxy\n\nAfter/);
		expect(await editor.bridge.getSource()).toMatch(/---\n\nxy\n\nAfter/);
	});

	test('a space mints too, and the rule itself is unchanged', async ({ page }) => {
		await focusTheRule(editor);
		const countBefore = await editor.bridge.getBlockCount();

		await page.keyboard.press('Space');

		await editor.bridge.waitForBlockCount(countBefore + 1);
		expect(await editor.bridge.getSource()).toContain('---');
	});

	test('one Mod+Z restores the pre-mint source — the mint is a single undo entry', async ({
		page
	}) => {
		const original = await editor.bridge.getSource();
		await focusTheRule(editor);

		await page.keyboard.press('x');
		await editor.bridge.waitForSourceContains('x');

		await page.keyboard.press(`${primaryModifier}+z`);

		await editor.bridge.waitForSourceEquals(original);
		expect(await editor.bridge.getSource()).toBe(original);
	});

	test('Mod+C while the block is focused mints nothing', async ({ page }) => {
		const original = await editor.bridge.getSource();
		await focusTheRule(editor);

		await page.keyboard.press(`${primaryModifier}+c`);

		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(original);
	});

	test('reading mode: a printable at whole-block focus changes no byte', async ({ page }) => {
		const readingEditor = new EditorPage(page);
		await readingEditor.goto('?presentationMode=reading');
		await readingEditor.loadContent(DOC);
		const original = await readingEditor.bridge.getSource();

		await rule(readingEditor).click();
		await expect(wholeBlockInput(rule(readingEditor))).toBeFocused();
		await page.keyboard.press('x');

		await readingEditor.waitForNoSourceMutation();
		expect(await readingEditor.bridge.getSource()).toBe(original);
	});
});
