/**
 * Code block creation via typing ``` — behavior in the immediate aftermath
 * of a paragraph re-parsing as an unclosed fenced code block.
 *
 * See e2e/requirements/blocks/code/creation.md.
 */
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

		// Typing after Enter must land on a new body line inside the fence.
		await editor.typeText('body');
		await editor.page.waitForTimeout(150);
		expect(await editor.getBlockKind(0)).toBe('fencedCode');

		// Source must contain the opener followed by a newline and "body".
		// Bug 4a would have swallowed Enter and landed "body" on the opener line,
		// producing "```body\n" with no intervening newline.
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

		// Type one more backtick — user is trying to close/extend the fence.
		// Auto-pair must not fire (would produce `` ``, yielding 5 backticks total).
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

		// Move into the body. Enter inside an unclosed fence inserts a newline
		// (also the bug 4a behavior under test).
		await editor.pressEnter();
		await editor.page.waitForTimeout(150);

		await editor.typeSlowly('`');
		await editor.page.waitForTimeout(150);

		const source = await editor.getSource();
		const backticks = (source.match(/`/g) ?? []).length;
		// Opener ``` (3) + one typed ` (1) = 4. Auto-pair would produce 5.
		expect(backticks).toBe(4);
	});

	test('backtick inside a closed fence still auto-pairs', async () => {
		// Regression guard: the auto-pair suppression must be scoped to
		// unclosed fences only. Inside a closed fence, ` pairs normally.
		await editor.loadContent('```\n\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		// Walk past the opener (4 chars: "```\n") onto the empty body line.
		for (let i = 0; i < 4; i++) {
			await editor.page.keyboard.press('ArrowRight');
		}
		await editor.typeSlowly('`');
		await editor.page.waitForTimeout(150);

		const source = await editor.getSource();
		// Body should now contain ``, not a lone `.
		const match = source.match(/^```\n([\s\S]*?)\n```\s*$/);
		expect(match, `could not parse body from:\n${source}`).not.toBeNull();
		expect(match![1]).toBe('``');
	});
});
