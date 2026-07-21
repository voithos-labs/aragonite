import { test, expect } from '../../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../../editor-page';
import { getContainerParityMismatches } from '../../../container-parity';
import { capturePageErrors } from '../../../page-probes';

// Header + N distinguishable body rows; row k's first cell is `rk`. Tall enough
// that body rows window out, so a deep target is unmounted at drag start.
function tallTable(bodyRows: number): string {
	const lines = ['| key | val |', '| --- | --- |'];
	for (let i = 1; i <= bodyRows; i++) lines.push(`| r${i} | v${i} |`);
	return lines.join('\n') + '\n';
}

async function scrollTopOf(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);
}

let editor: EditorPage;

test.describe('table block: row drag on a windowed table', () => {
	test.beforeEach(async ({ page }) => {
		// Fixed viewport so the mounted set is deterministic (matches the VR suites).
		await page.setViewportSize({ width: 1280, height: 720 });
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('autoscroll mounts an off-window row and the drag drops onto it', async ({ page }) => {
		test.setTimeout(60_000);
		const pageErrors = capturePageErrors(page);

		await editor.loadContent(tallTable(300));
		const editorEl = page.locator('.editor');

		// Precondition: row windowing is active, or the off-window claim is vacuous.
		expect(
			await page.evaluate(() => document.querySelectorAll('.table-block > .vr-spacer').length)
		).toBeGreaterThan(0);

		// Windowed tables carry a benign parity baseline: an UNMOUNTED row's cells get
		// no childIds until the row mounts (createBlockListState is per-mount), so the
		// whole-CST walk reports `{tableRow, 2, 0}` for every off-window row. That
		// artifact predates the drag — filter it out; the reorder must add NOTHING else.
		const benign = (m: { kind: string; children: number; ids: number }) =>
			m.kind === 'tableRow' && m.children === 2 && m.ids === 0;
		expect((await getContainerParityMismatches(page)).filter((m) => !benign(m))).toEqual([]);

		// Highest row mounted at the instant the drag begins; the drop target must
		// exceed it to prove it was genuinely off-window (not all-mounted).
		const maxMountedAtStart = await page.evaluate(() =>
			Math.max(
				...[...document.querySelectorAll('[data-table-row-idx]')].map((e) =>
					Number(e.getAttribute('data-table-row-idx'))
				)
			)
		);

		// First body row (r1). Hover its cell (at the top, no scroll) to reveal grips.
		await page.locator('[data-table-row-idx="1"] .table-cell').first().hover();
		const grip = await page.locator('[data-table-row-idx="1"] [data-table-row-grip]').boundingBox();
		const box = await editorEl.boundingBox();
		if (!grip || !box) throw new Error('windowed drag: missing grip or editor geometry');

		const edgeX = box.x + box.width / 2;
		const edgeY = box.y + box.height - 5; // inside the bottom autoscroll band

		const startScroll = await scrollTopOf(page);
		await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
		await page.mouse.down();
		await page.mouse.move(edgeX, edgeY, { steps: 6 });

		// The autoscroll rAF loop self-drives on the held pointer; poll scrollTop past
		// 1.5 viewports so the deep region mounts. Jitter the pointer each iteration to
		// keep Playwright's pointer state fresh. Never waitForTimeout.
		await expect
			.poll(
				async () => {
					await page.mouse.move(edgeX, edgeY);
					return scrollTopOf(page);
				},
				{ intervals: [16], timeout: 15_000 }
			)
			.toBeGreaterThan(startScroll + box.height * 1.5);

		// Leave the band onto the viewport center so autoscroll halts; then wait for
		// scrollTop to settle across two frames before reading the target — a rect read
		// mid-scroll would be stale on drop.
		await page.mouse.move(edgeX, box.y + box.height / 2);
		await expect
			.poll(
				() =>
					editorEl.evaluate(
						(el) =>
							new Promise<boolean>((res) => {
								const before = el.scrollTop;
								requestAnimationFrame(() =>
									requestAnimationFrame(() => res(el.scrollTop === before))
								);
							})
					),
				{ intervals: [0], timeout: 5000 }
			)
			.toBe(true);

		// A mounted body row clear of both autoscroll bands and not the last row, so
		// r(idx+1) exists for the order assertion. Drop on its bottom edge → r1 lands
		// just after it.
		const target = await page.evaluate(() => {
			const root = document.querySelector('.editor') as HTMLElement;
			const rootRect = root.getBoundingClientRect();
			for (const row of root.querySelectorAll('[data-table-row-idx]')) {
				const idx = Number(row.getAttribute('data-table-row-idx'));
				if (idx === 0) continue;
				const cell = row.querySelector(':scope > .table-cell') as HTMLElement | null;
				if (!cell) continue;
				const r = cell.getBoundingClientRect();
				if (r.top > rootRect.top + rootRect.height * 0.4 && r.bottom < rootRect.bottom - 60) {
					return { idx, x: r.x + r.width / 2, y: r.bottom - 2 };
				}
			}
			return null;
		});
		if (!target) throw new Error('windowed drag: no stable mid-viewport target after autoscroll');
		expect(target.idx).toBeGreaterThan(maxMountedAtStart);

		await page.mouse.move(target.x, target.y, { steps: 4 });
		await page.mouse.up();

		// r1 traveled into the off-window region: it now sits between r{idx} and r{idx+1}.
		const A = target.idx;
		await editor.bridge.waitForSourceMatches(
			new RegExp(`\\| r${A} \\|[\\s\\S]*?\\| r1 \\|[\\s\\S]*?\\| r${A + 1} \\|`)
		);

		// No row dropped or duplicated; the TABLE node's row keys stayed in sync (the
		// reorder didn't extend children past childIds); only the benign off-window
		// artifact remains; no error.
		const tableNode = await page.evaluate(() => {
			const t = (window as any).__test.getDocument().children[0];
			return { children: t.children.length, ids: t.childIds?.length ?? 0 };
		});
		expect(tableNode.children).toBe(301);
		expect(tableNode.ids).toBe(301);
		expect((await getContainerParityMismatches(page)).filter((m) => !benign(m))).toEqual([]);
		expect(pageErrors).toEqual([]);
	});
});
