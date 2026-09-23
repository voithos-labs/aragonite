import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

// A CRLF to-do emptied and typed into again keeps its CRLF line and its marker.
// Requirements: `e2e/requirements/blocks/list/task-checkbox/crlf-empty.md`.

test.describe('task checkbox: emptying a CRLF to-do', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	/** Click `foo`, go to its end, and delete it a key at a time. */
	async function emptyFoo(): Promise<void> {
		await editor.page.getByText('foo').click();
		await editor.page.keyboard.press('End');
		for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Backspace');
	}

	test('the emptied item stays `- [x] ` over CRLF, and typing writes `- [x] x` over CRLF', async ({
		page
	}) => {
		await editor.loadContent('- [x] foo\r\n');

		await emptyFoo();
		await editor.bridge.waitForSourceEquals('- [x] \r\n');
		expect(await editor.parseConverged()).toBe(true);

		await page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals('- [x] x\r\n');
		expect(await editor.parseConverged()).toBe(true);
		await expect(page.locator('.task-checkbox')).toHaveCount(1);
	});

	test('the rest of a CRLF document keeps its line endings', async ({ page }) => {
		await editor.loadContent('para\r\n\r\n- [x] foo\r\n- [ ] bar\r\n');

		await emptyFoo();
		await page.keyboard.type('x');

		await editor.bridge.waitForSourceEquals('para\r\n\r\n- [x] x\r\n- [ ] bar\r\n');
		expect(await editor.parseConverged()).toBe(true);
	});
});
