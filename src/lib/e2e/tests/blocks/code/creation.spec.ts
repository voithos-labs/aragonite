import { test, expect } from '@playwright/test';
import { EditorPage } from '../../../editor-page';

test.describe('code block creation — Enter after typing ```', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter in a fresh unclosed code block inserts a newline', async () => {
		await editor.loadContent('\n');
		await editor.focusBlockStart(0);
		await editor.typeSlowly('```');
		await editor.page.waitForTimeout(150);

		expect(await editor.getBlockKind(0)).toBe('fencedCode');

		await editor.pressEnter();
		await editor.page.waitForTimeout(150);

		await editor.typeText('body');
		await editor.page.waitForTimeout(150);
		expect(await editor.getBlockKind(0)).toBe('fencedCode');

		// Regression: swallowed Enter would land "body" on the opener line ("```body").
		const source = await editor.getSource();
		expect(source).toMatch(/```\n+body/);
	});
});

test.describe('code block creation — backtick auto-pair in unclosed fence', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('fourth backtick after ``` does not auto-pair', async () => {
		await editor.loadContent('\n');
		await editor.focusBlockStart(0);
		await editor.typeSlowly('```');
		await editor.page.waitForTimeout(150);
		expect(await editor.getBlockKind(0)).toBe('fencedCode');

		// Auto-pair must not fire while the fence is unclosed (would yield 5 backticks).
		await editor.typeSlowly('`');
		await editor.page.waitForTimeout(150);

		const source = await editor.getSource();
		const backticks = (source.match(/`/g) ?? []).length;
		expect(backticks).toBe(4);
	});

	test('backtick on an empty body line of an unclosed fence does not auto-pair', async () => {
		await editor.loadContent('\n');
		await editor.focusBlockStart(0);
		await editor.typeSlowly('```');
		await editor.page.waitForTimeout(150);

		await editor.pressEnter();
		await editor.page.waitForTimeout(150);

		await editor.typeSlowly('`');
		await editor.page.waitForTimeout(150);

		const source = await editor.getSource();
		const backticks = (source.match(/`/g) ?? []).length;
		expect(backticks).toBe(4);
	});

	test('backtick inside a closed fence still auto-pairs', async () => {
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 4; i++) {
			await editor.page.keyboard.press('ArrowRight');
		}
		await editor.typeSlowly('`');
		await editor.page.waitForTimeout(150);

		const source = await editor.getSource();
		const match = source.match(/^```\n([\s\S]*?)\n```\s*$/);
		expect(match, `could not parse body from:\n${source}`).not.toBeNull();
		expect(match![1]).toBe('``');
	});
});
