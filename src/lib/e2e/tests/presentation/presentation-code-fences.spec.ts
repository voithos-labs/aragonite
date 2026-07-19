import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// The fenced-code renderer wraps each fence line in `.md-fence-line` so reading
// and preview collapse the whole line — marker AND its `\n` — instead of leaving
// a bare `\n` that paints a blank line at the code box's top and bottom.
// Requirements: e2e/requirements/presentation/presentation-code-fences.md.

const DOC = ['```js', 'const a = 1;', 'const b = 2;', 'const c = 3;', '```', '', 'text after'].join(
	'\n'
);
const SOURCE_LINES = 5; // opener + 3 body + closer

async function boxHeight(ep: EditorPage): Promise<number> {
	const box = await ep.getBlock(0).boundingBox();
	if (!box) throw new Error('code block has no bounding box');
	return box.height;
}

test.describe('code fences — reading mode collapses the fence lines', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
	});

	test('the code box loses the two fence lines — no blank top/bottom line', async ({ page }) => {
		const sourceHeight = await boxHeight(ep);
		const perLine = sourceHeight / SOURCE_LINES;

		await page.getByTestId('presentation-toggle').click();
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await ep.waitForRenderFlush();

		// Opener + closer gone, body untouched: ≈ 2 line-heights shorter. Pre-fix the
		// bare `\n`s keep both blank lines, so the box does not shrink → red. The band
		// also catches a half-fix that collapses only the top or only the bottom line.
		const collapsed = sourceHeight - (await boxHeight(ep));
		expect(collapsed).toBeGreaterThan(perLine * 1.5);
		expect(collapsed).toBeLessThan(perLine * 2.5);
	});

	test('both fence-line wrappers compute display:none, bytes stay in the DOM', async ({ page }) => {
		await page.getByTestId('presentation-toggle').click();
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'reading');

		const displays = await page
			.locator('.code-block .md-fence-line')
			.evaluateAll((els) => els.map((el) => getComputedStyle(el).display));
		expect(displays).toEqual(['none', 'none']);

		expect(await ep.getBlockText(0)).toContain('```js');
		expect(await ep.getBlockText(0)).toContain('const b = 2;');
	});
});

for (const mode of [
	{ name: 'preview-block', testid: 'preview-block-toggle', attr: 'preview-block' },
	{ name: 'preview-inline', testid: 'preview-inline-toggle', attr: 'preview-inline' }
] as const) {
	test.describe(`code fences — ${mode.name} reveals on focus`, () => {
		let ep: EditorPage;

		test.beforeEach(async ({ page }) => {
			ep = new EditorPage(page);
			await ep.goto();
			await ep.loadContent(DOC);
			await page.getByTestId(mode.testid).click();
			await expect(ep.editorContainer).toHaveAttribute('data-presentation', mode.attr);
			await ep.waitForRenderFlush();
		});

		test('unfocused hides the fence lines; focus reveals them and grows the box', async () => {
			const fenceLine = ep.getBlock(0).locator('.md-fence-line').first();

			// Focus the trailing paragraph first so the code block is unfocused.
			await ep.clickBlock(1);
			await expect(fenceLine).toBeHidden();
			const unfocusedHeight = await boxHeight(ep);

			await ep.clickBlock(0);
			await expect(fenceLine).toBeVisible();
			await ep.waitForRenderFlush();
			expect(await boxHeight(ep)).toBeGreaterThan(unfocusedHeight);

			// Blur back out — the fence lines hide again and the box shrinks.
			await ep.clickBlock(1);
			await expect(fenceLine).toBeHidden();
			await ep.waitForRenderFlush();
			expect(await boxHeight(ep)).toBe(unfocusedHeight);
		});
	});
}
