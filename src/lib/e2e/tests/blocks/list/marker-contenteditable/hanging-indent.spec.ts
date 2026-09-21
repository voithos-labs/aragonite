import { test, expect } from '../../../../fixtures';
import { EditorPage } from '../../../../editor-page';

test.describe('list marker — hanging-indent style scoped by ambient length', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('first child has hanging-indent style scoped by ambient length', async () => {
		await editor.loadContent('- Hello\n\n1. one\n\n10. ten\n');
		const items = editor.page.locator('.list-item-block [contenteditable="true"]');

		const styles = await items.evaluateAll((els) =>
			els.map((el) => ({
				textIndent: (el as HTMLElement).style.textIndent,
				paddingLeft: (el as HTMLElement).style.paddingLeft
			}))
		);

		expect(styles).toEqual([
			{ textIndent: 'calc(-2ch)', paddingLeft: '2ch' },
			{ textIndent: 'calc(-3ch)', paddingLeft: '3ch' },
			{ textIndent: 'calc(-4ch)', paddingLeft: '4ch' }
		]);
	});

	test('non-first paragraph in a loose list item has no hanging-indent style', async () => {
		await editor.loadContent('- first\n\n  second\n');
		const blocks = editor.page.locator('.list-item-block .text-editable-block');
		const styles = await blocks.evaluateAll((els) =>
			els.map((el) => ({
				textIndent: (el as HTMLElement).style.textIndent,
				paddingLeft: (el as HTMLElement).style.paddingLeft
			}))
		);

		expect(styles[0]).toEqual({ textIndent: 'calc(-2ch)', paddingLeft: '2ch' });
		expect(styles[1]).toEqual({ textIndent: '', paddingLeft: '' });
	});
});
