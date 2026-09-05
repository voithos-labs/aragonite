import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

test.describe('image rendering', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('standalone image renders widget', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toBeVisible();
		await expect(widget.locator('img')).toBeVisible();
	});

	test('mid-paragraph image renders widget', async ({ page }) => {
		await editor.loadContent('intro ![cat](/test-fixtures/sample.png) outro\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toBeVisible();
	});

	test('|400 dimension applies width attribute', async ({ page }) => {
		await editor.loadContent('![cat|400](/test-fixtures/sample.png)\n');
		const img = page.locator('[data-image-widget] img').first();
		await expect(img).toHaveAttribute('width', '400');
	});

	test('|400x300 applies width and height', async ({ page }) => {
		await editor.loadContent('![cat|400x300](/test-fixtures/sample.png)\n');
		const img = page.locator('[data-image-widget] img').first();
		await expect(img).toHaveAttribute('width', '400');
		await expect(img).toHaveAttribute('height', '300');
	});

	test('image in table cell renders alt-only (no widget)', async ({ page }) => {
		await editor.loadContent('| col |\n| --- |\n| ![cat](/test-fixtures/sample.png) |\n');
		const cellWidget = page.locator('.table-block [data-image-widget]');
		await expect(cellWidget).toHaveCount(0);
	});

	test('image in heading renders widget', async ({ page }) => {
		await editor.loadContent('# title with ![cat](/test-fixtures/sample.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toBeVisible();
	});

	test('broken URL gets md-image-broken class', async ({ page }) => {
		await editor.loadContent('![cat](/test-fixtures/nonexistent.png)\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toHaveClass(/md-image-broken/, { timeout: 5000 });
	});

	// A zero-dimension SVG resolves as `load`, not `error`, so the class must land off the load.
	test('an image that loads with no intrinsic size gets the placeholder with no other edit', async ({
		page
	}) => {
		await editor.loadContent('![blank](/test-fixtures/unsized.svg)\n');
		const widget = page.locator('[data-image-widget]').first();
		await expect(widget).toHaveClass(/md-image-broken/, { timeout: 5000 });
		// A bare 0×0 widget is the symptom, so assert the box grew, not just the class.
		const box = await widget.boundingBox();
		expect(box?.height ?? 0).toBeGreaterThan(0);
	});

	test('keystroke-rebuilt widget keeps md-image-broken without an async re-add', async ({
		page
	}) => {
		await editor.loadContent('![bad](/test-fixtures/nonexistent.png) text\n');
		await page.waitForFunction(
			() => !!document.querySelector('[data-image-widget].md-image-broken')
		);
		const events = await page.evaluate(() => {
			const para = document.querySelector('[data-image-widget]')!.parentElement!;
			const seen: { tag: string; classes: string }[] = [];
			seen.push({
				tag: 'initial',
				classes: para.querySelector('[data-image-widget]')!.className
			});
			const obs = new MutationObserver((muts) => {
				for (const m of muts) {
					for (const node of Array.from(m.addedNodes)) {
						if ((node as Element).matches?.('[data-image-widget]')) {
							seen.push({ tag: 'rebuilt', classes: (node as Element).className });
						}
					}
				}
			});
			obs.observe(para, { childList: true, subtree: true });
			(window as unknown as { __seen: typeof seen; __seenObs: MutationObserver }).__seen = seen;
			(window as unknown as { __seen: typeof seen; __seenObs: MutationObserver }).__seenObs = obs;
			return seen;
		});
		expect(events[0].classes).toContain('md-image-broken');

		await page.locator('[contenteditable="true"]').first().click();
		await page.keyboard.press('End');
		await page.keyboard.press('z');
		const seen = await page.evaluate(() => {
			const w = window as unknown as {
				__seen: { tag: string; classes: string }[];
				__seenObs: MutationObserver;
			};
			w.__seenObs.disconnect();
			return w.__seen;
		});
		const rebuilt = seen.filter((e) => e.tag === 'rebuilt');
		expect(rebuilt.length).toBeGreaterThan(0);
		for (const e of rebuilt) {
			expect(e.classes).toContain('md-image-broken');
		}
	});

	test('broken image preserves block-level layout (trailing text wraps below)', async ({
		page
	}) => {
		await editor.loadContent('![bad](/test-fixtures/nonexistent.png)a\n');
		await page.waitForFunction(
			() => !!document.querySelector('[data-image-widget].md-image-broken')
		);
		const display = await page.evaluate(
			() => getComputedStyle(document.querySelector('[data-image-widget]')!).display
		);
		expect(display).toBe('block');

		const widgetBox = await page.locator('[data-image-widget]').first().boundingBox();
		const aTop = await page.evaluate(() => {
			const para = document.querySelector('[data-image-widget]')!.parentElement!;
			const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
			let node: Text | null;
			while ((node = walker.nextNode() as Text | null)) {
				if (node.textContent?.includes('a')) break;
			}
			if (!node) return null;
			const idx = node.textContent!.indexOf('a');
			const range = document.createRange();
			range.setStart(node, idx);
			range.setEnd(node, idx + 1);
			return range.getBoundingClientRect().top;
		});
		if (!widgetBox || aTop === null) throw new Error('layout box missing');
		expect(aTop).toBeGreaterThanOrEqual(widgetBox.y + widgetBox.height - 1);
	});
});
