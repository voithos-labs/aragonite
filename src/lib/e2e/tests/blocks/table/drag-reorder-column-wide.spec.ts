import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';

// 12 columns at ~150px each overflow `.table-block`'s overflow-x in an 800px
// viewport, so the late columns start scrolled off the right edge. Header row is
// row 0 (parser strips the alignment row): cells "Header-Col-1".."Header-Col-12".
const COLS = 12;
const HEAD =
	'| ' + Array.from({ length: COLS }, (_, i) => `Header-Col-${i + 1}`).join(' | ') + ' |\n';
const SEP = '| ' + Array.from({ length: COLS }, () => '---').join(' | ') + ' |\n';
const ROW = (prefix: string) =>
	'| ' + Array.from({ length: COLS }, (_, i) => `${prefix}${i + 1}`).join(' | ') + ' |\n';
const WIDE_TABLE = HEAD + SEP + ROW('a') + ROW('b');

let editor: EditorPage;

test.describe('table block: column drag on a wide (overflowing) table', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 800, height: 720 });
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('autoscroll reveals a clipped column and the drag drops onto it', async ({ page }) => {
		test.setTimeout(60_000);
		const pageErrors: string[] = [];
		page.on('pageerror', (e) => pageErrors.push(e.message));

		await editor.loadContent(WIDE_TABLE);
		const tableEl = page.locator('[role="table"]').first();

		// Precondition: columns actually overflow, or the off-screen claim is vacuous.
		expect(await tableEl.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

		// Rightmost column fully visible at drag start (scrollLeft 0); the drop target
		// must exceed it to prove autoscroll genuinely brought it into view.
		const maxVisibleAtStart = await page.evaluate(() => {
			const table = document.querySelector('[role="table"]') as HTMLElement;
			const tableRect = table.getBoundingClientRect();
			const headerRow = table.querySelector('[data-table-row-idx="0"]') as HTMLElement;
			const cells = [...headerRow.querySelectorAll(':scope > [role="cell"]')];
			let maxVisible = -1;
			cells.forEach((c, i) => {
				const r = c.getBoundingClientRect();
				if (r.left >= tableRect.left && r.right <= tableRect.right) maxVisible = i;
			});
			return maxVisible;
		});

		// Press column 0's grip and drag toward the right-edge autoscroll band.
		await page.hover('[role="table"]');
		const grip = await page.locator('[data-table-col-grip]').nth(0).boundingBox();
		const tableBox = await tableEl.boundingBox();
		if (!grip || !tableBox) throw new Error('wide column drag: missing grip or table geometry');
		const bandX = tableBox.x + tableBox.width - 5;
		const bandY = tableBox.y + tableBox.height / 2;

		await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
		await page.mouse.down();
		await page.mouse.move(bandX, bandY, { steps: 6 });

		// The autoscroll rAF loop self-drives on the held pointer; poll scrollLeft past
		// half the max so late columns scroll into view. Jitter the pointer each
		// iteration to keep Playwright's pointer state fresh. Never waitForTimeout.
		const maxScroll = await tableEl.evaluate((el) => el.scrollWidth - el.clientWidth);
		await expect
			.poll(
				async () => {
					await page.mouse.move(bandX, bandY);
					return tableEl.evaluate((el) => el.scrollLeft);
				},
				{ intervals: [16], timeout: 15_000 }
			)
			.toBeGreaterThan(maxScroll * 0.5);

		// Leave the band so autoscroll halts; settle scrollLeft across two frames
		// before reading the target — a mid-scroll rect would be stale on drop.
		await page.mouse.move(tableBox.x + tableBox.width / 2, bandY);
		await expect
			.poll(
				() =>
					tableEl.evaluate(
						(el) =>
							new Promise<boolean>((res) => {
								const before = el.scrollLeft;
								requestAnimationFrame(() =>
									requestAnimationFrame(() => res(el.scrollLeft === before))
								);
							})
					),
				{ intervals: [0], timeout: 5000 }
			)
			.toBe(true);

		// A header column now fully visible, clear of both autoscroll bands, past the
		// start-visible set, and not the last column (so its +1 neighbor exists for the
		// order assertion). Read its label from text rather than trusting the index.
		const target = await page.evaluate((maxVisible) => {
			const table = document.querySelector('[role="table"]') as HTMLElement;
			const tableRect = table.getBoundingClientRect();
			const headerRow = table.querySelector('[data-table-row-idx="0"]') as HTMLElement;
			const cells = [...headerRow.querySelectorAll(':scope > [role="cell"]')];
			for (let i = maxVisible + 1; i < cells.length - 1; i++) {
				const r = cells[i].getBoundingClientRect();
				if (r.left > tableRect.left + 40 && r.right < tableRect.right - 60) {
					const m = (cells[i].textContent ?? '').match(/Header-Col-(\d+)/);
					if (!m) continue;
					return { idx: i, label: Number(m[1]), x: r.right, y: r.top + r.height / 2 };
				}
			}
			return null;
		}, maxVisibleAtStart);
		if (!target) throw new Error('wide column drag: no clear target column after autoscroll');
		expect(target.idx).toBeGreaterThan(maxVisibleAtStart);

		await page.mouse.move(target.x, target.y, { steps: 4 });
		await page.mouse.up();

		// Insert semantics: dropping col 0 on column L's right edge lands Header-Col-1
		// between the target's label and the next.
		const L = target.label;
		await editor.bridge.waitForSourceMatches(
			new RegExp(`Header-Col-${L} \\| Header-Col-1 \\| Header-Col-${L + 1}`)
		);

		// No column dropped or duplicated (all 12 labels survive), the per-row cell
		// permute kept keyed identity, and the gesture logged no error.
		const source = await editor.bridge.getSource();
		expect(source.match(/Header-Col-\d+/g)?.length).toBe(COLS);
		expect(await getContainerParityMismatches(page)).toEqual([]);
		expect(pageErrors).toEqual([]);
	});
});
