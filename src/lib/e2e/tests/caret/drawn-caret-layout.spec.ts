import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { caretsShowing, drawnCaretBox, nativeCaretBox } from '../../carets-showing';

// The drawn caret against the layout around its editable (requirements/caret/drawn-caret-layout.md):
// a scroller that clips the caret, a size watch it shares with the block it sits in, and the one
// place WebKit paints its caret off the range's box.

/** Two frames, so a paint armed by the last event has run. */
function nextFrames(page: Page): Promise<unknown> {
	return page.evaluate(
		() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
	);
}

test.describe('the drawn caret in a code block scrolled sideways', () => {
	/** The code block's scroller box and the bar's x, or null for no bar. */
	function barAgainstScroller(page: Page) {
		return page.evaluate(() => {
			const scroller = document.querySelector<HTMLElement>('.code-block')!.getBoundingClientRect();
			const bar = document.querySelector('.md-drawn-caret[data-caret-state="text"]');
			const x = bar ? bar.getBoundingClientRect().left : null;
			return { left: scroller.left, right: scroller.right, x };
		});
	}

	for (const [where, wheel] of [
		['scrolled past the caret', 600],
		['scrolled back short of the caret at the line’s end', -6000]
	] as const) {
		test(`a caret ${where} shows no bar outside the block`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(
				`para\n\n\`\`\`js\nconst value = ${'x'.repeat(400)};\nshort\n\`\`\`\n`
			);
			const block = (await page.locator('.code-block').boundingBox())!;
			await page.mouse.click(block.x + 60, block.y + 20);
			await page.keyboard.press('Home');
			for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
			if (wheel < 0) await page.keyboard.press('End');
			await nextFrames(page);
			expect((await barAgainstScroller(page)).x, 'the bar draws in view first').not.toBeNull();

			await page.mouse.move(block.x + 300, block.y + 20);
			await page.mouse.wheel(wheel, 0);
			await nextFrames(page);

			await expect
				.poll(async () => {
					const { left, right, x } = await barAgainstScroller(page);
					return x === null || (x >= left && x <= right);
				})
				.toBe(true);
		});
	}
});

test.describe('the drawn caret and a table row’s size watch', () => {
	// Counts each size delivery per element tagged `data-probe`, through the editor's own observer.
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			const Real = window.ResizeObserver;
			const hits = new Map<string, number>();
			(window as unknown as { __resizeHits: Map<string, number> }).__resizeHits = hits;
			window.ResizeObserver = class extends Real {
				constructor(callback: ResizeObserverCallback) {
					super((entries, observer) => {
						for (const entry of entries) {
							const id = (entry.target as HTMLElement).dataset?.probe;
							if (id) hits.set(id, (hits.get(id) ?? 0) + 1);
						}
						callback(entries, observer);
					});
				}
			};
		});
	});

	test('a row keeps hearing its first cell grow after the caret visits that cell', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		const words = 'long words in the first column that wrap when the cell grows '.repeat(3);
		await editor.loadContent(`para above\n\n| first | second |\n| - | - |\n| ${words} | x |\n`);
		await page.evaluate(() => {
			(document.querySelectorAll('.table-cell')[2] as HTMLElement).dataset.probe = 'first';
		});
		await page.locator('.table-cell').nth(2).click();
		await nextFrames(page);
		await editor.clickBlock(0);
		await nextFrames(page);
		await page.evaluate(() =>
			(window as unknown as { __resizeHits: Map<string, number> }).__resizeHits.clear()
		);

		await page.addStyleTag({ content: '.editor .table-cell { font-size: 26px !important; }' });

		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { __resizeHits: Map<string, number> }).__resizeHits.get(
							'first'
						) ?? 0
				)
			)
			.toBeGreaterThan(0);
	});
});

test.describe('the drawn caret at a code chip’s edge, live mode', () => {
	for (const [where, offset] of [
		['inside the chip, at its end', 'see `code'.length],
		['past the chip', 'see `code`'.length]
	] as const) {
		test(`${where}: WebKit keeps its own caret, Chromium draws on the range`, async ({
			page,
			browserName
		}) => {
			const editor = new EditorPage(page);
			await editor.goto('?presentationMode=live');
			await editor.loadContent('see `code` after\n');
			await editor.focusBlock(0, offset);
			await nextFrames(page);
			if (browserName === 'webkit') {
				await expect.poll(() => caretsShowing(page)).toEqual({ native: true, drawn: 0 });
				return;
			}
			await expect.poll(() => caretsShowing(page)).toEqual({ native: false, drawn: 1 });
			const drawn = (await drawnCaretBox(page))!;
			const range = (await nativeCaretBox(page))!;
			expect(Math.abs(drawn.left - range.left)).toBeLessThanOrEqual(1);
		});
	}
});
