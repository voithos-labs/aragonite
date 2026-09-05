import { test, expect } from '@playwright/test';

// Miss-analysis: every consumer route mounted the editor on a page that painted no background,
// and the smoke asserted hydration, never that the text could be seen, so white-on-white shipped.

/** WCAG contrast between the first editable block's text and whatever paints behind it. */
async function textContrast(page: import('@playwright/test').Page): Promise<number> {
	const block = page.locator('.editor [contenteditable="true"]').first();
	await expect(block).toBeVisible();
	return block.evaluate((el) => {
		const rgb = (value: string) => {
			const m = /rgba?\(([^)]+)\)/.exec(value);
			if (!m) return null;
			const [r, g, b, a = '1'] = m[1].split(',').map((s) => s.trim());
			return Number(a) === 0 ? null : [Number(r), Number(g), Number(b)];
		};
		const luminance = ([r, g, b]: number[]) => {
			const lin = (c: number) => {
				const s = c / 255;
				return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
			};
			return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
		};
		let node: Element | null = el;
		let background: number[] | null = null;
		while (node && !background) {
			background = rgb(getComputedStyle(node).backgroundColor);
			node = node.parentElement;
		}
		// The canvas is white when nothing above the block paints.
		const bg = background ?? [255, 255, 255];
		const fg = rgb(getComputedStyle(el).color) ?? [0, 0, 0];
		const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
		return (hi + 0.05) / (lo + 0.05);
	});
}

for (const route of ['/', '/plugins', '/quickstart']) {
	test(`the editor's text is legible against the page at ${route}`, async ({ page }) => {
		await page.goto(route);
		expect(await textContrast(page)).toBeGreaterThanOrEqual(4.5);
	});
}
