import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Block decorations addressed to a list item (requirements/decorations/list-item-block-decoration.md).
// An item renders its own box rather than a block host, so the box is where they land.

const LIST = "[data-block-path='[0]']";
const ITEMS = `${LIST} .list-item-block`;

test.describe('block decorations on a list item', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('- one\n- two\n');
	});

	test('class, attrs and badge land on the addressed item box', async ({ page }) => {
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-item',
				provide: () => [
					{
						type: 'block',
						path: [0, 1],
						class: 'e2e-item-dec',
						attrs: { 'data-e2e-item': 'on' },
						badge: {
							buildDom: () => {
								const el = document.createElement('span');
								el.className = 'e2e-item-badge';
								return el;
							}
						}
					}
				]
			});
		});

		const second = page.locator(ITEMS).nth(1);
		await expect(second).toHaveClass(/\be2e-item-dec\b/);
		await expect(second).toHaveAttribute('data-e2e-item', 'on');
		await expect(page.locator(`${ITEMS}.e2e-item-dec`)).toHaveCount(1);
		const badge = second.locator(':scope > .decoration-badge');
		await expect(badge).toHaveAttribute('contenteditable', 'false');
		await expect(badge.locator('.e2e-item-badge')).toHaveCount(1);
		const badgeIsFirst = await second.evaluate(
			(el) => el.firstElementChild?.classList.contains('decoration-badge') ?? false
		);
		expect(badgeIsFirst).toBe(true);

		await page.evaluate(() => (window as any).__test.decorations.disposeSource('e2e-item'));
		await expect(page.locator(`${ITEMS}.e2e-item-dec`)).toHaveCount(0);
		await expect(page.locator(`${ITEMS}[data-e2e-item]`)).toHaveCount(0);
		await expect(page.locator(`${ITEMS} > .decoration-badge`)).toHaveCount(0);
	});

	test('a decoration on the list lands on its host and on none of its items', async ({ page }) => {
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-list',
				provide: () => [{ type: 'block', path: [0], class: 'e2e-list-dec' }]
			});
		});

		await expect(page.locator(`${LIST}.e2e-list-dec`)).toHaveCount(1);
		await expect(page.locator(`${ITEMS}.e2e-list-dec`)).toHaveCount(0);
	});

	// The item's own attributes drive the task strikethrough, so a decoration may not set them.
	test.describe('an item attribute the list styles read', () => {
		test.use({ expectWarns: ['decorations'] });

		test('is refused on the item, the rest still land', async ({ page }) => {
			await editor.loadContent('- [ ] task\n');
			await page.evaluate(() => {
				(window as any).__test.decorations.addSource({
					name: 'e2e-task',
					provide: () => [
						{
							type: 'block',
							path: [0, 0],
							attrs: { 'data-task-checked': 'true', 'data-e2e-kept': '1' }
						}
					]
				});
			});

			const item = page.locator(ITEMS).first();
			await expect(item).toHaveAttribute('data-e2e-kept', '1');
			await expect(item).toHaveAttribute('data-task-checked', 'false');
		});
	});
});
