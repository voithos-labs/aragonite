import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { centerOfWord } from './helpers';

// Block-granular live preview on /test/editor: every block hides its markers
// except the focused one (data-focused, CSS-only). Editing stays live — the
// editing scenarios live in presentation-preview-block-editing.spec.ts.
// Requirements: e2e/requirements/presentation/presentation-preview-block.md.

const DOC = [
	'# Heading one',
	'',
	'alpha **beta** gamma',
	'',
	'```js',
	'const x = 1;',
	'```',
	'',
	'- one',
	'- two'
].join('\n');

async function togglePreview(page: Page): Promise<void> {
	await page.getByTestId('preview-block-toggle').click();
}

test.describe('preview-block — markers by focus', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		await togglePreview(page);
	});

	test('root attribute present only in preview-block', async ({ page }) => {
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'preview-block');
		await togglePreview(page); // back to source
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
	});

	test('an unfocused block hides its markers; focusing it reveals only its own', async ({
		page: _page
	}) => {
		const headingMarker = ep.getBlock(0).locator('.md-marker').first();
		const paraMarker = ep.getBlock(1).locator('.md-marker').first();

		// Nothing focused yet — every block is rendered.
		await expect(headingMarker).toBeHidden();
		await expect(paraMarker).toBeHidden();

		await ep.clickBlock(1);
		await expect(paraMarker).toBeVisible();
		await expect(headingMarker).toBeHidden(); // containment: only the focused block

		await ep.clickBlock(0);
		await expect(headingMarker).toBeVisible();
		await expect(paraMarker).toBeHidden();
	});

	test('markers are hidden, never omitted — the byte stays in the DOM', async () => {
		expect(await ep.getBlockText(0)).toBe('# Heading one');
		expect(await ep.getBlockText(1)).toBe('alpha **beta** gamma');
	});

	test('code fences hide unfocused, show when focused, textContent stays raw', async ({
		page: _page
	}) => {
		const fence = ep.getBlock(2).locator('.md-marker').first();
		await expect(fence).toBeHidden();
		// Read-back safety: the fence text is present regardless of paint.
		expect(await ep.getBlockText(2)).toContain('```js');
		expect(await ep.getBlockText(2)).toContain('const x = 1;');

		await ep.clickBlock(2);
		await expect(fence).toBeVisible();
		expect(await ep.getBlockText(2)).toContain('```js');
	});

	test('containment: the focused list item shows its marker, siblings stay rendered', async () => {
		const firstAmbient = ep.page.locator(
			`[data-block-path='[3,0,0]'] .md-marker[contenteditable='false']`
		);
		const secondAmbient = ep.page.locator(
			`[data-block-path='[3,1,0]'] .md-marker[contenteditable='false']`
		);
		// Focus the first item's paragraph.
		await ep.clickBlockAtPath([3, 0, 0], 0);
		await expect(firstAmbient).toBeVisible(); // its `- ` reads as source
		await expect(secondAmbient).toBeHidden(); // sibling keeps rendered bullet chrome

		// The focused item's rendered bullet is suppressed (no doubled `- •`); the
		// sibling still paints one — guards the ::before source-order tie.
		const before = (el: Element) => getComputedStyle(el, '::before').content;
		expect(await firstAmbient.evaluate(before)).not.toContain('•');
		expect(await secondAmbient.evaluate(before)).toContain('•');
	});
});

test.describe('preview-block — caret + traversal', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		await togglePreview(page);
	});

	test('clicking into an unfocused block lands the caret at the content offset', async ({
		page
	}) => {
		// "alpha **beta** gamma": click mid-"beta" while the block is rendered.
		const point = await centerOfWord(page, 'beta');
		await page.mouse.click(point.x, point.y);
		await ep.waitForRenderFlush();

		const sel = await ep.bridge.getSelectionPaths();
		expect(sel?.focus.path).toEqual([1]);
		// "beta" is raw 8..12; the hidden `**` (raw 6..8) is counted, so the caret
		// sits inside the content — not shifted onto/before the marker (that would
		// read ~8 as a visible-only offset). Markers now reveal for the focused block.
		expect(sel?.focus.offset).toBeGreaterThanOrEqual(8);
		expect(sel?.focus.offset).toBeLessThanOrEqual(12);
		await expect(ep.getBlock(1).locator('.md-marker').first()).toBeVisible();
	});

	test('arrow traversal flips marker visibility cleanly block to block', async ({ page }) => {
		const headingMarker = ep.getBlock(0).locator('.md-marker').first();
		const paraMarker = ep.getBlock(1).locator('.md-marker').first();

		await ep.clickBlock(0);
		await expect(headingMarker).toBeVisible();
		await expect(paraMarker).toBeHidden();

		await page.keyboard.press('ArrowDown');
		await ep.waitForRenderFlush();
		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([1]);
		await expect(headingMarker).toBeHidden();
		await expect(paraMarker).toBeVisible();
	});
});
