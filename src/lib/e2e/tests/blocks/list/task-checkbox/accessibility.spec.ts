import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('task checkbox — accessibility', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('checkbox span carries role=checkbox and aria-checked', async () => {
		await editor.loadContent('- [x] done\n');
		const checkbox = editor.page.locator('.task-checkbox').first();
		await expect(checkbox).toHaveAttribute('role', 'checkbox');
		await expect(checkbox).toHaveAttribute('aria-checked', 'true');
	});

	test('aria-checked flips synchronously with toggle', async () => {
		await editor.loadContent('- [ ] pending\n');
		const checkbox = editor.page.locator('.task-checkbox').first();
		await expect(checkbox).toHaveAttribute('aria-checked', 'false');
		await checkbox.click();
		await expect(checkbox).toHaveAttribute('aria-checked', 'true');
	});
});
