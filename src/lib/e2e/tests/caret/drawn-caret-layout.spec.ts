import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { oneCaretOnTheBrowsersLine } from '../../carets-showing';

// The drawn caret against the layout around its editable (requirements/caret/drawn-caret-layout.md):
// a scroller that clips the caret, a size watch it shares with the block it sits in, and a code
// chip's edge, where the browser paints its caret off the range's box.

/** Two frames, so a paint armed by the last event has run. */
function nextFrames(page: Page): Promise<unknown> {
	return page.evaluate(
		() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
	);
}

/** A scroller's box and the bar's x, or null for no bar. */
function barAgainst(page: Page, scroller: string) {
	return page.evaluate((scroller) => {
		const box = document.querySelector<HTMLElement>(scroller)!.getBoundingClientRect();
		const bar = document.querySelector('.md-drawn-caret[data-caret-state="text"]');
		const x = bar ? bar.getBoundingClientRect().left : null;
		return { left: box.left, right: box.right, x };
	}, scroller);
}

/** No bar shows, or it shows inside the scroller's box. */
async function noBarOutside(page: Page, scroller: string): Promise<boolean> {
	const { left, right, x } = await barAgainst(page, scroller);
	return x === null || (x >= left && x <= right);
}

test.describe('the drawn caret in a code block scrolled sideways', () => {
	/** Parks the caret at column 60 of a 400-letter code line; returns a point over the block. */
	async function parkInLongLine(page: Page): Promise<{ x: number; y: number }> {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(
			`para\n\n\`\`\`js\nconst value = ${'x'.repeat(400)};\nshort\n\`\`\`\n`
		);
		const block = (await page.locator('.code-block').boundingBox())!;
		await page.mouse.click(block.x + 60, block.y + 20);
		await page.keyboard.press('Home');
		for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
		return { x: block.x + 300, y: block.y + 20 };
	}

	for (const [where, wheel] of [
		['scrolled past the caret', 600],
		['scrolled back short of the caret at the line’s end', -6000]
	] as const) {
		test(`a caret ${where} shows no bar outside the block`, async ({ page }) => {
			const over = await parkInLongLine(page);
			if (wheel < 0) await page.keyboard.press('End');
			await nextFrames(page);
			expect(
				(await barAgainst(page, '.code-block')).x,
				'the bar draws in view first'
			).not.toBeNull();

			await page.mouse.move(over.x, over.y);
			await page.mouse.wheel(wheel, 0);
			await nextFrames(page);

			await expect.poll(() => noBarOutside(page, '.code-block')).toBe(true);
		});
	}

	test('a clipped caret scrolled back into view draws again where the browser paints', async ({
		page
	}) => {
		const over = await parkInLongLine(page);
		await page.mouse.move(over.x, over.y);
		await page.mouse.wheel(600, 0);
		await nextFrames(page);
		await expect.poll(async () => (await barAgainst(page, '.code-block')).x).toBeNull();

		await page.mouse.wheel(-600, 0);

		expect(await oneCaretOnTheBrowsersLine(page)).toBe('drawn');
	});
});

test.describe('the drawn caret in a table scrolled sideways', () => {
	test('a caret in a cell scrolled out of the table’s box shows no bar outside it', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		const columns = Array.from({ length: 18 }, (_, i) => `col ${i}`);
		await editor.loadContent(
			`para\n\n| ${columns.join(' | ')} |\n|${' - |'.repeat(18)}\n| ${columns.join(' | ')} |\n`
		);
		const table = (await page.locator('.table-block').boundingBox())!;
		await page.locator('.table-cell').first().click();
		await page.keyboard.press('End');
		await nextFrames(page);
		expect(
			(await barAgainst(page, '.table-block')).x,
			'the bar draws in view first'
		).not.toBeNull();

		await page.mouse.move(table.x + table.width / 2, table.y + 10);
		await page.mouse.wheel(600, 0);
		await nextFrames(page);

		await expect.poll(() => noBarOutside(page, '.table-block')).toBe(true);
	});
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
	const line = 'see `code` after';

	for (const [where, offset] of [
		['before the chip', 'see '.length],
		['inside the chip, at its start', 'see `'.length],
		['inside the chip, at its end', 'see `code'.length],
		['past the chip', 'see `code`'.length]
	] as const) {
		test(`${where}: the browser’s own caret shows`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto('?presentationMode=live');
			await editor.loadContent(`${line}\n`);
			await editor.focusBlock(0, offset);

			expect(await oneCaretOnTheBrowsersLine(page)).toBe('native');
		});
	}

	test('inside the chip, off its edges: the bar draws where the browser paints', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await editor.loadContent(`${line}\n`);
		await editor.focusBlock(0, 'see `co'.length);

		expect(await oneCaretOnTheBrowsersLine(page)).toBe('drawn');
	});

	test('a letter typed past the chip, then deleted: the browser’s own caret shows', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto('?presentationMode=live');
		await editor.loadContent(`${line}\n`);
		const before = await editor.getBlockText(0);
		await editor.focusBlock(0, 'see `code`'.length);
		await page.keyboard.type('x');
		await page.keyboard.press('Backspace');
		await expect.poll(() => editor.getBlockText(0)).toBe(before);

		expect(await oneCaretOnTheBrowsersLine(page)).toBe('native');
	});
});
