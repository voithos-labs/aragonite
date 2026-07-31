import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { primaryModifier } from '../../platform';
import { PluginsPage } from '../plugins/helpers';

/**
 * Search inside a folded render-primary leaf widget
 * (requirements/search/render-primary-leaf-match.md). Such a leaf renders its source through
 * a component, so a match in its raw has no measurable text node; `createEditableLeaf`
 * covers the rendered block box while folded, at the leaf CHOKE POINT, so every
 * render-primary leaf inherits the highlight with no per-kind code.
 */

const findInput = (page: Page) => page.getByRole('textbox', { name: 'Find' });
const count = (page: Page) => page.locator('.search-count');
const hostFor = (page: Page, kind: string) => page.locator(`[data-block-kind='${kind}']`);

async function search(editor: PluginsPage, token: string): Promise<void> {
	await editor.clickBlock(0);
	await editor.page.keyboard.press(`${primaryModifier}+f`);
	await findInput(editor.page).waitFor({ state: 'visible' });
	await editor.page.keyboard.type(token);
}

// The token lives only inside the leaf's source, so finding it (count 1 / 1) is the
// scan half — that already worked. Painting a sized cover rect inside the folded
// block's host is the fix under test.
async function expectFoundAndPainted(page: Page, kind: string): Promise<void> {
	await expect(count(page)).toHaveText(/1\s*\/\s*1/);
	const overlay = hostFor(page, kind).locator('.match-overlay');
	await expect(overlay).toHaveCount(1);
	const box = await overlay.boundingBox();
	expect(box!.width).toBeGreaterThan(0);
	expect(box!.height).toBeGreaterThan(0);
}

test.describe('search — folded render-primary leaf widget', () => {
	let editor: PluginsPage;
	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mathblock');
	});

	test('a match inside a folded math block is found and painted with a cover rect', async ({
		page
	}) => {
		await editor.loadContent('prose filler here\n\n$$x^2 + ZZNEEDLE$$\n\nmore filler\n');
		await expect(hostFor(page, 'mathBlock')).toHaveCount(1);

		await search(editor, 'ZZNEEDLE');
		await expectFoundAndPainted(page, 'mathBlock');
	});

	test('a match inside a folded toc outline paints via the same leaf fallback', async ({
		page
	}) => {
		await editor.loadContent('# Overview\n\n[[toc]]\n\nFooter\n');
		await expect(hostFor(page, 'toc')).toHaveCount(1);

		await search(editor, 'toc');
		await expectFoundAndPainted(page, 'toc');
	});
});
