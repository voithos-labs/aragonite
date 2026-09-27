import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

// Backspace at the start of an item whose previous item is a heading joins the two in live mode.
// The shared fixture fails the test on any invariant warning or uncaught rejection.
// Requirements: `e2e/requirements/blocks/list/backspace/heading-item-join.md`.

const JOINS = [
	{
		title: 'an ATX heading item',
		before: '- # Plan\n- next\n',
		joined: '- # Plannext\n',
		typed: '- # PlanXnext\n'
	},
	{
		title: 'a setext heading item',
		before: '- Plan\n  ===\n- next\n',
		joined: '- Plannext\n  ===\n',
		typed: '- PlanXnext\n  ===\n'
	}
];

test.describe('list Backspace: joining into a heading item', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.setPresentationMode('live');
	});

	for (const { title, before, joined, typed } of JOINS) {
		test(`Backspace at the start of the next item joins it into ${title}`, async ({ page }) => {
			await editor.loadContent(before);
			await page.locator('[contenteditable="true"]', { hasText: 'next' }).click();
			await page.keyboard.press('Home');
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals(joined);

			await editor.typeText('X');
			await editor.bridge.waitForSourceEquals(typed);
			expect(await editor.parseConverged()).toBe(true);
		});
	}
});
