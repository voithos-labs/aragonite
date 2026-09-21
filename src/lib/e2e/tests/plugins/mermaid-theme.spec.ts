import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Mermaid diagrams follow the editor theme (requirements/plugins/mermaid-theme.md). The renderer
 * writes its palette into the SVG it returns, so these tests read painted colour: the colours in
 * each diagram's own embedded stylesheet, plus one computed fill. A change made only through CSS
 * variables would leave both unchanged.
 */

/** Per mounted diagram, the palette the renderer painted into its own <style> block. */
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
		// Poll, because the redraw is asynchronous: a memo miss, a render, then the SVG written.
		await expect
			.poll(async () => (await paintedPalettes(page)).join('|'), { timeout: 30_000 })
			.not.toBe(dark.join('|'));

		// Every mounted diagram recolours, not only the first; that holds because each block reads
		// the theme when it renders, which a memo key alone would not give.
		const light = await paintedPalettes(page);
		for (let i = 0; i < dark.length; i++) expect(light[i]).not.toBe(dark[i]);
		expect(await labelFill(page)).not.toBe(darkLabel);
		// A redraw replaces its diagram and must not add a second one.
		await expect(svgs).toHaveCount(2);

		await page.getByTestId('theme-toggle').click();
		await expect
			.poll(async () => (await paintedPalettes(page)).join('|'), { timeout: 30_000 })
			.toBe(dark.join('|'));
		expect(await labelFill(page)).toBe(darkLabel);
		await expect(svgs).toHaveCount(2);

		// A theme is only about the view: the document's bytes never move.
		expect(await editor.bridge.getSource()).toBe(before);
	});
});
