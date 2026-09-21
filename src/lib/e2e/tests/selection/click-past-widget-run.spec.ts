import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';

// A click beside a run of touching widgets snaps to the edge nearest the point, not to the
// first widget the point is past (`requirements/selection/click-past-widget-run.md`). Decoded
// entities stand in for any glyph widget: they need no plugin and no image decode.

const RUN = 'lead\n\nend &hearts;&hearts;&hearts;&spades;\n\ntail\n';
const LONE = 'lead\n\nend &hearts;\n\ntail\n';

async function islandRects(page: Page): Promise<DOMRect[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll("[data-block-path='[1]'] [data-inline-widget]")].map((w) =>
			w.getBoundingClientRect().toJSON()
		)
	);
}

/** Click a comfortable margin past the last widget, the gesture a user makes to reach the end
 *  of the line, and report the line the typed character landed in. */
async function typeAfterClickPastLastIsland(editor: EditorPage): Promise<string> {
	const islands = await islandRects(editor.page);
	const last = islands[islands.length - 1];
	await editor.page.mouse.click(last.right + 12, last.top + last.height / 2);
	await editor.typeText('X');
	await editor.bridge.waitForSourceContains('X');
	return (await editor.bridge.getSource()).split('\n')[2];
}

for (const mode of ['source', 'live'] as const) {
	test.describe(`click beside a run of atomic islands: ${mode} mode`, () => {
		let editor: EditorPage;

		test.beforeEach(async ({ page }) => {
			editor = new EditorPage(page);
			await editor.goto();
			if (mode === 'live') {
				await page.evaluate(() => (window as any).__test.setPresentationMode('live'));
			}
		});

		test('a click past the last of four flush islands seats the caret at the end of the line', async () => {
			await editor.loadContent(RUN);
			await expect(editor.page.locator('[data-inline-widget]')).toHaveCount(4);

			expect(await typeAfterClickPastLastIsland(editor)).toBe(
				'end &hearts;&hearts;&hearts;&spades;X'
			);
		});

		test('a click past a lone island still seats after that island', async () => {
			await editor.loadContent(LONE);
			await expect(editor.page.locator('[data-inline-widget]')).toHaveCount(1);

			expect(await typeAfterClickPastLastIsland(editor)).toBe('end &hearts;X');
		});
	});
}
