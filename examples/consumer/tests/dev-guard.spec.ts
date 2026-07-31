import { test, expect } from '@playwright/test';

// Proves the packaged editor's DEV guards reach a plugin author's own `vite dev`: they gate on
// `import.meta.env.DEV`, true here and false under the built preview, which omits /dev-guard.
test('collapse-probe dev-warn fires through the packaged boundary under vite dev', async ({
	page
}) => {
	const warnings: string[] = [];
	page.on('console', (m) => {
		if (m.type() === 'warning') warnings.push(m.text());
	});
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.goto('/dev-guard');
	await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
	expect(errors).toEqual([]);
	await expect
		.poll(() =>
			warnings.some((w) =>
				w.includes(
					'isCollapsed dep disagrees with the declared reservedChrome.isCollapsed probe for kind "devprobe"'
				)
			)
		)
		.toBe(true);
});
