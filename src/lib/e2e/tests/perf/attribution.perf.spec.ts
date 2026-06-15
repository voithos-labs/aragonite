import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';

declare const process: { env: Record<string, string | undefined> };
test.skip(!process.env.PERF, 'set PERF=1 to run the perf project');

test('perf bridge: a keystroke records a block render and an in-page sample', async ({ page }) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent('hello world\n');
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
	await editor.focusBlockEnd(0);
	await editor.typeSlowly('x');
	await editor.bridge.waitForSourceContains('worldx');
	await page.waitForFunction(
		() => (window as any).__test.perf.snapshot().blockRenderCount >= 1,
		null,
		{
			timeout: 5_000,
			polling: 16
		}
	);
	const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());
	expect(snap.blockRenderCount).toBeGreaterThanOrEqual(1);
	expect(snap.keystrokeInPageMs.length).toBeGreaterThanOrEqual(1);
});
