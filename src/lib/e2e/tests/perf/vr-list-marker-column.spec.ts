import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { spacerCount } from './vr-helpers';

// A windowed list sizes its marker column from every item, mounted or not.
// Requirements: e2e/requirements/perf/vr-list-marker-column.md.

const ITEMS = 2000;
const longList = (last: string) =>
	Array.from({ length: ITEMS }, (_, i) => `- item ${i}\n`).join('') + `${last}\n`;

test.describe('a windowed list’s marker column', () => {
	// The plain list above is the reference: its text column is what a `- ` asks for.
	for (const { shape, last, wider } of [
		{ shape: 'a to-do', last: '- [ ] last', wider: false },
		{ shape: 'a wider bullet', last: '-   last', wider: true }
	]) {
		test(`an unmounted last item that is ${shape}, source`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(`- x\n\nbreak\n\n${longList(last)}`);
			await editor.waitForRenderFlush();

			expect(await spacerCount(page, '.list-block >')).toBeGreaterThan(0);
			const columns = await page.evaluate(() => {
				const [control, long] = [...document.querySelectorAll('.editor .list-block')].map(
					(list) =>
						list
							.querySelector(':scope > .list-item-block > .list-item-content')!
							.getBoundingClientRect().left
				);
				return { control, long, items: document.querySelectorAll('.list-item-block').length };
			});
			// The last item is unmounted, so only the counts the list keeps could widen the column.
			expect(columns.items).toBeLessThan(ITEMS / 2);
			if (wider) expect(columns.long).toBeGreaterThan(columns.control + 0.5);
			else expect(Math.abs(columns.long - columns.control)).toBeLessThanOrEqual(0.5);
		});
	}

	test('an item kept through a splice that widens the column is measured again, source', async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		// Long enough to wrap to many lines, so a narrower text column adds one.
		const source = `1. a\n2. ${'word '.repeat(400).trim()}\n3. c\n`;
		await editor.loadContent(source);
		await editor.waitForRenderFlush();
		await editor.waitForResizeObserverFlush();
		const reading = () =>
			page.evaluate(() => {
				const item = document.querySelectorAll('.editor .list-item-block')[1];
				return {
					drawn: item.getBoundingClientRect().height,
					measured: (window as any).__test.tableHeightAt([0, 1]) as number
				};
			});
		const before = await reading();
		expect(Math.abs(before.measured - before.drawn)).toBeLessThanOrEqual(1);

		// The new last item's nine-digit marker widens every item's column; item 2's bytes stay.
		const next = `${source}123456789. j\n`;
		await page.evaluate((next) => (window as any).__test.spliceSource(next, next.length - 1), next);
		await editor.waitForRenderFlush();
		await editor.waitForResizeObserverFlush();
		expect(await page.evaluate(() => (window as any).__test.getSource())).toBe(next);

		const after = await reading();
		// Only an item whose height really moved says anything about measuring it again.
		expect(after.drawn).toBeGreaterThan(before.drawn + 1);
		expect(Math.abs(after.measured - after.drawn)).toBeLessThanOrEqual(1);
	});
});
