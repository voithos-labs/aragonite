import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';

// Inline-granular live preview on /test/editor: unfocused blocks render like
// preview-block; inside the focused block each construct's markers stay hidden
// until the caret enters its inclusive range. Editing scenarios live in
// presentation-preview-inline-editing.spec.ts.
// Requirements: e2e/requirements/presentation/presentation-preview-inline.md.

const DOC = [
	'# Heading one',
	'',
	'alpha **beta** gamma',
	'',
	'a **b** c',
	'',
	'**bold *italic* tail**',
	'',
	'*a* b `c`'
].join('\n');

const togglePreviewInline = (page: Page) => page.getByTestId('preview-inline-toggle').click();

// Center pixel of the first visible text node containing `word` — clicks a
// marker-adjacent word without relying on raw-offset geometry (hidden markers
// have no layout box, so a raw-offset walk mis-measures them).
async function centerOfWord(page: Page, word: string): Promise<{ x: number; y: number }> {
	const point = await page.evaluate((w) => {
		const root = document.querySelector('.editor')!;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const i = node.textContent?.indexOf(w) ?? -1;
			if (i >= 0) {
				const range = document.createRange();
				range.setStart(node, i);
				range.setEnd(node, i + w.length);
				const rect = range.getBoundingClientRect();
				return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
			}
		}
		return null;
	}, word);
	if (!point) throw new Error(`centerOfWord: "${word}" not found`);
	return point;
}

test.describe('preview-inline — markers by caret proximity', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		await togglePreviewInline(page);
	});

	test('root attribute present only in preview-inline', async ({ page }) => {
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'preview-inline');
		await togglePreviewInline(page); // back to source
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
	});

	test('unfocused blocks render like preview-block; focus alone reveals no construct', async ({
		page
	}) => {
		const headingMarker = ep.getBlock(0).locator('.md-marker').first();
		const betaMarkers = ep.getBlock(1).locator('[data-construct-start]');

		await expect(headingMarker).toBeHidden();
		await expect(betaMarkers.first()).toBeHidden();

		// Caret in "alpha" — the block is focused but the caret is outside the
		// construct, so its markers stay folded.
		const point = await centerOfWord(page, 'alpha');
		await page.mouse.click(point.x, point.y);
		await ep.waitForRenderFlush();
		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([1]);
		await expect(betaMarkers.first()).toBeHidden();
		await expect(betaMarkers.nth(1)).toBeHidden();
		// The marker bytes stay in the DOM (hidden, never omitted).
		expect(await ep.getBlockText(1)).toBe('alpha **beta** gamma');
	});

	test('a focused heading shows its block-own prefix (whole-block syntax)', async () => {
		const headingMarker = ep.getBlock(0).locator('.md-marker').first();
		await ep.clickBlock(0);
		await expect(headingMarker).toBeVisible();
	});

	test('clicking into a construct reveals its markers; leaving folds them', async ({ page }) => {
		const betaMarkers = ep.getBlock(1).locator('[data-construct-start]');
		const point = await centerOfWord(page, 'beta');
		await page.mouse.click(point.x, point.y);
		await expect(betaMarkers.first()).toBeVisible();
		await expect(betaMarkers.nth(1)).toBeVisible();

		// Same block, outside the construct: fold.
		const out = await centerOfWord(page, 'alpha');
		await page.mouse.click(out.x, out.y);
		await expect(betaMarkers.first()).toBeHidden();
		await expect(betaMarkers.nth(1)).toBeHidden();
	});

	test('nested constructs reveal the full enclosing chain', async ({ page }) => {
		// `**bold *italic* tail**` — strong [0,22), emphasis [7,15).
		const strongMarkers = ep.getBlock(3).locator('[data-construct-start="0"]');
		const emMarkers = ep.getBlock(3).locator('[data-construct-start="7"]');
		const point = await centerOfWord(page, 'italic');
		await page.mouse.click(point.x, point.y);
		await expect(emMarkers.first()).toBeVisible();
		await expect(emMarkers.nth(1)).toBeVisible();
		await expect(strongMarkers.first()).toBeVisible();
		await expect(strongMarkers.nth(1)).toBeVisible();

		// In the strong but out of the emphasis: the inner wrapper folds alone.
		const tail = await centerOfWord(page, 'tail');
		await page.mouse.click(tail.x, tail.y);
		await expect(emMarkers.first()).toBeHidden();
		await expect(strongMarkers.first()).toBeVisible();
	});

	test('caret walk across `a **b** c` never skips or doubles an offset', async ({ page }) => {
		// The sharp edge this mode lives on: the reveal fires at the construct's
		// inclusive edge, so the next arrow step enters visible marker text — the
		// caret must visit every raw offset exactly once.
		const markers = ep.getBlock(2).locator('[data-construct-start]');
		await ep.clickBlock(2);
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		expect((await ep.bridge.getSelectionPaths())?.focus.offset).toBe(0);

		const offsets: number[] = [];
		for (let i = 0; i < 9; i++) {
			await page.keyboard.press('ArrowRight');
			await ep.waitForRenderFlush();
			const sel = await ep.bridge.getSelectionPaths();
			expect(sel?.focus.path).toEqual([2]);
			offsets.push(sel?.focus.offset ?? -1);
			// Mid-construct (strong spans [2,7)): both `**` marker spans are visible.
			if (offsets.at(-1) === 4) await expect(markers.first()).toBeVisible();
		}
		expect(offsets).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		// Past the construct: folded again.
		await expect(markers.first()).toBeHidden();
	});

	test('cross-construct sweep reveals and folds each construct in sequence', async ({ page }) => {
		// `*a* b `c`` — emphasis [0,3), inline code [6,9).
		const emMarkers = ep.getBlock(4).locator('[data-construct-start="0"]');
		const codeMarkers = ep.getBlock(4).locator('[data-construct-start="6"]');
		await ep.clickBlock(4);
		// Home lands on the first VISIBLE position — raw 0 is the em's folded `*` —
		// so read where it landed and walk to each target by verified single steps.
		await page.keyboard.press('Home');
		await ep.waitForRenderFlush();
		let offset = (await ep.bridge.getSelectionPaths())?.focus.offset ?? -1;
		expect(offset).toBeGreaterThanOrEqual(0);
		const stepTo = async (target: number) => {
			while (offset < target) {
				await page.keyboard.press('ArrowRight');
				await ep.waitForRenderFlush();
				offset = (await ep.bridge.getSelectionPaths())?.focus.offset ?? 99;
			}
			expect(offset).toBe(target); // an overshoot means a skipped raw offset
		};

		await stepTo(1); // inside the emphasis
		await expect(emMarkers.first()).toBeVisible();
		await expect(codeMarkers.first()).toBeHidden();

		await stepTo(5); // the plain gap — both folded
		await expect(emMarkers.first()).toBeHidden();
		await expect(codeMarkers.first()).toBeHidden();

		await stepTo(7); // inside the code span
		await expect(codeMarkers.first()).toBeVisible();
		await expect(emMarkers.first()).toBeHidden();
	});

	test('toggling to source shows every marker; reading hides all and folds', async ({ page }) => {
		const point = await centerOfWord(page, 'beta');
		await page.mouse.click(point.x, point.y);
		await expect(ep.getBlock(1).locator('[data-construct-start]').first()).toBeVisible();

		await togglePreviewInline(page); // → source
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		await expect(ep.getBlock(0).locator('.md-marker').first()).toBeVisible();
		await expect(ep.getBlock(1).locator('.md-marker').first()).toBeVisible();

		await togglePreviewInline(page); // → preview-inline
		await page.getByTestId('presentation-toggle').click(); // → reading
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await expect(ep.getBlock(0).locator('.md-marker').first()).toBeHidden();
		await expect(ep.getBlock(1).locator('.md-marker').first()).toBeHidden();
	});
});
