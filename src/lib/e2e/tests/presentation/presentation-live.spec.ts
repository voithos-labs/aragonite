import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { centerOfWord } from './helpers';

// Live mode: reading's marker-hiding CSS families over an editable surface, and no
// reveal at all — the property that separates it from both preview rungs.
// Requirements: e2e/requirements/presentation/presentation-live.md.

const DOC = [
	'# Title',
	'',
	'Some **bold** text',
	'',
	'- alpha',
	'1. one',
	'- [ ] task',
	'',
	'```js',
	'const x = 1;',
	'```',
	'',
	'| a | b |',
	'| --- | --- |',
	'| 1 | 2 |',
	'',
	'Visit [example](https://example.com) here'
].join('\n');

const AMBIENT_MARKER = ".md-marker[contenteditable='false']";

// The attribute check is load-bearing, not ceremony: an unwhitelisted query param falls back
// to source, where the editability scenarios below would pass without live existing at all.
async function enterLive(page: Page): Promise<EditorPage> {
	const ep = new EditorPage(page);
	await ep.goto('?presentationMode=live');
	await ep.loadContent(DOC);
	await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'live');
	return ep;
}

test.describe('live mode — markers never reveal', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('every marker family hides from paint while its bytes stay in the DOM', async ({ page }) => {
		const emphasisMarker = ep.getBlock(1).locator('.md-marker').first();
		await expect(emphasisMarker).toHaveCSS('display', 'none');
		await expect(ep.getBlock(0).locator('.md-marker').first()).toBeHidden();
		await expect(page.locator('.md-fence-line').first()).toBeHidden();

		// The coordinate-space contract: hidden, never omitted.
		expect(await ep.getBlockText(0)).toBe('# Title');
		expect(await ep.getBlockText(1)).toBe('Some **bold** text');
	});

	test('the caret inside a block reveals neither the block nor its construct', async ({ page }) => {
		const headingMarker = ep.getBlock(0).locator('.md-marker').first();
		const emphasisMarkers = ep.getBlock(1).locator('.md-marker');

		const point = await centerOfWord(page, 'bold');
		await page.mouse.click(point.x, point.y);
		await ep.waitForRenderFlush();
		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([1]);

		// preview-block would show both emphasis markers here, preview-inline the pair
		// the caret sits between. Live shows neither, and the heading stays folded too.
		await expect(emphasisMarkers.first()).toBeHidden();
		await expect(emphasisMarkers.nth(1)).toBeHidden();
		await expect(headingMarker).toBeHidden();
	});

	test('list markers: bullet paints chrome, ordered stays visible, task keeps its checkbox', async ({
		page
	}) => {
		await expect(
			page.locator(`[data-list-marker='ordered'] ${AMBIENT_MARKER}`).first()
		).toBeVisible();
		await expect(page.locator(`[data-list-marker='task'] .task-checkbox`).first()).toBeVisible();

		const bulletAmbient = page.locator(`[data-list-marker='bullet'] ${AMBIENT_MARKER}`).first();
		await expect(bulletAmbient).toBeHidden();
		const painted = await bulletAmbient.evaluate((el) => getComputedStyle(el, '::before').content);
		expect(painted).toContain('•');
	});

	test('the header toggle enters and leaves live mode', async ({ page }) => {
		const toggle = page.getByTestId('live-toggle');
		await toggle.click(); // live → source
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		await expect(ep.getBlock(0).locator('.md-marker').first()).toBeVisible();

		await toggle.click();
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'live');
	});
});

test.describe('live mode — the surface stays editable', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = await enterLive(page);
	});

	test('typing into a paragraph commits the bytes', async () => {
		await ep.clickBlock(1);
		await ep.typeText('EDIT');
		await ep.bridge.waitForSourceContains('EDIT');
	});

	test('the task checkbox toggles, unlike reading mode', async ({ page }) => {
		await page.locator('.task-checkbox').first().click();
		await ep.bridge.waitForSourceContains('- [x] task');
	});

	test('a plain click on a link places a caret instead of navigating', async ({
		context,
		page
	}) => {
		let popupFired = false;
		context.on('page', () => {
			popupFired = true;
		});
		await page.locator('a.md-link-content').first().click();
		await ep.waitForRenderFlush();

		expect((await ep.bridge.getSelectionPaths())?.focus.path).toEqual([7]);
		// 200ms — verifying absence of a popup event; no observable state to predicate on.
		await page.waitForTimeout(200);
		expect(popupFired).toBe(false);
	});

	test('table grips and drag handles survive the flip', async ({ page }) => {
		const grip = page.locator('[data-table-col-grip]').first();
		await page.locator("[role='table']").first().hover();
		await expect(grip).toHaveCSS('opacity', '1');

		const host = page.locator('.block-host', { hasText: 'Some' }).last();
		await host.hover();
		await expect(host.locator('.block-drag-handle').first()).toHaveCSS('opacity', '1');
	});
});
