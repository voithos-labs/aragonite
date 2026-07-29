import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Mermaid diagrams follow the editor theme (requirements/plugins/mermaid-theme.md).
 * The engine writes its palette INTO the SVG it returns, so the oracle reads painted
 * color — the colors in each diagram's own embedded stylesheet, plus one computed
 * fill. A CSS-variable-only seam would leave both unchanged.
 */

/** Per mounted diagram, the palette the engine painted into its own <style> block. */
async function paintedPalettes(page: Page): Promise<string[]> {
	return page.$$eval('.mermaid-viewport svg', (svgs) =>
		svgs.map((svg) =>
			((svg.querySelector('style')?.textContent ?? '').match(/#[0-9a-fA-F]{3,6}/g) ?? [])
				.slice(0, 8)
				.join(',')
		)
	);
}

/** Computed fill of a real painted label, where the diagram type draws SVG text. */
async function labelFill(page: Page): Promise<string> {
	return page.$eval('.mermaid-viewport svg text', (el) => getComputedStyle(el).fill);
}

test.describe('mermaid theme seam', () => {
	let editor: PluginsPage;
	let svgs: ReturnType<Page['locator']>;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		svgs = page.locator('.mermaid-viewport svg');
		await editor.gotoPlugins('mermaid');
		await expect(svgs).toHaveCount(2, { timeout: 30_000 });
	});

	test('flipping the theme prop recolors every mounted diagram, and flipping back restores it', async ({
		page
	}) => {
		const before = await editor.bridge.getSource();
		const dark = await paintedPalettes(page);
		const darkLabel = await labelFill(page);
		expect(dark.every((palette) => palette !== '')).toBe(true);

		await page.getByTestId('theme-toggle').click();
		// Poll: the redraw is async (memo miss → engine render → effect writes the SVG).
		await expect
			.poll(async () => (await paintedPalettes(page)).join('|'), { timeout: 30_000 })
			.not.toBe(dark.join('|'));

		// EVERY mounted diagram recolors, not only the first — a per-block render read
		// is what makes that true, and it is the half a memo key alone would not fix.
		const light = await paintedPalettes(page);
		for (let i = 0; i < dark.length; i++) expect(light[i]).not.toBe(dark[i]);
		expect(await labelFill(page)).not.toBe(darkLabel);
		// A redraw REPLACES its diagram; it must not append a second one.
		await expect(svgs).toHaveCount(2);

		await page.getByTestId('theme-toggle').click();
		await expect
			.poll(async () => (await paintedPalettes(page)).join('|'), { timeout: 30_000 })
			.toBe(dark.join('|'));
		expect(await labelFill(page)).toBe(darkLabel);
		await expect(svgs).toHaveCount(2);

		// A theme is a view fact: the document's bytes never move.
		expect(await editor.bridge.getSource()).toBe(before);
	});
});
