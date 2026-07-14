import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * Decoration overlay over a childless opaque container
 * (requirements/plugins/mermaid-decoration-overlay.md). A mermaid block has no
 * child block-hosts, so a mark on its own path paints on the block itself,
 * measured through the container shim's `measurePartialRects`. This is the
 * SelectionOverlay `hasChildHosts` route applied to decorations; the search-fed
 * twin (same overlay) is driven by tests/search/childless-container-match.spec.ts.
 */

const MERMAID_DOC = 'before\n\n```mermaid\ngraph TD\n\tA[Start] --> B[Finish]\n```\n\nafter\n';

test.describe('decoration overlay — childless opaque container', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('mermaid');
		await editor.loadContent(MERMAID_DOC);
		await expect(page.locator("[data-block-path='[1]'][data-block-kind='mermaid']")).toHaveCount(1);
	});

	test('a mark on the mermaid block paints one overlay inside its host', async ({ page }) => {
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-mermaid-mark',
				provide: () => [{ type: 'mark', path: [1], start: 0, end: 5, class: 'e2e-mermaid' }]
			});
		});

		const overlay = page.locator("[data-block-path='[1]'] .decoration-overlay.e2e-mermaid");
		await expect(overlay).toHaveCount(1);
		await expect(overlay).toBeVisible();
		const box = await overlay.boundingBox();
		expect(box!.width).toBeGreaterThan(0);
	});

	test('disposing the source unpaints the block-level mark', async ({ page }) => {
		await page.evaluate(() => {
			(window as any).__test.decorations.addSource({
				name: 'e2e-mermaid-dispose',
				provide: () => [{ type: 'mark', path: [1], start: 0, end: 5, class: 'e2e-mermaid' }]
			});
		});
		await expect(page.locator('.decoration-overlay.e2e-mermaid')).toHaveCount(1);

		await page.evaluate(() =>
			(window as any).__test.decorations.disposeSource('e2e-mermaid-dispose')
		);
		await expect(page.locator('.decoration-overlay.e2e-mermaid')).toHaveCount(0);
	});
});
