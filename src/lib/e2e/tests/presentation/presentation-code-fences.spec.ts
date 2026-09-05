import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Each fence line is wrapped so reading and preview collapse the whole line — marker AND
// its `\n` — instead of leaving a bare newline painting a blank line in the code box.
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

		// Opener + closer gone, body untouched: ≈ 2 line-heights shorter. The band is two-sided so
		// a half-collapse — only the top or only the bottom line — fails as loudly as none.
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

// An all-blank body has no line the closer can steal a separator from: every line
// is content. Its reading-mode box must be as tall as an equal-count content body —
// N blank lines render N blank lines, not N−1.
test.describe('code fences — an all-blank body keeps its blank lines in reading mode', () => {
	// Block 0: two content lines. Block 1: two blank body lines. Same fence count.
	const DOC_BLANK = ['```', 'x', 'y', '```', '', '```', '', '', '```', '', 'end'].join('\n');

	async function blockHeight(ep: EditorPage, index: number): Promise<number> {
		const box = await ep.getBlock(index).boundingBox();
		if (!box) throw new Error(`block ${index} has no bounding box`);
		return box.height;
	}

	test('reading renders the two blank lines, matching a two-content-line box', async ({ page }) => {
		const ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC_BLANK);

		const sourceContent = await blockHeight(ep, 0);

		await page.getByTestId('presentation-toggle').click();
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await ep.waitForRenderFlush();

		const readingContent = await blockHeight(ep, 0);
		const readingBlank = await blockHeight(ep, 1);
		// Both boxes collapse opener + closer; the content box loses two fence lines.
		const lineHeight = (sourceContent - readingContent) / 2;

		// A closer wrapper that steals the blank body's terminating `\n` renders the all-blank box
		// one line short of the content box, which falls below the band.
		expect(readingBlank).toBeGreaterThan(readingContent - lineHeight * 0.5);
		expect(readingBlank).toBeLessThan(readingContent + lineHeight * 0.5);
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
