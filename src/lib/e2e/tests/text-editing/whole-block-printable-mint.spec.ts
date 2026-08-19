import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
import { wholeBlockInput } from '../../whole-block-input';
import { RULE_DOC, focusTheRule, rule } from './whole-block-rule';

// Requirements: e2e/requirements/text-editing/whole-block-printable-mint.md.

test.describe('whole-block focus — a typed character mints a paragraph below', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(RULE_DOC);
	});

	test('typing `x` then `y` leaves a paragraph `xy` between the rule and the block below', async ({
		page
	}) => {
		await focusTheRule(editor);

		await page.keyboard.press('x');
		await editor.bridge.waitForSourceContains('x');
		await page.keyboard.press('y');

		await editor.bridge.waitForSourceMatches(/---\n\nxy\n\nAfter/);
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
		await readingEditor.loadContent(RULE_DOC);
		const original = await readingEditor.bridge.getSource();

		await rule(readingEditor).click();
		await expect(wholeBlockInput(rule(readingEditor))).toBeFocused();
		await page.keyboard.press('x');

		await readingEditor.waitForNoSourceMutation();
		expect(await readingEditor.bridge.getSource()).toBe(original);
	});
});
