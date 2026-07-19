import { test, expect } from '@playwright/test';

test('server render does not crash (no 5xx)', async ({ page }) => {
	const res = await page.goto('/');
	expect(res, 'no response from server').not.toBeNull();
	expect(res!.status(), 'server render returned 5xx — SSR crash').toBeLessThan(500);
});

test('editor hydrates with no console/page errors and accepts a keystroke', async ({ page }) => {
	const errors: string[] = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(String(e)));

	await page.goto('/');
	// The seed doc has two editable blocks (heading + paragraph); target the
	// paragraph by its text so the keystroke lands there, not in the heading.
	const block = page.locator('[contenteditable="true"]', { hasText: 'Type here' });
	await block.click();
	await block.press('End');
	await page.keyboard.type('X');
	await expect(block).toContainText('Type here.X'); // hydrated + interactive

	// Two Svelte copies (peer-dedup failure) or a hydration mismatch surface here.
	expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([]);
});
