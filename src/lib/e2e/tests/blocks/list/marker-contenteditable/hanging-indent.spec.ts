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

	// Source mode shows the bytes, so the marker draws at the first child's own size there. The
	// indent it reserves has to be that width, or wrapped lines land inside the drawn marker.
	test('a to-do heading reserves an indent as wide as source mode draws its marker', async () => {
		await editor.loadContent('- [ ] # note\n');
		const marker = await editor.page
			.locator('.list-item-block .md-marker[contenteditable="false"]')
			.first()
			.boundingBox();
		const paddingLeft = await editor.page.evaluate(() => {
			const el = document.querySelector('.list-item-block [contenteditable="true"]');
			return parseFloat(getComputedStyle(el as HTMLElement).paddingLeft);
		});

		expect(paddingLeft).toBeGreaterThanOrEqual(marker!.width);
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
