import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { pastLineEnd, runCenter, runStart } from './multi-click-helpers';

// Dragging a selection and dropping it (requirements/selection/selection-drag-drop.md). Drops
// aim past a line's end or at its first glyph: the two points whose offset no font metric moves.

const TWO = 'alpha beta gamma\n\nsecond para here\n';

type Point = { x: number; y: number };

/** Press on already-selected text and drag it to `to`: the browser's own selection drag. */
async function dragSelection(page: import('@playwright/test').Page, from: Point, to: Point) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 4, from.y, { steps: 2 });
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.mouse.move(to.x + 1, to.y, { steps: 2 });
	await page.mouse.up();
}

function converged(page: import('@playwright/test').Page): Promise<boolean> {
	return page.evaluate(() => (window as any).__test.parseConverged());
}

/** The top-level block's rendered text beside its raw: in source mode they are the same string,
 *  so a native edit that leaked past the seam shows here where a tree-only read would miss it. */
function domMatchesRaw(page: import('@playwright/test').Page, index: number): Promise<boolean> {
	return page.evaluate((i) => {
		const host = document.querySelector(`[data-block-path='[${i}]']`);
		const surface = host?.querySelector('[contenteditable="true"]') ?? host;
		const raw = String((window as any).__test.getDocument().children[i]?.raw ?? '');
		return surface?.textContent === raw.replace(/\r?\n$/, '');
	}, index);
}

test.describe('dragging a selection', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(TWO);
	});

	async function doubleClickOn(needle: string): Promise<Point> {
		const at = await runCenter(editor.page, needle);
		await editor.page.mouse.dblclick(at.x, at.y);
		return at;
	}

	test('a word dropped at the end of its own paragraph moves there', async ({ page }) => {
		const beta = await doubleClickOn('beta');
		await dragSelection(page, beta, await pastLineEnd(page, 'gamma'));
		await editor.bridge.waitForSourceEquals('alpha  gammabeta\n\nsecond para here\n');
		expect(await converged(page)).toBe(true);
		expect(await domMatchesRaw(page, 0)).toBe(true);
		await page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceEquals(TWO);
		await page.keyboard.press('Control+y');
		await editor.bridge.waitForSourceEquals('alpha  gammabeta\n\nsecond para here\n');
	});

	test('a word dropped in another paragraph moves there', async ({ page }) => {
		const beta = await doubleClickOn('beta');
		await dragSelection(page, beta, await runStart(page, 'second para here'));
		await editor.bridge.waitForSourceEquals('alpha  gamma\n\nbetasecond para here\n');
		expect(await converged(page)).toBe(true);
		expect(await domMatchesRaw(page, 0)).toBe(true);
		expect(await domMatchesRaw(page, 1)).toBe(true);
		await page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceEquals(TWO);
	});

	test("the block rung's content moves and leaves the block behind", async ({ page }) => {
		const at = await runCenter(page, 'beta');
		await page.mouse.click(at.x, at.y, { clickCount: 3 });
		await dragSelection(page, at, await runStart(page, 'second para here'));
		await editor.bridge.waitForSource((s) => s.endsWith('alpha beta gammasecond para here\n'));
		expect(await page.evaluate(() => (window as any).__test.getBlockCount())).toBe(2);
		expect(await converged(page)).toBe(true);
		await page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceEquals(TWO);
	});

	test('a Shift+Arrow selection drags the same way', async ({ page }) => {
		const beta = await runCenter(page, 'beta');
		await page.mouse.click(beta.x, beta.y);
		await page.keyboard.press('Home');
		for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
		for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
		await dragSelection(page, beta, await runStart(page, 'second para here'));
		await editor.bridge.waitForSourceEquals('alpha  gamma\n\nbetasecond para here\n');
		await page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceEquals(TWO);
	});

	test("a word dragged out of a code body takes the body's own bytes", async ({ page }) => {
		await editor.loadContent('```\nconst value = 1\n```\n\nsecond para here\n');
		await doubleClickOn('value');
		await dragSelection(page, await runCenter(page, 'value'), await runStart(page, 'second para'));
		await editor.bridge.waitForSourceEquals('```\nconst  = 1\n```\n\nvaluesecond para here\n');
		expect(await converged(page)).toBe(true);
		await page.keyboard.press('Control+z');
		await editor.bridge.waitForSourceEquals('```\nconst value = 1\n```\n\nsecond para here\n');
	});

	test('a drop inside the selection itself leaves the document alone', async ({ page }) => {
		const beta = await doubleClickOn('beta');
		await dragSelection(page, beta, { x: beta.x + 2, y: beta.y });
		await page.waitForTimeout(250);
		expect(await page.evaluate(() => (window as any).__test.getSource())).toBe(TWO);
	});
});
