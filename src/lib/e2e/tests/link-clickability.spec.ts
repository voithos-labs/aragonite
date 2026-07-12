import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

test.describe('link clickability', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Ctrl+click on inline link opens URL in new tab', async ({ context }) => {
		await editor.loadContent('Visit [Example](https://example.com) here.\n');
		const link = editor.page.locator('a.md-link-content', { hasText: 'Example' });
		const popupPromise = context.waitForEvent('page');
		await link.click({ modifiers: ['Control'] });
		const popup = await popupPromise;
		expect(popup.url()).toBe('https://example.com/');
	});

	test('Ctrl+click on bare URL autolink opens URL', async ({ context }) => {
		await editor.loadContent('See https://example.com today.\n');
		const link = editor.page.locator('a.md-autolink', { hasText: 'https://example.com' });
		const popupPromise = context.waitForEvent('page');
		await link.click({ modifiers: ['Control'] });
		const popup = await popupPromise;
		expect(popup.url()).toBe('https://example.com/');
	});

	test('Ctrl+click on email autolink opens mailto:', async () => {
		await editor.loadContent('Email foo@bar.com today.\n');
		const link = editor.page.locator('a.md-autolink', { hasText: 'foo@bar.com' });
		// mailto: opens in default mail client — browser context.waitForEvent('page')
		// won't fire. Intercept window.open and assert the called URL.
		await editor.page.evaluate(() => {
			(window as unknown as { __openCalls: string[] }).__openCalls = [];
			window.open = ((url: string) => {
				(window as unknown as { __openCalls: string[] }).__openCalls.push(url);
				return null;
			}) as typeof window.open;
		});
		await link.click({ modifiers: ['Control'] });
		const calls = await editor.page.evaluate(
			() => (window as unknown as { __openCalls: string[] }).__openCalls
		);
		expect(calls).toContain('mailto:foo@bar.com');
	});

	test('plain click on link does not navigate (cursor placement preserved)', async ({
		context
	}) => {
		await editor.loadContent('Visit [Example](https://example.com) here.\n');
		const link = editor.page.locator('a.md-link-content', { hasText: 'Example' });
		let popupFired = false;
		context.on('page', () => {
			popupFired = true;
		});
		await link.click();
		// 200ms — verifying absence of a popup event; no observable state to predicate on.
		await editor.page.waitForTimeout(200);
		expect(popupFired).toBe(false);
	});
});
