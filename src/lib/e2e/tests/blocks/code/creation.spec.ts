import { test, expect } from '../../../fixtures';
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
		await editor.bridge.waitForSourceContains('```');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');

		await editor.page.keyboard.press('Enter');
		await editor.typeText('body');
		// Regression: swallowed Enter would land "body" on the opener line ("```body").
		await editor.bridge.waitForSourceMatches(/```\n+body/);
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
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
		await editor.bridge.waitForSourceContains('```');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');

		// Auto-pair must not fire while the fence is unclosed (would yield 5 backticks).
		await editor.typeSlowly('`');
		await editor.bridge.waitForSourceContains('````');

		const source = await editor.bridge.getSource();
		const backticks = (source.match(/`/g) ?? []).length;
		expect(backticks).toBe(4);
	});

	test('backtick on an empty body line of an unclosed fence does not auto-pair', async () => {
		await editor.loadContent('\n');
		await editor.focusBlockStart(0);
		await editor.typeSlowly('```');
		await editor.bridge.waitForSourceContains('```');

		await editor.page.keyboard.press('Enter');
		await editor.typeSlowly('`');
		await editor.bridge.waitForSourceMatches(/```\n+`/);

		const source = await editor.bridge.getSource();
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
		await editor.bridge.waitForSourceMatches(/^```\n``\n```/);

		const source = await editor.bridge.getSource();
		const match = source.match(/^```\n([\s\S]*?)\n```\s*$/);
		expect(match, `could not parse body from:\n${source}`).not.toBeNull();
		expect(match![1]).toBe('``');
	});
});
