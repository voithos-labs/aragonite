import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
import { capturePageErrors } from '../../page-probes';

// A windowed doc: many short paragraphs with a unique marker as the last block,
// off-window from the top.
function doc(): string {
	const blocks = Array.from({ length: 200 }, (_, i) => `paragraph ${i} with some words`);
	blocks.push('ZZENDMARKER final block');
	return blocks.join('\n\n') + '\n';
}

function markerInView(page: Page): Promise<{ mounted: boolean; inView: boolean }> {
	return page.evaluate(() => {
		const ed = document.querySelector('.editor')!.getBoundingClientRect();
		const hosts = Array.from(
			document.querySelectorAll('[data-block-path]:not([data-block-path*=","])')
		) as HTMLElement[];
		const host = hosts.find((h) => (h.textContent ?? '').includes('ZZENDMARKER'));
		if (!host) return { mounted: false, inView: false };
		const r = host.getBoundingClientRect();
		return { mounted: true, inView: r.height > 0 && r.top < ed.bottom && r.bottom > ed.top };
	});
}

test('Shift+Ctrl+End extends to an off-window endpoint and scrolls it into view, collapse still routes', async ({
	page
}) => {
	const pageErrors = capturePageErrors(page);

	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent(doc());
	await editor.waitForRenderFlush();

	// Preconditions: windowing active, the end marker off-window.
	expect(await page.locator('.vr-spacer').count()).toBeGreaterThan(0);
	expect((await markerInView(page)).mounted).toBe(false);

	// Extend a cross-block selection to the document end (the off-window last block).
	await editor.clickBlock(0);
	await page.keyboard.press(`${primaryModifier}+Shift+End`);
	await editor.waitForRenderFlush();

	// Poll the mount+scroll the reveal performs rather than a fixed wait; the
	// endpoint must land mounted AND in view.
	await expect.poll(() => markerInView(page)).toEqual({ mounted: true, inView: true });
	expect(await editor.bridge.isCrossBlockSelection()).toBe(true);

	// A following unshifted arrow collapses the selection (focus routing intact).
	await page.keyboard.press('ArrowLeft');
	await editor.waitForRenderFlush();
	expect(await editor.bridge.isCrossBlockSelection()).toBe(false);
	expect(pageErrors).toEqual([]);
});
