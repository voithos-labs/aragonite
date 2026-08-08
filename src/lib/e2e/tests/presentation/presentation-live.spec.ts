import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { Page } from '@playwright/test';
import { centerOfWord } from './helpers';
import { PluginsPage } from '../plugins/helpers';

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
	'Visit [example](https://example.com) here',
	'',
	'Also [docs][ref] here',
	'',
	'[ref]: https://example.com/docs',
	'',
	// Appended, never spliced: the scenarios above address blocks by index.
	'See <https://commonmark.org> too'
].join('\n');

// Directives render only on `/test/plugins`, so the container-chrome arm is driven there.
const DIRECTIVE_DOC = ':::foo\nBody with **bold** here.\n:::\n';

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
		// toHaveCSS, not toBeHidden: a missing element passes toBeHidden, so a fixture that
		// stopped producing one of these spans would retire its arm silently.
		await expect(ep.getBlock(1).locator('.md-marker').first()).toHaveCSS('display', 'none');
		await expect(page.locator('.md-fence-line').first()).toHaveCSS('display', 'none');
		await expect(page.locator('.md-ref-label').first()).toHaveCSS('display', 'none');
		await expect(ep.getBlock(0).locator('.md-marker').first()).toBeHidden();

		// The coordinate-space contract: hidden, never omitted.
		expect(await ep.getBlockText(0)).toBe('# Title');
		expect(await ep.getBlockText(1)).toBe('Some **bold** text');
	});

	test('an angle autolink hides its brackets and shows the bare url', async () => {
		const block = ep.getBlocks().filter({ hasText: 'commonmark.org' });
		const brackets = block.locator('.md-marker');

		await expect(brackets).toHaveCount(2);
		await expect(brackets.first()).toHaveCSS('display', 'none');
		await expect(brackets.last()).toHaveCSS('display', 'none');
		await expect(block.locator('a.md-autolink')).toHaveText('https://commonmark.org');

		expect(await block.textContent()).toBe('See <https://commonmark.org> too');
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

	test('the header toggle round-trips live and leaves the bytes untouched', async ({ page }) => {
		const baseline = await ep.bridge.getSource();
		const toggle = page.getByTestId('live-toggle');

		await toggle.click(); // live → source
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		await expect(ep.getBlock(0).locator('.md-marker').first()).toBeVisible();

		await toggle.click();
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'live');
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(baseline);
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

// The bridge is live's third entry door (query param and toggle are covered above), and the
// only one that reaches the plugin harness where directive containers render.
test.describe('live mode — plugin container chrome', () => {
	test('directive fences hide and stay hidden with the caret in the body', async ({ page }) => {
		const ep = new PluginsPage(page);
		await ep.gotoPlugins();
		await ep.loadContent(DIRECTIVE_DOC);
		await page.evaluate(() => (window as any).__test.setPresentationMode('live'));
		await ep.waitForRenderFlush();
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'live');

		const directiveMarker = page.locator('.directive-marker').first();
		await expect(directiveMarker).toHaveCSS('display', 'none');

		// Under preview-block the body's own `**` would reveal here; live reveals neither
		// the body's markers nor the container's chrome.
		await page.locator('.directive-block [contenteditable="true"]', { hasText: /bold/ }).click();
		await expect(page.locator('.directive-block .md-marker').first()).toBeHidden();
		await expect(directiveMarker).toHaveCSS('display', 'none');
	});
});
