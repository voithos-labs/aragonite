import { test, expect } from '@playwright/test';
import { EditorPage } from '../editor-page';

test.describe('inline dirty-set scoping', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('one keystroke refreshes only the edited subtree', async ({ page }) => {
		const paragraphs = Array.from({ length: 30 }, (_, i) => `para ${i}`).join('\n\n') + '\n';
		await editor.loadContent(paragraphs);
		await page.evaluate(() => {
			(window as any).__test.perf.enable();
			(window as any).__test.perf.reset();
		});

		await editor.focusBlockEnd(0);
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceContains('para 0x');
		// The sweep runs on the debounced input flush (~250ms after the keystroke).
		await page.waitForFunction(
			() => (window as any).__test.perf.snapshot().inlineRefreshCount >= 1,
			null,
			{ timeout: 5_000, polling: 16 }
		);

		const snapshot = await page.evaluate(() => (window as any).__test.perf.snapshot());
		expect(snapshot.inlineRefreshNodeCount).toBeLessThanOrEqual(2);
	});

	test('an LRD edit in one block re-resolves references in another', async ({ page }) => {
		await editor.loadContent('see [docs][d]\n\nplaceholder\n');

		const block0 = editor.getBlock(0);
		await expect(block0.locator('span.md-unresolved-ref')).toHaveCount(1);
		await expect(block0.locator('a.md-link-content')).toHaveCount(0);

		// Replace block 1's text with an LRD — a real user edit that never
		// touches block 0 but changes the LRD signature.
		await editor.focusBlockEnd(1);
		await page.keyboard.press('Shift+Home');
		await page.keyboard.type('[d]: https://example.com');
		await editor.bridge.waitForSourceContains('[d]: https://example.com');

		const link = block0.locator('a.md-link-content');
		await expect(link).toHaveCount(1);
		await expect(link).toHaveAttribute('href', 'https://example.com');
		await expect(block0.locator('span.md-unresolved-ref')).toHaveCount(0);

		// Cache, not just render: the signature-forced whole-doc sweep must
		// leave block 0's inlineContent re-resolved for non-render consumers.
		await page.waitForFunction(
			() =>
				((window as any).__test.getDocument().children[0].inlineContent ?? []).some(
					(n: { kind: string }) => n.kind === 'link'
				),
			null,
			{ timeout: 5_000, polling: 16 }
		);
	});
});
